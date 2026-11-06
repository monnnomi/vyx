import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {mutate,state} from '../server/service.js';
import {halloweenState} from '../server/events.js';

const pg=new PGlite();
const schema=await readFile(new URL('../db/schema.sql',import.meta.url),'utf8');
await pg.exec(schema);await pg.exec(schema);
const adapter=(p,time)=>({q:async(sql,params=[])=>{
 if(time&&sql.includes('clock_timestamp()')){sql=sql.replaceAll('clock_timestamp()',`($${params.length+1}::timestamptz)`);params=[...params,time];}
 return (await p.query(sql,params)).rows;
},tx:fn=>p.transaction(tx=>fn(adapter(tx,time)))});
const db=adapter(pg),at=time=>adapter(pg,time);
let sequence=8000;
const make=async n=>(await db.q('INSERT INTO users(x_id,handle,name) VALUES($1,$2,$2) RETURNING *',[String(++sequence),'halloween_'+n]))[0];
const before=new Date('2026-10-31T23:59:59.999Z'),cutoff=new Date('2026-11-01T00:00:00.000Z');
after(()=>pg.close());
const rejects=(promise,status)=>assert.rejects(promise,e=>e.status===status);

test('one free collectible mint per immutable X account, without points or quests',async()=>{
 const user=await make('free');
 const r=await mutate(at(before),user,'mint-event',{endsAt:'2099-01-01',x_id:'forged'},before);
 assert.equal(r.campaign_id,'halloween-2026');assert.ok(r.id);assert.ok(!('amount' in r));
 const s=await state(at(before),user,before);assert.equal(s.event.minted,true);assert.equal(s.event.mintId,r.id);assert.equal(s.event.status,'active');assert.ok(!('amount' in s.event));
 assert.deepEqual(s.user.inventory,[0,0,0,0]);assert.equal(s.user.points,0);assert.equal(s.user.all_points,0);
 await db.q('UPDATE users SET x_username=$2,name=$3 WHERE id=$1',[user.id,'renamed','Renamed member']);
 await rejects(mutate(at(before),user,'mint-event',{},before),409);
 await rejects(mutate(at(before),user,'claim-event',{},before),409);
 assert.equal((await db.q('SELECT count(*)::int AS n FROM event_mints WHERE user_id=$1',[user.id]))[0].n,1);
 assert.equal((await db.q('SELECT count(*)::int AS n FROM point_ledger WHERE user_id=$1',[user.id]))[0].n,0);
 assert.equal((await db.q('SELECT count(*)::int AS n FROM chests WHERE user_id=$1',[user.id]))[0].n,0);
});
test('mint requires an actual connected X identity even if the request supplies another ID',async()=>{
 const [unlinked]=await db.q("INSERT INTO users(handle,name) VALUES('unlinked','Unlinked user') RETURNING *");
 await rejects(mutate(at(before),unlinked,'mint-event',{x_id:'1278381930736750598'},before),403);
});
test('database rejects mint exactly at midnight UTC and afterwards',async()=>{
 for(const [suffix,time] of [['exact',cutoff],['after',new Date('2026-11-01T00:00:00.001Z')]]){
  const user=await make(suffix);
  await rejects(mutate(at(time),user,'mint-event',{now:'2026-10-30',endsAt:'2099-01-01'},before),410);
  assert.equal((await db.q('SELECT count(*)::int AS n FROM event_mints WHERE user_id=$1',[user.id]))[0].n,0);
 }
});
test('mint closes before start, reports server time, and never permits opening for points',async()=>{
 const user=await make('closed'),time=new Date('2026-10-29T23:59:59.999Z');
 await rejects(mutate(at(time),user,'mint-event',{},before),410);
 const guest=await halloweenState(at(cutoff),null);assert.equal(guest.status,'ended');assert.equal(guest.serverNow,cutoff.toISOString());assert.equal(guest.minted,false);
 await mutate(at(before),user,'mint-event',{},before);
 await rejects(mutate(at(before),user,'open-event',{requestId:randomUUID()},before),410);
 await rejects(mutate(at(before),user,'open',{tier:2,requestId:randomUUID()},before),409);
 assert.equal((await halloweenState(at(cutoff),user)).minted,true);
});
test('migration preserves an old claim and audit receipt while removing only its Halloween points',async()=>{
 const user=await make('legacy');
 const [claim]=await db.q("INSERT INTO quest_claims(user_id,season,quest,period) VALUES($1,'halloween-2026','halloween-2026','once') RETURNING id",[user.id]);
 const [chest]=await db.q("INSERT INTO chests(user_id,claim_id,season,tier,campaign_id,opened_at) VALUES($1,$2,'early-access',2,'halloween-2026',now()) RETURNING id",[user.id,claim.id]);
 await db.q("INSERT INTO point_ledger(user_id,season,chest_id,amount) VALUES($1,'early-access',$2,777)",[user.id,chest.id]);
 const requestId=randomUUID();await db.q('INSERT INTO open_receipts(user_id,request_id,chest_id,amount) VALUES($1,$2,$3,777)',[user.id,requestId,chest.id]);
 await pg.exec(schema);await pg.exec(schema);
 const s=await state(at(before),user,before);assert.equal(s.event.minted,true);assert.equal(s.user.all_points,0);assert.equal(s.user.history.length,0);
 const [audit]=await db.q('SELECT amount,voided_at,void_reason FROM point_ledger WHERE chest_id=$1',[chest.id]);assert.equal(audit.amount,777);assert.ok(audit.voided_at);assert.ok(audit.void_reason);
 assert.equal((await db.q('SELECT count(*)::int AS n FROM open_receipts WHERE user_id=$1',[user.id]))[0].n,1);
 assert.equal((await db.q('SELECT count(*)::int AS n FROM event_mints WHERE user_id=$1',[user.id]))[0].n,1);
 await rejects(mutate(at(before),user,'mint-event',{},before),409);
});
