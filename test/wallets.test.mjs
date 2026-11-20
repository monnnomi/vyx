import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes,createECDH} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {login} from '../server/oauth.js';
import {state} from '../server/service.js';
import {keccak256,checksumAddress,normalizeAddress,pointMul,G,N,modInv,publicKeyToAddress,recoverAddress,personalMessageHash} from '../server/evm.js';
import {createWalletChallenge,linkWallet,unlinkWallet,memberWallet,migrateWallets,walletChangeDays} from '../server/wallets.js';
import {createHandler} from '../api/vyx.js';

process.env.VYX_APP_SECRET||='wallet-test-secret';process.env.PUBLIC_APP_URL='https://joinvyx.com';
const pg=new PGlite();await pg.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
const wrap=p=>({q:async(s,v=[])=>(await p.query(s,v)).rows,tx:fn=>p.transaction(tx=>fn(wrap(tx)))}),db=wrap(pg);after(()=>pg.close());

// Test-only signer: ECDSA over secp256k1 with low-s, as wallets produce for personal_sign.
function wallet(){
 const d=BigInt('0x'+randomBytes(32).toString('hex'))%(N-1n)+1n;
 const address=publicKeyToAddress(pointMul(G,d));
 return {address,checksum:checksumAddress(address),sign(message){
  const e=BigInt('0x'+personalMessageHash(message).toString('hex'))%N;
  for(;;){
   const k=BigInt('0x'+randomBytes(32).toString('hex'))%(N-1n)+1n,R=pointMul(G,k),r=R[0]%N;if(r===0n)continue;
   let s=modInv(k,N)*(e+r*d)%N,v=Number(R[1]&1n);if(s===0n)continue;if(s>N/2n){s=N-s;v^=1;}
   return '0x'+r.toString(16).padStart(64,'0')+s.toString(16).padStart(64,'0')+(27+v).toString(16);
  }
 }};
}
let seq=0;
const member=async()=>{const n=++seq;return (await db.tx(tx=>login(tx,{id:String(77000+n),username:'wallet_'+n,name:'Wallet member '+n,avatar:''}))).user;};
const t0=new Date('2026-12-01T10:00:00Z'),later=(base,ms)=>new Date(base.getTime()+ms);
async function link(user,w,at=t0){const c=await createWalletChallenge(db,user,{address:w.checksum},at);return linkWallet(db,user,{nonce:c.nonce,signature:w.sign(c.message)},at);}

