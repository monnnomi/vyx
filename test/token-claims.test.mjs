import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {PGlite} from '@electric-sql/pglite';
import {login} from '../server/oauth.js';
import {state} from '../server/service.js';
import {verifyClaim} from '../server/merkle.js';
import {splitPool,computeAllocations,createBatch,activateBatch,discardBatch,memberTokens,migrateTokens,decodeSeason,seasonsCallData,tokenUnit,autoTokenSeasons} from '../server/token-claims.js';

process.env.VYX_APP_SECRET||='token-test-secret';process.env.PUBLIC_APP_URL='https://joinvyx.com';delete process.env.VYX_CHAIN_ID;
const pg=new PGlite();await pg.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
const wrap=p=>({q:async(s,v=[])=>(await p.query(s,v)).rows,tx:fn=>p.transaction(tx=>fn(wrap(tx)))}),db=wrap(pg);after(()=>pg.close());
let seq=0;
async function member(createdAt){const n=++seq;const {user}=await db.tx(tx=>login(tx,{id:String(88000+n),username:'tok_'+n,name:'Token '+n,avatar:''}));await db.q('UPDATE users SET created_at=$2 WHERE id=$1',[user.id,createdAt]);return user;}
async function vp(user,amount,season,at){await db.q('INSERT INTO x_task_awards(user_id,x_id,task_id,season,amount,proof_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[user.id,user.x_id,'t'+(++seq),season,amount,'p',at]);}
async function wallet(user,address){await db.q("INSERT INTO user_wallets(user_id,address,chain_id,message,signature) VALUES($1,$2,4663,'m','0x00')",[user.id,address]);}
const addr=i=>'0x'+i.toString(16).padStart(40,'0');

test('pools split exactly: half equal and half by VP for early members, all by VP for seasons',()=>{
 const rows=[{user_id:'a',vp:100},{user_id:'b',vp:300}];
 const early=splitPool(10n,rows,'early'),byVP=splitPool(10n,rows,'vp');
 assert.deepEqual(early.map(r=>r.amount),[375n*tokenUnit/100n,625n*tokenUnit/100n]);
 assert.deepEqual(byVP.map(r=>r.amount),[10n*tokenUnit/4n,30n*tokenUnit/4n]);
 assert.ok(early.reduce((s,r)=>s+r.amount,0n)<=10n*tokenUnit);
 assert.deepEqual(splitPool(10n,[],'vp'),[]);
});

test('early-member allocations freeze at the snapshot and ignore later members and later VP',async()=>{
 const old=await member('2026-11-01T00:00:00Z'),active=await member('2026-11-10T00:00:00Z'),late=await member('2026-11-22T00:00:01Z'),idle=await member('2026-11-05T00:00:00Z');
 await vp(old,1000,'season-1','2026-11-02T00:00:00Z');await vp(old,500,'season-1','2026-11-23T00:00:00Z');
 await vp(active,2000,'season-1','2026-11-21T23:00:00Z');await vp(late,2000,'season-1','2026-11-23T00:00:00Z');
 await assert.rejects(computeAllocations(db,'early-members','2026-11-21T12:00:00Z'),/closes at/);
 const r=await computeAllocations(db,'early-members','2026-11-22T00:00:00Z');
 assert.equal(r.members,2);assert.equal(r.totalVP,'3000');
 const rows=await db.q("SELECT user_id,amount::text AS amount,basis_vp FROM token_allocations WHERE season='early-members' ORDER BY basis_vp");
 const half=5_000_000n*tokenUnit;
 assert.deepEqual(rows.map(x=>[x.user_id,BigInt(x.amount)]),[[old.id,half/2n+half*1000n/3000n],[active.id,half/2n+half*2000n/3000n]]);
 assert.ok(BigInt(r.allocated)<=10_000_000n*tokenUnit);
 await assert.rejects(computeAllocations(db,'early-members','2026-11-30T00:00:00Z'),/already frozen/);
 assert.equal(await memberTokens(db,idle.id),null);
 const view=await memberTokens(db,old.id);assert.equal(view.items[0].status,'needs-wallet');assert.equal(view.symbol,'jVYX');
 assert.equal(view.distributor,'0x431a9fa69f4c42ee85d7dbbcea0460856468bd16');assert.equal(view.claimFee,'20000000000000');
 const own=(await state(db,old)).user;assert.equal(own.tokens.items[0].amount,rows[0].amount);

 // Batch 1: only members with a wallet. Proofs verify against the root.
 await wallet(old,addr(0xa1));
 assert.equal((await memberTokens(db,old.id)).items[0].status,'pending');
 const b1=await createBatch(db,'early-members',{startsAt:'2026-11-25T00:00:00Z'});
 assert.equal(b1.members,1);assert.equal(b1.tranches,90);assert.equal(b1.intervalSeconds,86400);assert.equal(b1.start,Date.parse('2026-11-25T00:00:00Z')/1000);
 const [c1]=await db.q('SELECT * FROM token_batch_claims WHERE batch_id=$1',[b1.id]);
 assert.ok(verifyClaim(b1.root,c1.address,c1.allocation,c1.proof));
 await assert.rejects(createBatch(db,'early-members'),/No members with a linked wallet/);

 // Activation must match what the owner published on-chain.
 const onchain={root:b1.root,total:BigInt(b1.total),claimed:0n,start:BigInt(b1.start),interval:86400n,tranches:90n};
 await assert.rejects(activateBatch(db,b1.id,0,async()=>({...onchain,total:onchain.total+1n})),/total/);
 assert.deepEqual(await activateBatch(db,b1.id,0,async id=>{assert.equal(id,0);return onchain;}),{id:b1.id,onchainId:0});
 await assert.rejects(activateBatch(db,b1.id,0,async()=>onchain),/already active/);
 await assert.rejects(discardBatch(db,b1.id),/inactive/);
 const live=(await memberTokens(db,old.id)).items[0];
 assert.equal(live.status,'live');assert.equal(live.onchainId,0);assert.equal(live.address.toLowerCase(),addr(0xa1));assert.deepEqual(live.proof,c1.proof);

 // A member who links later joins a new batch on the same unlock schedule.
 await wallet(active,addr(0xb2));
 const b2=await createBatch(db,'early-members',{startsAt:'2027-01-01T00:00:00Z',tranches:1});
 assert.equal(b2.start,b1.start);assert.equal(b2.tranches,90);assert.equal(b2.members,1);
 await discardBatch(db,b2.id);
 assert.equal((await createBatch(db,'early-members')).members,1);
});

test('season allocations use only that season’s VP and wait for the season to close',async()=>{
 const a=await member('2026-10-20T00:00:00Z');
 await vp(a,700,'early-access','2026-10-25T00:00:00Z');await vp(a,900,'season-2','2026-12-05T00:00:00Z');
 await assert.rejects(computeAllocations(db,'season-2','2026-12-20T00:00:00Z'),/closes at/);
 const r=await computeAllocations(db,'season-2','2026-12-25T00:00:00Z');
 assert.equal(r.members,1);assert.equal(r.allocated,(35_000_000n*tokenUnit).toString());
 const s1=await computeAllocations(db,'season-1','2026-12-01T00:00:00Z');assert.equal(s1.totalVP,'5500'); // season-1 VP only; October early-access VP are rewarded by the early-member drop
 await migrateTokens(db);await migrateTokens(db);
});

test('seasons() results decode and the browser builds claim calldata the contract accepts',async()=>{
 const word=n=>BigInt(n).toString(16).padStart(64,'0');
 const root='0x'+'ab'.repeat(32);
 assert.deepEqual(decodeSeason('0x'+root.slice(2)+word(5)+word(1)+word(100)+word(86400)+word(90)),{root,total:5n,claimed:1n,start:100n,interval:86400n,tranches:90n});
 assert.equal(seasonsCallData(3),'0xf5d709a1'+word(3));
 const ctx={document:{addEventListener(){}},data:{},console};vm.createContext(ctx);
 vm.runInContext(await readFile(new URL('../public/token-claim.js',import.meta.url),'utf8'),ctx);
 const pA=['0x1ffd36cce091e06d3228f3c63bbd1e312ce8c448ae06b36d83945d6a4cec1d8e','0x742071670ef3f9fd572d50bd3209fbec74ea881bb937d66cc7bdf7fa58d5ca90'];
 const pC=['0x9145b34b1837fc1913ff81a550952a5d4fc1e2cf1c317474712dcc50481e92a5'];
 // Same value is asserted against abi.encodeCall in contracts/test/VYXDistributor.t.sol.
 const data=ctx.jvyxClaimCalldata([0,1],['1000000000000000000000','3000000000000000000000'],[pA,pC]);
 assert.equal(data,'0xe1021f44'+word(96)+word(192)+word(288)+word(2)+word(0)+word(1)+word(2)+word(1000n*tokenUnit)+word(3000n*tokenUnit)
  +word(2)+word(64)+word(160)+word(2)+pA.map(x=>x.slice(2)).join('')+word(1)+pC[0].slice(2));
 const item={amount:'900',startsAt:'2026-11-25T00:00:00Z',tranches:90,intervalSeconds:86400};
 assert.equal(ctx.jvyxUnlocked(item,Date.parse('2026-11-24T23:59:59Z')),0n);
 assert.equal(ctx.jvyxUnlocked(item,Date.parse('2026-11-25T00:00:00Z')),10n);
 assert.equal(ctx.jvyxUnlocked(item,Date.parse('2026-12-04T12:00:00Z')),100n);
 assert.equal(ctx.jvyxUnlocked(item,Date.parse('2027-03-01T00:00:00Z')),900n);
 assert.equal(ctx.jvyxFormat(1234567n*10n**16n),'12,345.67');
});

test('the season timer freezes closed seasons once and activates batches it finds on-chain',async()=>{
 const p2=new PGlite();await p2.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));const d2=wrap(p2);
 const {user}=await d2.tx(tx=>login(tx,{id:'99001',username:'auto_1',name:'Auto',avatar:''}));
 await d2.q("UPDATE users SET created_at='2026-11-01T00:00:00Z' WHERE id=$1",[user.id]);
 await d2.q("INSERT INTO x_task_awards(user_id,x_id,task_id,season,amount,proof_id,created_at) VALUES($1,$2,'a','season-1',50,'p','2026-11-05T00:00:00Z')",[user.id,user.x_id]);
 await d2.q("INSERT INTO user_wallets(user_id,address,chain_id,message,signature) VALUES($1,$2,4663,'m','0x00')",[user.id,addr(0xcc)]);
 const none={readSeasonCount:async()=>{throw new Error('no chain calls expected');},readSeason:async()=>{throw new Error('no');}};
 assert.deepEqual(await autoTokenSeasons(d2,none,'2026-11-21T23:59:00Z'),[]);
 const log=await autoTokenSeasons(d2,none,'2026-11-22T00:05:00Z');
 assert.equal(log.length,1);assert.match(log[0],/Froze early-members: 1 members, 10000000 of 10000000 jVYX/);
 assert.deepEqual(await autoTokenSeasons(d2,none,'2026-11-22T00:10:00Z'),[]);
 const b=await createBatch(d2,'early-members',{startsAt:'2026-11-23T00:00:00Z'});
 const other={root:'0x'+'11'.repeat(32),total:1n,claimed:0n,start:0n,interval:0n,tranches:1n};
 const mine={root:b.root,total:BigInt(b.total),claimed:0n,start:BigInt(b.start),interval:86400n,tranches:90n};
 const chain={readSeasonCount:async()=>2,readSeason:async i=>i===0?other:mine};
 assert.deepEqual(await autoTokenSeasons(d2,chain,'2026-11-22T00:15:00Z'),[`Batch ${b.id} is live as on-chain season 1.`]);
 assert.equal((await memberTokens(d2,user.id)).items[0].onchainId,1);
 assert.deepEqual(await autoTokenSeasons(d2,none,'2026-11-22T00:20:00Z'),[]);
 await p2.close();
});
