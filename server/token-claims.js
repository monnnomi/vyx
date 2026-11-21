// jVYX allocations and on-chain claim batches.
//
// 1. computeAllocations freezes each member's share of a token season once the
//    season (or snapshot) has closed. Frozen amounts never change afterwards.
// 2. createBatch publishes a Merkle tree for members with a linked wallet who are
//    not in an earlier batch of that season. Members who link later join a later
//    batch with the same unlock start, so they lose nothing by linking late.
// 3. The owner funds VYXDistributor and calls addSeason(root,total,start,tranches,interval);
//    activateBatch records the on-chain season id after checking it on-chain.
import {fail} from './http.js';
import {buildClaimTree} from './merkle.js';
import {checksumAddress} from './evm.js';
import {walletChain} from './wallets.js';

export const tokenUnit=10n**18n;
export const jvyx=Object.freeze({symbol:'jVYX',name:'VYX Junior',decimals:18});
export const tokenContracts=Object.freeze({
 4663:{token:'0x3e5ec018ffe0f04adb7416581c1bf53af32b2e95',distributor:'0x431a9fa69f4c42ee85d7dbbcea0460856468bd16'}
});
export const claimFeeWei=20000000000000n; // 0.00002 ETH, set in the deployed distributor

// Owner decisions of 21 Nov 2026. Pools are whole jVYX.
export const tokenSeasons=Object.freeze({
 'early-members':{label:'Early member drop',pool:10_000_000n,closesAt:'2026-11-22T00:00:00Z',kind:'early'},
 'season-1':{label:'Season 1 · November',pool:17_500_000n,closesAt:'2026-12-01T00:00:00Z',kind:'vp',vpSeasons:['season-1']},
 'season-2':{label:'Season 2 · December',pool:35_000_000n,closesAt:'2026-12-25T00:00:00Z',kind:'vp',vpSeasons:['season-2']}
});
export const defaultUnlock=Object.freeze({tranches:90,intervalSeconds:86400});

export const tokenSchema=`
CREATE TABLE IF NOT EXISTS token_allocations (
 season text NOT NULL,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 amount numeric(78,0) NOT NULL CHECK (amount > 0),
 basis_vp bigint NOT NULL DEFAULT 0,
 computed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (season,user_id)
);
CREATE TABLE IF NOT EXISTS token_batches (
 id serial PRIMARY KEY,
 season text NOT NULL,
 root text NOT NULL UNIQUE CHECK (root ~ '^0x[0-9a-f]{64}$'),
 total numeric(78,0) NOT NULL CHECK (total > 0),
 members integer NOT NULL,
 starts_at timestamptz NOT NULL,
 tranches integer NOT NULL CHECK (tranches BETWEEN 1 AND 365),
 interval_seconds integer NOT NULL CHECK (interval_seconds >= 0),
 chain_id integer NOT NULL,
 onchain_id integer,
 created_at timestamptz NOT NULL DEFAULT now(),
 activated_at timestamptz,
 UNIQUE (chain_id,onchain_id)
);
CREATE TABLE IF NOT EXISTS token_batch_claims (
 batch_id integer NOT NULL REFERENCES token_batches(id) ON DELETE CASCADE,
 season text NOT NULL,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 address text NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$'),
 allocation numeric(78,0) NOT NULL CHECK (allocation > 0),
 proof jsonb NOT NULL,
 PRIMARY KEY (batch_id,user_id),
 UNIQUE (season,user_id)
);
CREATE INDEX IF NOT EXISTS token_batch_claims_user_idx ON token_batch_claims(user_id);
`;
export const tokenStatements=tokenSchema.split(';').map(x=>x.trim()).filter(Boolean);
export async function migrateTokens(db){for(const sql of tokenStatements)await db.q(sql);}

const iso=d=>new Date(d).toISOString();
function season(key){const s=tokenSeasons[key];if(!s)fail(400,'Unknown token season.');return s;}
async function clock(db,now){return now?new Date(now):new Date((await db.q('SELECT clock_timestamp() AS now'))[0].now);}

