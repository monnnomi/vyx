// Disposable PostgreSQL schema only; never writes VYX public tables or real member balances.
import postgres from 'postgres';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {mutate} from '../server/service.js';
import {settleDueWindows} from '../server/farming.js';
const sql=postgres(process.env.DATABASE_URL,{max:6,ssl:'require',prepare:false,connect_timeout:15,onnotice:()=>{}});
const awaitSchema=await readFile(new URL('../db/schema.sql',import.meta.url),'utf8');
const name='qa_farming_'+randomUUID().replaceAll('-','');let now='2026-11-06T00:01Z';
const wrap=t=>({q:async(s,v=[])=>{const a=[...v];if(s.includes('clock_timestamp()')){a.push(now);s=s.replaceAll('clock_timestamp()',`$${a.length}::timestamptz`);}return t.unsafe(s,a);},tx:fn=>fn(wrap(t))});
const transaction=fn=>sql.begin(async t=>{await t.unsafe(`SET LOCAL search_path TO ${name}`);return fn(wrap(t));});
const db={q:(s,v)=>transaction(t=>t.q(s,v)),tx:transaction};
try{
 await sql.unsafe(`CREATE SCHEMA ${name}`);
 await sql.begin(async t=>{await t.unsafe(`SET LOCAL search_path TO ${name}`);await t.unsafe(awaitSchema);});
 await transaction(async t=>{
  await t.q("UPDATE farm_rule_versions SET starts_at='2026-11-02' WHERE version=2");
  await t.q("UPDATE farm_windows SET rule_version=2,settled_at=CASE WHEN ends_at<='2026-11-06' THEN '2026-11-06'::timestamptz END");
 });
 const make=async n=>(await db.q('INSERT INTO users(x_id,handle,name) VALUES($1,$2,$2) RETURNING *',[n,'qa_'+n]))[0];
 const a=await make('100001'),b=await make('100002');
 const room=async(u,name)=>(await mutate(db,u,'room-create',{name,requestId:randomUUID()})).id;
 const ar=await room(a,'Isolated Alpha'),br=await room(b,'Isolated Beta');
 // Hypothetical 500% multiplier only inside this disposable schema; not a published NFT rate.
 await db.q("INSERT INTO farm_account_rounds(window_start,user_id,multiplier_ppm,snapshot_ref) VALUES('2026-11-06',$1,5000000,'isolated-hypothetical-fixture')",[a.id]);
 await Promise.all([
  mutate(db,a,'room-send',{id:ar,body:'The garden outside our office offers a beautiful place for lunch together.',requestId:randomUUID()}),
  mutate(db,b,'room-send',{id:br,body:'I watched a fascinating documentary about ancient cities beneath the ocean.',requestId:randomUUID()})
 ]);
 now='2026-11-06T04:00Z';
 await Promise.all([settleDueWindows(db),settleDueWindows(db),settleDueWindows(db)]);
 const [w]=await db.q("SELECT budget,released_budget,awarded FROM farm_windows WHERE starts_at='2026-11-06'");
 const [aSum]=await db.q('SELECT count(*)::int AS n,sum(amount)::bigint AS total FROM farm_awards');
 const [p]=await db.q("SELECT spent FROM farm_pools WHERE id='season-1'");
 assert.equal(aSum.n,2);assert.equal(Number(w.released_budget),Math.floor(Number(w.budget)*2/100));
 assert.equal(Number(aSum.total),Number(w.awarded));assert.equal(Number(p.spent),Number(aSum.total));
 const awards=await db.q('SELECT user_id,amount FROM farm_awards');
 assert.equal(Number(awards.find(r=>r.user_id===a.id).amount),Math.floor(Number(w.released_budget)*5/6));
 assert.equal(Number(awards.find(r=>r.user_id===b.id).amount),Math.floor(Number(w.released_budget)/6));
 const [promo]=await db.q("SELECT spent FROM farm_pools WHERE id='promotions'");assert.equal(Number(promo.spent),0);
 console.log('PASS: concurrent PostgreSQL writes and three simultaneous settlements; 500%/100% weighted shares, exactly two receipts, one pool debit, reserve untouched.');
}finally{
 await sql.unsafe(`DROP SCHEMA IF EXISTS ${name} CASCADE`);await sql.end({timeout:5});
 console.log('Disposable farming test schema removed.');
}
