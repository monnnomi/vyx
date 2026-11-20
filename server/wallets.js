// Robinhood Chain wallet linking. A member proves control of an EVM address by
// signing a Sign-In with Ethereum (EIP-4361) message that the server wrote and
// stored; the server never trusts message text sent back by the browser.
import {randomBytes} from 'node:crypto';
import {fail,appURL} from './http.js';
import {recoverAddress,personalMessageHash,normalizeAddress,checksumAddress} from './evm.js';

export const robinhoodChains=Object.freeze({
 4663:{id:4663,name:'Robinhood Chain',rpc:'https://rpc.mainnet.chain.robinhood.com',explorer:'https://robinhoodchain.blockscout.com'},
 46630:{id:46630,name:'Robinhood Chain Testnet',rpc:'https://rpc.testnet.chain.robinhood.com',explorer:'https://explorer.testnet.chain.robinhood.com'}
});
export function walletChain(){
 const chain=robinhoodChains[Number(process.env.VYX_CHAIN_ID||4663)];
 if(!chain)throw new Error('VYX_CHAIN_ID must be 4663 (Robinhood Chain) or 46630 (Robinhood Chain Testnet).');
 return chain;
}
export const challengeMinutes=10;
export const walletChangeDays=7;

// Shared with scripts/migrate-wallets.mjs and db/schema.sql. Additive and repeatable.
export const walletSchema=`
CREATE TABLE IF NOT EXISTS wallet_challenges (
 nonce text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 address text NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$'),
 chain_id integer NOT NULL,
 message text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 used_at timestamptz
);
CREATE INDEX IF NOT EXISTS wallet_challenges_user_idx ON wallet_challenges(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS user_wallets (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 address text NOT NULL UNIQUE CHECK (address ~ '^0x[0-9a-f]{40}$'),
 chain_id integer NOT NULL,
 message text NOT NULL,
 signature text NOT NULL,
 linked_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS wallet_link_events (
 id bigserial PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 address text NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$'),
 action text NOT NULL CHECK (action IN ('link','unlink')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wallet_link_events_user_idx ON wallet_link_events(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS wallet_link_events_address_idx ON wallet_link_events(address);
`;

// One statement per query: drivers run parameterised queries one command at a time.
export const walletStatements=walletSchema.split(';').map(x=>x.trim()).filter(Boolean);
export async function migrateWallets(db){for(const sql of walletStatements)await db.q(sql);}

const iso=d=>new Date(d).toISOString();
async function clock(db,now){return now?new Date(now):new Date((await db.q('SELECT clock_timestamp() AS now'))[0].now);}

export function walletMessage({address,chainId,nonce,issuedAt,expiresAt}){
 const site=new URL(appURL());
 return `${site.host} wants you to sign in with your Ethereum account:
${checksumAddress(address)}

Link this wallet to your VYX account to receive VYX Points on Robinhood Chain. Signing is free and does not move any funds.

URI: ${site.origin}
Version: 1
Chain ID: ${chainId}
Nonce: ${nonce}
Issued At: ${iso(issuedAt)}
Expiration Time: ${iso(expiresAt)}`;
}

// Change rule: after unlinking, a different address can be linked only after the
// cooldown; re-linking the same address is always allowed.
async function changeAvailableAt(db,userId,address,now){
 const [last]=await db.q("SELECT address,created_at FROM wallet_link_events WHERE user_id=$1 AND action='unlink' ORDER BY created_at DESC LIMIT 1",[userId]);
 if(!last||last.address===address)return null;
 const until=new Date(new Date(last.created_at).getTime()+walletChangeDays*86400000);
 return until>now?until:null;
}

export async function memberWallet(db,userId,now=null){
 const at=await clock(db,now),chain=walletChain();
 const [row]=await db.q('SELECT address,chain_id,linked_at FROM user_wallets WHERE user_id=$1',[userId]);
 const [last]=await db.q("SELECT address,created_at FROM wallet_link_events WHERE user_id=$1 AND action='unlink' ORDER BY created_at DESC LIMIT 1",[userId]);
 const until=last?new Date(new Date(last.created_at).getTime()+walletChangeDays*86400000):null;
 return {
  chain:{id:chain.id,name:chain.name,rpc:chain.rpc,explorer:chain.explorer},
  address:row?checksumAddress(row.address):null,
  linkedAt:row?.linked_at||null,
  // When set, only the previously unlinked address can be linked before this time.
  newAddressAvailableAt:!row&&until&&until>at?iso(until):null
 };
}