// Shares for one season. Pure: rows = [{user_id, vp}] with vp > 0.
// 'early': half the pool split equally, half by VP. 'vp': all by VP. Remainders stay unallocated.
export function splitPool(pool,rows,kind){
 const wei=BigInt(pool)*tokenUnit,total=rows.reduce((s,r)=>s+BigInt(r.vp),0n);
 if(!rows.length||total<=0n)return [];
 const equal=kind==='early'?wei/2n:0n,byVP=wei-equal,each=equal/BigInt(rows.length);
 return rows.map(r=>({user_id:r.user_id,vp:BigInt(r.vp),amount:each+byVP*BigInt(r.vp)/total})).filter(r=>r.amount>0n);
}

export async function computeAllocations(db,key,now=null){
 const s=season(key),at=await clock(db,now);
 if(at<new Date(s.closesAt))fail(409,`${key} closes at ${s.closesAt}. Allocations can be computed after that.`);
 return db.tx(async tx=>{
  const [{n}]=await tx.q('SELECT count(*)::int AS n FROM token_allocations WHERE season=$1',[key]);
  if(n)fail(409,`${key} allocations are already frozen.`);
  const rows=s.kind==='early'
   ?await tx.q(`SELECT u.id AS user_id,sum(l.amount)::bigint AS vp FROM users u JOIN reward_ledger l ON l.user_id=u.id
     WHERE u.x_id IS NOT NULL AND NOT u.is_system AND u.created_at<$1 AND l.created_at<$1 GROUP BY u.id HAVING sum(l.amount)>0 ORDER BY u.id`,[s.closesAt])
   :await tx.q(`SELECT u.id AS user_id,sum(l.amount)::bigint AS vp FROM users u JOIN reward_ledger l ON l.user_id=u.id
     WHERE u.x_id IS NOT NULL AND NOT u.is_system AND l.season=ANY($1::text[]) GROUP BY u.id HAVING sum(l.amount)>0 ORDER BY u.id`,[s.vpSeasons]);
  const shares=splitPool(s.pool,rows,s.kind);
  for(const r of shares)await tx.q('INSERT INTO token_allocations(season,user_id,amount,basis_vp,computed_at) VALUES($1,$2,$3,$4,$5)',[key,r.user_id,r.amount.toString(),r.vp.toString(),at]);
  const allocated=shares.reduce((x,r)=>x+r.amount,0n);
  return {season:key,members:shares.length,allocated:allocated.toString(),pool:(s.pool*tokenUnit).toString(),totalVP:rows.reduce((x,r)=>x+BigInt(r.vp),0n).toString()};
 });
}