test('Keccak-256, EIP-55 and secp256k1 match published vectors and Node',()=>{
 assert.equal(keccak256('').toString('hex'),'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
 assert.equal(keccak256('abc').toString('hex'),'4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45');
 assert.equal(keccak256('The quick brown fox jumps over the lazy dog').toString('hex'),'4d741b6f1eb29cb2a9b9911c82f56fa8d73b04959d3d9d222895df6c0b28aa15');
 for(const a of ['0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed','0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359','0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB','0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb'])assert.equal(checksumAddress(a.toLowerCase()),a);
 assert.equal(checksumAddress(publicKeyToAddress(G)),'0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf');
 assert.equal(checksumAddress(publicKeyToAddress(pointMul(G,2n))),'0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF');
 const k=randomBytes(32),ecdh=createECDH('secp256k1');ecdh.setPrivateKey(k);const pub=ecdh.getPublicKey(),mine=pointMul(G,BigInt('0x'+k.toString('hex')));
 assert.equal(pub.subarray(1,33).toString('hex'),mine[0].toString(16).padStart(64,'0'));assert.equal(pub.subarray(33).toString('hex'),mine[1].toString(16).padStart(64,'0'));
 assert.equal(normalizeAddress('0x5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED'),'0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed');
 assert.equal(normalizeAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD'),null);assert.equal(normalizeAddress('0x123'),null);
});

test('personal_sign signatures recover the signing address and nothing else',()=>{
 const w=wallet(),other=wallet(),sig=w.sign('Link VYX');
 assert.equal(recoverAddress(personalMessageHash('Link VYX'),sig),w.address);
 assert.notEqual(recoverAddress(personalMessageHash('Link VYX!'),sig),w.address);
 assert.equal(recoverAddress(personalMessageHash('x'),other.sign('x')),other.address);
 assert.throws(()=>recoverAddress(personalMessageHash('x'),'0x'+'00'.repeat(65)),/Invalid signature/);
 assert.throws(()=>recoverAddress(personalMessageHash('x'),sig.slice(0,-2)+'1d'),/Invalid signature/);
});

test('a member links a wallet with a server-written Sign-In with Ethereum message on Robinhood Chain',async()=>{
 const user=await member(),w=wallet();
 const c=await createWalletChallenge(db,user,{address:w.checksum},t0);
 assert.match(c.message,/^joinvyx\.com wants you to sign in with your Ethereum account:\n0x[0-9a-fA-F]{40}\n/);
 assert.ok(c.message.includes('\nChain ID: 4663\n')&&c.message.includes('\nNonce: '+c.nonce+'\n')&&c.message.includes('Expiration Time: 2026-12-01T10:10:00.000Z'));
 assert.ok(c.message.includes(w.checksum));
 const linked=await linkWallet(db,user,{nonce:c.nonce,signature:w.sign(c.message)},t0);
 assert.equal(linked.address,w.checksum);assert.equal(linked.chain.id,4663);assert.equal(linked.chain.name,'Robinhood Chain');
 assert.deepEqual(await memberWallet(db,user.id,t0),linked);
 const account=(await state(db,user)).user;assert.equal(account.wallet.address,w.checksum);
 await assert.rejects(linkWallet(db,user,{nonce:c.nonce,signature:w.sign(c.message)},t0),/already used/);
 await assert.rejects(createWalletChallenge(db,user,{address:w.address},t0),/already linked to your account/);
 await assert.rejects(createWalletChallenge(db,user,{address:wallet().address},t0),/Unlink your current wallet first/);
});

test('wrong signer, expired, foreign or malformed requests do not link anything',async()=>{
 const user=await member(),other=await member(),w=wallet(),stranger=wallet();
 let c=await createWalletChallenge(db,user,{address:w.address},t0);
 await assert.rejects(linkWallet(db,user,{nonce:c.nonce,signature:stranger.sign(c.message)},t0),/does not match this wallet/);
 await assert.rejects(linkWallet(db,user,{nonce:c.nonce,signature:w.sign(c.message+' ')},t0),/does not match this wallet/);
 await assert.rejects(linkWallet(db,other,{nonce:c.nonce,signature:w.sign(c.message)},t0),/was not found/);
 await assert.rejects(linkWallet(db,user,{nonce:c.nonce,signature:w.sign(c.message)},later(t0,10*60000)),/expired/);
 await assert.rejects(linkWallet(db,user,{nonce:'zz',signature:w.sign('x')},t0),/incomplete/);
 await assert.rejects(createWalletChallenge(db,user,{address:'0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD'},t0),/valid wallet address/);
 assert.equal((await memberWallet(db,user.id,t0)).address,null);
 c=await createWalletChallenge(db,user,{address:w.address},t0);
 assert.equal((await linkWallet(db,user,{nonce:c.nonce,signature:w.sign(c.message)},t0)).address,w.checksum);
});

test('one wallet per account, one account per wallet, and a cooldown before switching to a new address',async()=>{
 const a=await member(),b=await member(),w=wallet(),w2=wallet();
 await link(a,w);
 await assert.rejects(createWalletChallenge(db,b,{address:w.address},t0),/linked to another VYX account/);
 const unlinked=await unlinkWallet(db,a,later(t0,1000));assert.equal(unlinked.address,null);assert.ok(unlinked.newAddressAvailableAt);
 await assert.rejects(createWalletChallenge(db,b,{address:w.address},later(t0,2000)),/used by another VYX account/);
 await assert.rejects(createWalletChallenge(db,a,{address:w2.address},later(t0,2000)),/link a different wallet after/);
 assert.equal((await link(a,w,later(t0,3000))).address,w.checksum);
 await unlinkWallet(db,a,later(t0,4000));
 const after=later(t0,walletChangeDays*86400000+5000);
 assert.equal((await memberWallet(db,a.id,after)).newAddressAvailableAt,null);
 assert.equal((await link(a,w2,after)).address,w2.checksum);
 const events=await db.q('SELECT action FROM wallet_link_events WHERE user_id=$1 ORDER BY id',[a.id]);
 assert.deepEqual(events.map(e=>e.action),['link','unlink','link','unlink','link']);
 await assert.rejects(unlinkWallet(db,b,t0),/No wallet is linked/);
});

test('the wallet migration is repeatable and the API links only for signed-in same-site requests',async()=>{
 await migrateWallets(db);await migrateWallets(db);
 const n=++seq,session=await db.tx(tx=>login(tx,{id:String(77000+n),username:'wallet_api_'+n,name:'Wallet API '+n,avatar:''})),w=wallet();
 const handler=createHandler(async fn=>fn(db));
 const call=async(action,payload,headers={})=>{
  let status=200,body='';
  const req=Object.assign((async function*(){yield Buffer.from(JSON.stringify(payload));})(),{method:'POST',url:'/api/vyx?action='+action,headers:{'content-type':'application/json',origin:'https://joinvyx.com',...headers}});
  const res={statusCode:200,setHeader(){},end(b){body=b||'';status=this.statusCode;}};
  await handler(req,res);return {status,json:body?JSON.parse(body):null};
 };
 const signedIn={cookie:'vyx_session='+session.sessionToken};
 assert.equal((await call('wallet-challenge',{address:w.address})).status,401);
 assert.equal((await call('wallet-challenge',{address:w.address},{...signedIn,origin:'https://evil.example'})).status,403);
 const c=await call('wallet-challenge',{address:w.address},signedIn);assert.equal(c.status,200);assert.equal(c.json.chainId,4663);
 const linked=await call('wallet-link',{nonce:c.json.nonce,signature:w.sign(c.json.message)},signedIn);
 assert.equal(linked.status,200);assert.equal(linked.json.wallet.address,w.checksum);
 const unlinked=await call('wallet-unlink',{},signedIn);assert.equal(unlinked.status,200);assert.equal(unlinked.json.wallet.address,null);
});