export async function createWalletChallenge(db,user,input,now=null){
 const address=normalizeAddress(input?.address);
 if(!address)fail(400,'Choose a valid wallet address.');
 const at=await clock(db,now),chain=walletChain();
 const [linked]=await db.q('SELECT address FROM user_wallets WHERE user_id=$1',[user.id]);
 if(linked)fail(409,linked.address===address?'This wallet is already linked to your account.':'Unlink your current wallet first.');
 await assertAddressFree(db,user.id,address);
 const until=await changeAvailableAt(db,user.id,address,at);
 if(until)fail(429,`You can link a different wallet after ${until.toISOString().slice(0,16).replace('T',' ')} UTC.`);
 const [{n}]=await db.q("SELECT count(*)::int AS n FROM wallet_challenges WHERE user_id=$1 AND created_at>$2::timestamptz - interval '1 hour'",[user.id,at]);
 if(n>=20)fail(429,'Too many wallet requests. Try again in an hour.');
 const nonce=randomBytes(12).toString('hex'),expiresAt=new Date(at.getTime()+challengeMinutes*60000);
 const message=walletMessage({address,chainId:chain.id,nonce,issuedAt:at,expiresAt});
 await db.q('INSERT INTO wallet_challenges(nonce,user_id,address,chain_id,message,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[nonce,user.id,address,chain.id,message,at,expiresAt]);
 return {nonce,message,address:checksumAddress(address),chainId:chain.id,expiresAt:iso(expiresAt)};
}

async function assertAddressFree(db,userId,address){
 const [owner]=await db.q('SELECT user_id FROM user_wallets WHERE address=$1',[address]);
 if(owner&&owner.user_id!==userId)fail(409,'This wallet is linked to another VYX account.');
 const [past]=await db.q("SELECT 1 FROM wallet_link_events WHERE address=$1 AND user_id<>$2 LIMIT 1",[address,userId]);
 if(past)fail(409,'This wallet was used by another VYX account and cannot be linked again.');
}

export async function linkWallet(db,user,input,now=null){
 const nonce=typeof input?.nonce==='string'&&/^[0-9a-f]{24}$/.test(input.nonce)?input.nonce:null;
 if(typeof input?.signature==='string'&&/^0x[0-9a-fA-F]{131,}$/.test(input.signature))fail(400,'This wallet type is not supported yet. Use a standard wallet such as MetaMask.');
 const signature=typeof input?.signature==='string'&&/^0x[0-9a-fA-F]{130}$/.test(input.signature)?input.signature:null;
 if(!nonce||!signature)fail(400,'The wallet signature is incomplete. Try again.');
 const at=await clock(db,now);
 return db.tx(async tx=>{
  const [c]=await tx.q('SELECT * FROM wallet_challenges WHERE nonce=$1 AND user_id=$2 FOR UPDATE',[nonce,user.id]);
  if(!c)fail(400,'This signing request was not found. Start again.');
  if(c.used_at)fail(409,'This signing request was already used. Start again.');
  if(new Date(c.expires_at)<=at)fail(410,'This signing request expired. Start again.');
  if(c.chain_id!==walletChain().id)fail(409,'The network changed. Start again.');
  let signer;try{signer=recoverAddress(personalMessageHash(c.message),signature);}catch{fail(400,'The wallet signature could not be read. Try again.');}
  if(signer!==c.address)fail(403,'The signature does not match this wallet.');
  await tx.q('UPDATE wallet_challenges SET used_at=$2 WHERE nonce=$1',[nonce,at]);
  const [linked]=await tx.q('SELECT address FROM user_wallets WHERE user_id=$1 FOR UPDATE',[user.id]);
  if(linked)fail(409,linked.address===c.address?'This wallet is already linked to your account.':'Unlink your current wallet first.');
  await assertAddressFree(tx,user.id,c.address);
  const until=await changeAvailableAt(tx,user.id,c.address,at);
  if(until)fail(429,`You can link a different wallet after ${until.toISOString().slice(0,16).replace('T',' ')} UTC.`);
  await tx.q('INSERT INTO user_wallets(user_id,address,chain_id,message,signature,linked_at) VALUES($1,$2,$3,$4,$5,$6)',[user.id,c.address,c.chain_id,c.message,signature.toLowerCase(),at]);
  await tx.q("INSERT INTO wallet_link_events(user_id,address,action,created_at) VALUES($1,$2,'link',$3)",[user.id,c.address,at]);
  return memberWallet(tx,user.id,at);
 });
}

export async function unlinkWallet(db,user,now=null){
 const at=await clock(db,now);
 return db.tx(async tx=>{
  const [row]=await tx.q('DELETE FROM user_wallets WHERE user_id=$1 RETURNING address',[user.id]);
  if(!row)fail(404,'No wallet is linked to your account.');
  await tx.q("INSERT INTO wallet_link_events(user_id,address,action,created_at) VALUES($1,$2,'unlink',$3)",[user.id,row.address,at]);
  return memberWallet(tx,user.id,at);
 });
}