export async function createBatch(db,key,{startsAt,tranches=defaultUnlock.tranches,intervalSeconds=defaultUnlock.intervalSeconds}={},now=null){
 season(key);
 if(!Number.isInteger(tranches)||tranches<1||tranches>365)fail(400,'Tranches must be 1 to 365.');
 if(!Number.isInteger(intervalSeconds)||intervalSeconds<0||(tranches>1&&intervalSeconds===0))fail(400,'Choose a valid unlock interval.');
 const chain=walletChain();
 return db.tx(async tx=>{
  const [first]=await tx.q('SELECT starts_at,tranches,interval_seconds FROM token_batches WHERE season=$1 ORDER BY id LIMIT 1',[key]);
  // Later batches of a season keep the first batch's schedule so late wallets catch up.
  const start=first?new Date(first.starts_at):new Date(startsAt||await clock(tx,now));
  if(Number.isNaN(start.getTime()))fail(400,'Choose a valid unlock start.');
  const plan=first?{tranches:first.tranches,intervalSeconds:first.interval_seconds}:{tranches,intervalSeconds};
  const rows=await tx.q(`SELECT a.user_id,a.amount::text AS amount,w.address FROM token_allocations a JOIN user_wallets w ON w.user_id=a.user_id
   WHERE a.season=$1 AND NOT EXISTS(SELECT 1 FROM token_batch_claims c WHERE c.season=a.season AND c.user_id=a.user_id) ORDER BY a.user_id`,[key]);
  if(!rows.length)fail(409,'No members with a linked wallet are waiting for this season.');
  const tree=buildClaimTree(rows.map(r=>({address:r.address,allocation:BigInt(r.amount)})));
  const [batch]=await tx.q(`INSERT INTO token_batches(season,root,total,members,starts_at,tranches,interval_seconds,chain_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
   [key,tree.root,tree.total,rows.length,start,plan.tranches,plan.intervalSeconds,chain.id]);
  for(const r of rows)await tx.q('INSERT INTO token_batch_claims(batch_id,season,user_id,address,allocation,proof) VALUES($1,$2,$3,$4,$5,$6)',
   [batch.id,key,r.user_id,r.address,r.amount,JSON.stringify(tree.claims[r.address].proof)]);
  return {id:batch.id,season:key,root:tree.root,total:tree.total,members:rows.length,startsAt:iso(start),start:Math.floor(start.getTime()/1000),...plan,chainId:chain.id};
 });
}

// Only a batch that was never activated can be discarded; its members return to the queue.
export async function discardBatch(db,id){
 const rows=await db.q('DELETE FROM token_batches WHERE id=$1 AND activated_at IS NULL RETURNING id',[id]);
 if(!rows.length)fail(409,'Only an inactive batch can be discarded.');
 return {id};
}

// readSeason(onchainId) -> {root,total,start,interval,tranches} read from VYXDistributor.seasons().
export async function activateBatch(db,id,onchainId,readSeason,now=null){
 if(!Number.isInteger(onchainId)||onchainId<0)fail(400,'Choose the on-chain season id.');
 const [b]=await db.q('SELECT * FROM token_batches WHERE id=$1',[id]);
 if(!b)fail(404,'Batch not found.');
 if(b.activated_at)fail(409,'This batch is already active.');
 const s=await readSeason(onchainId);
 const want={root:b.root,total:BigInt(b.total),start:BigInt(Math.floor(new Date(b.starts_at).getTime()/1000)),interval:BigInt(b.interval_seconds),tranches:BigInt(b.tranches)};
 for(const k of Object.keys(want))if(String(s[k]).toLowerCase()!==String(want[k]).toLowerCase())fail(409,`On-chain season ${onchainId} does not match batch ${id}: ${k} is ${s[k]}, expected ${want[k]}.`);
 await db.q('UPDATE token_batches SET onchain_id=$2,activated_at=$3 WHERE id=$1',[id,onchainId,await clock(db,now)]);
 return {id,onchainId};
}

// Decodes the seasons(uint256) return data of VYXDistributor.
export function decodeSeason(hex){
 const h=String(hex).replace(/^0x/,'');if(h.length<64*6)throw new Error('Unexpected seasons() result');
 const word=i=>BigInt('0x'+h.slice(i*64,i*64+64));
 return {root:'0x'+h.slice(0,64),total:word(1),claimed:word(2),start:word(3),interval:word(4),tranches:word(5)};
}
export const seasonsCallData=id=>'0xf5d709a1'+BigInt(id).toString(16).padStart(64,'0');

// Read-only access to VYXDistributor over the chain's JSON-RPC. Shared by the
// season timer script and the /admin section.
export function distributorReader(chain=walletChain(),fetchImpl=globalThis.fetch){
 const contracts=tokenContracts[chain.id];
 async function call(data){
  if(!contracts)throw new Error('No jVYX distributor is configured for this network.');
  const res=await fetchImpl(chain.rpc,{method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(15000),
   body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_call',params:[{to:contracts.distributor,data},'latest']})});
  const body=await res.json();if(body.error)throw new Error(body.error.message);return body.result;
 }
 return {readSeason:async id=>decodeSeason(await call(seasonsCallData(id))),readSeasonCount:async()=>Number(BigInt(await call('0x715f8fe8')))};
}

// What the owner runs after a batch is created (Foundry cast, from the Mac).
export function ownerSteps(batch,contracts){
 if(!contracts)return [];
 return [
  {title:'Treasury sends tokens to the distributor',command:`cast send ${contracts.token} "transfer(address,uint256)" ${contracts.distributor} ${batch.total} --rpc-url robinhood --account <treasury>`},
  {title:'Owner adds the season',command:`cast send ${contracts.distributor} "addSeason(bytes32,uint128,uint64,uint16,uint32)" ${batch.root} ${batch.total} ${batch.start} ${batch.tranches} ${batch.intervalSeconds} --rpc-url robinhood --account <owner>`}
 ];
}

const batchView=(b,contracts)=>{
 const start=Math.floor(new Date(b.starts_at).getTime()/1000);
 const view={id:b.id,season:b.season,label:tokenSeasons[b.season]?.label||b.season,root:b.root,total:String(b.total),members:b.members,startsAt:iso(b.starts_at),start,
  tranches:b.tranches,intervalSeconds:b.interval_seconds,chainId:b.chain_id,onchainId:b.onchain_id,createdAt:iso(b.created_at),activatedAt:b.activated_at?iso(b.activated_at):null};
 return {...view,steps:view.activatedAt?[]:ownerSteps(view,contracts)};
};

// Administrator overview of every jVYX season, batch and the largest shares.
export async function tokenAdmin(db,now=null){
 const at=await clock(db,now),chain=walletChain(),contracts=tokenContracts[chain.id]||null;
 const stats=new Map((await db.q(`SELECT a.season,count(*)::int AS members,sum(a.amount)::text AS allocated,COALESCE(sum(a.basis_vp),0)::text AS basis_vp,min(a.computed_at) AS frozen_at,
   count(w.user_id)::int AS with_wallet,count(c.user_id)::int AS batched,
   count(c.user_id) FILTER (WHERE b.activated_at IS NOT NULL)::int AS live,
   count(*) FILTER (WHERE w.user_id IS NOT NULL AND c.user_id IS NULL)::int AS waiting,
   COALESCE(sum(c.allocation) FILTER (WHERE b.activated_at IS NOT NULL),0)::text AS live_amount
  FROM token_allocations a LEFT JOIN user_wallets w ON w.user_id=a.user_id
  LEFT JOIN token_batch_claims c ON c.season=a.season AND c.user_id=a.user_id LEFT JOIN token_batches b ON b.id=c.batch_id
  GROUP BY a.season`)).map(r=>[r.season,r]));
 const batches=await db.q('SELECT id,season,root,total::text AS total,members,starts_at,tranches,interval_seconds,chain_id,onchain_id,created_at,activated_at FROM token_batches ORDER BY id');
 const top=await db.q(`SELECT season,amount,basis_vp,name,handle,x_username,status FROM (
   SELECT a.season,a.amount::text AS amount,a.basis_vp::text AS basis_vp,u.name,u.handle,u.x_username,
    CASE WHEN b.activated_at IS NOT NULL THEN 'live' WHEN c.user_id IS NOT NULL THEN 'batched' WHEN w.user_id IS NOT NULL THEN 'waiting' ELSE 'needs-wallet' END AS status,
    row_number() OVER (PARTITION BY a.season ORDER BY a.amount DESC,a.user_id) AS place
   FROM token_allocations a JOIN users u ON u.id=a.user_id LEFT JOIN user_wallets w ON w.user_id=a.user_id
   LEFT JOIN token_batch_claims c ON c.season=a.season AND c.user_id=a.user_id LEFT JOIN token_batches b ON b.id=c.batch_id) r
  WHERE place<=20 ORDER BY season,place`);
 return {...jvyx,serverNow:iso(at),chain:{id:chain.id,name:chain.name,explorer:chain.explorer},contracts,claimFee:claimFeeWei.toString(),unlock:defaultUnlock,
  seasons:Object.entries(tokenSeasons).map(([key,s])=>{
   const r=stats.get(key),first=batches.find(b=>b.season===key);
   return {key,label:s.label,kind:s.kind,pool:(s.pool*tokenUnit).toString(),closesAt:s.closesAt,closed:at>=new Date(s.closesAt),frozen:Boolean(r),frozenAt:r?iso(r.frozen_at):null,
    members:r?.members||0,allocated:r?.allocated||'0',basisVP:r?.basis_vp||'0',withWallet:r?.with_wallet||0,needsWallet:r?r.members-r.with_wallet:0,
    batched:r?.batched||0,live:r?.live||0,liveAmount:r?.live_amount||'0',waiting:r?.waiting||0,
    schedule:first?{startsAt:iso(first.starts_at),tranches:first.tranches,intervalSeconds:first.interval_seconds}:null,
    top:top.filter(t=>t.season===key).map(({season,...t})=>t)};
  }),
  batches:[...batches].reverse().map(b=>batchView(b,contracts))};
}

// POST actions from /admin. chain = distributorReader() (injected in tests).
export async function tokenAdminAction(db,input,chain){
 const action=String(input?.action||'');
 if(action==='token-batch'){
  const key=String(input.season||'');season(key);
  const [{n}]=await db.q('SELECT count(*)::int AS n FROM token_allocations WHERE season=$1',[key]);
  if(!n)fail(409,'Freeze this season before creating a batch.');
  const startsAt=input.startsAt?String(input.startsAt).slice(0,40):undefined;
  return createBatch(db,key,{startsAt});
 }
 if(action==='token-discard'){
  const id=Number(input.id);if(!Number.isInteger(id)||id<1)fail(400,'Batch not found.');
  const [b]=await db.q('SELECT root,activated_at FROM token_batches WHERE id=$1',[id]);
  if(!b)fail(404,'Batch not found.');
  if(b.activated_at)fail(409,'Only an inactive batch can be discarded.');
  // Never drop a root the owner already funded on-chain: its members could not claim it.
  let onchain=false;
  try{const count=await chain.readSeasonCount();for(let i=0;i<count&&!onchain;i++)onchain=String((await chain.readSeason(i)).root).toLowerCase()===b.root;}
  catch{fail(503,'Could not reach Robinhood Chain. Try again.');}
  if(onchain)fail(409,'This batch is already in the distributor. Check the chain to activate it instead.');
  return discardBatch(db,id);
 }
 if(action==='token-sync'){
  try{return {log:await autoTokenSeasons(db,chain)};}
  catch(err){if(err?.status)throw err;fail(503,'Could not reach Robinhood Chain. Try again.');}
 }
 fail(400,'Unknown token action.');
}

// What the member sees. null when the member has no jVYX allocation.
export async function memberTokens(db,userId){
 const rows=await db.q(`SELECT a.season,a.amount::text AS amount,c.address,c.proof,b.onchain_id,b.starts_at,b.tranches,b.interval_seconds,b.activated_at,
   EXISTS(SELECT 1 FROM user_wallets w WHERE w.user_id=a.user_id) AS has_wallet
  FROM token_allocations a LEFT JOIN token_batch_claims c ON c.season=a.season AND c.user_id=a.user_id LEFT JOIN token_batches b ON b.id=c.batch_id
  WHERE a.user_id=$1 ORDER BY a.season`,[userId]);
 if(!rows.length)return null;
 const chain=walletChain(),contracts=tokenContracts[chain.id]||null;
 return {...jvyx,chainId:chain.id,explorer:chain.explorer,token:contracts?.token||null,distributor:contracts?.distributor||null,claimFee:claimFeeWei.toString(),
  items:rows.map(r=>{
   const live=Boolean(r.activated_at&&contracts);
   return {season:r.season,label:tokenSeasons[r.season]?.label||r.season,amount:r.amount,
    status:live?'live':r.address||r.has_wallet?'pending':'needs-wallet',
    ...(live?{onchainId:r.onchain_id,address:checksumAddress(r.address),proof:r.proof,startsAt:iso(r.starts_at),tranches:r.tranches,intervalSeconds:r.interval_seconds}:{})};
  })};
}

// Timer task (vyx-token-seasons.timer): freeze every season that has closed and
// activate inactive batches whose root the owner has already added on-chain.
// chain = {readSeason(id), readSeasonCount()}. Returns log lines.
export async function autoTokenSeasons(db,chain,now=null){
 const at=await clock(db,now),log=[],chainId=walletChain().id;
 for(const [key,s] of Object.entries(tokenSeasons)){
  if(at<new Date(s.closesAt))continue;
  const [{n}]=await db.q('SELECT count(*)::int AS n FROM token_allocations WHERE season=$1',[key]);
  if(n)continue;
  const r=await computeAllocations(db,key,at);
  if(r.members)log.push(`Froze ${key}: ${r.members} members, ${(BigInt(r.allocated)/tokenUnit).toString()} of ${(BigInt(r.pool)/tokenUnit).toString()} jVYX.`);
 }
 const pending=await db.q('SELECT id,root FROM token_batches WHERE activated_at IS NULL AND chain_id=$1 ORDER BY id',[chainId]);
 if(!pending.length||!tokenContracts[chainId])return log;
 const used=new Set((await db.q('SELECT onchain_id FROM token_batches WHERE onchain_id IS NOT NULL AND chain_id=$1',[chainId])).map(r=>r.onchain_id));
 const count=await chain.readSeasonCount();
 for(let i=0;i<count&&pending.length;i++){
  if(used.has(i))continue;
  const s=await chain.readSeason(i),k=pending.findIndex(p=>p.root===String(s.root).toLowerCase());
  if(k<0)continue;
  try{await activateBatch(db,pending[k].id,i,async()=>s,at);log.push(`Batch ${pending[k].id} is live as on-chain season ${i}.`);pending.splice(k,1);}
  catch(err){log.push(`Batch ${pending[k].id} matches season ${i} by root but not by schedule or total: ${err.message}`);}
 }
 return log;
}
