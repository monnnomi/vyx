import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {mutate} from '../server/service.js';
import {roomFarming,farmingOverview,settleDueWindows,currentActivity} from '../server/farming.js';
import {dropResults,dropResult,revealDrop} from '../server/drops.js';
import {createFarmCronHandler} from '../api/farm-cron.js';
import {analyzeContribution,nearDuplicate,eventRetentionPPM,releasedQuota,weightedAward,milestones,nftMultiplierPPM} from '../server/farming-policy.js';
const schema=await readFile(new URL('../db/schema.sql',import.meta.url),'utf8');
const texts=[
 'The garden outside our office has become a wonderful place to share lunch together.',
 'Last night I watched an incredible documentary about the ancient cities beneath the ocean.',
 'My favourite recipe combines roasted vegetables with fresh herbs and a homemade lemon dressing.',
 'Designing accessible navigation means testing every keyboard interaction before shipping the interface.',
 'We could organise a local concert where young musicians perform their original compositions.',
 'The mountains looked beautiful after sunrise as clouds drifted slowly through the valley.',
 'Learning another language has helped me understand unfamiliar traditions and meet interesting people.',
 'Our library needs volunteers to repair damaged books and catalogue the historical manuscripts.',
 'Electric trains offer a practical alternative for travellers exploring nearby coastal towns.',
 'Children asked thoughtful questions during the museum workshop about planets and distant stars.',
 'A photographer captured migrating birds resting beside the river during the autumn afternoon.'
];
async function fixture(t){
 const pg=new PGlite();t.after(()=>pg.close());await pg.exec(schema);
 await pg.exec("UPDATE farm_rule_versions SET starts_at='2026-11-02T00:00:00Z' WHERE version=2; UPDATE farm_windows SET rule_version=2 WHERE starts_at>='2026-11-02'; UPDATE farm_windows SET settled_at='2026-11-06' WHERE ends_at<='2026-11-06'");
 let now='2026-11-06T00:01:00Z';
 const wrap=p=>({q:async(s,v=[])=>{const a=[...v];if(s.includes('clock_timestamp()')){a.push(now);s=s.replaceAll('clock_timestamp()',`$${a.length}::timestamptz`);}return (await p.query(s,a)).rows;},tx:fn=>p.transaction(x=>fn(wrap(x)))}),db=wrap(pg);
 const make=async n=>(await db.q('INSERT INTO users(x_id,handle,name) VALUES($1,$2,$2) RETURNING *',[n,'v2_'+n]))[0];
 const alice=await make('4001'),bob=await make('4002');
 const r=(await mutate(db,alice,'room-create',{name:'Fair drop circle',requestId:randomUUID()})).id;
 const s=(await mutate(db,alice,'room-create',{name:'Another circle',requestId:randomUUID()})).id;
 await mutate(db,bob,'room-join',{id:r});
 const send=(u,body,id=r)=>mutate(db,u,'room-send',{id,body,requestId:randomUUID()});
 const row=async(q,args=[])=>(await db.q(q,args))[0];
 return {pg,db,alice,bob,r,s,send,row,setTime:v=>now=v};
}
test('v2 releases 1% for one active account; final receipts, reveal and rerun never pay twice',async t=>{
 const f=await fixture(t);assert.equal((await f.send(f.alice,texts[0])).farming.counted,true);
 const overview=await farmingOverview(f.db,f.alice),activity=await currentActivity(f.db,f.alice.id,overview.current);
 const q=overview.current.budget;assert.equal(activity.releasedBudget,Math.floor(q/100));assert.equal(activity.estimate,Math.floor(q/100));
 f.setTime('2026-11-06T04:00:00Z');await settleDueWindows(f.db);
 const result=await dropResult(f.db,f.alice,'2026-11-06T00:00:00Z');
 assert.equal(result.amount,Math.floor(q/100));assert.equal(result.ruleVersion,2);assert.equal(result.weight,1);assert.equal(result.participants,1);
 await revealDrop(f.db,f.alice,result.id);await revealDrop(f.db,f.alice,result.id);await settleDueWindows(f.db);
 assert.equal((await f.row('SELECT count(*)::int AS n FROM farm_awards')).n,1);
 assert.equal((await f.row("SELECT spent FROM farm_pools WHERE id='season-1'")).spent,result.amount);
 // Additive migrations cannot move the announced date or rewrite an existing receipt.
 const date=(await f.row('SELECT starts_at FROM farm_rule_versions WHERE version=2')).starts_at;
 await f.pg.exec(schema);assert.equal((await dropResult(f.db,f.alice,result.id)).amount,result.amount);
 assert.deepEqual((await f.row('SELECT starts_at FROM farm_rule_versions WHERE version=2')).starts_at,date);
});
test('five full plus five half-weight messages share one cross-room cap; deletion cannot reset a slot',async t=>{
 const f=await fixture(t);let first;
 for(let i=0;i<10;i++){
  const minute=i<8?1+i*5:61+(i-8)*5;f.setTime(new Date(Date.parse('2026-11-06T00:00Z')+minute*60000).toISOString());
  const m=await f.send(f.alice,texts[i],i%2?f.s:f.r);if(i===0)first=m;
  assert.equal(m.farming.counted,true);assert.equal(m.farming.weight,i<5?1:.5);
 }
 f.setTime('2026-11-06T01:11:00Z');assert.equal((await f.send(f.alice,texts[10])).farming.counted,false);
 await mutate(f.db,f.alice,'room-delete-message',{id:f.r,messageId:first.id});
 assert.equal((await f.send(f.alice,texts[10])).farming.counted,false);
 const d=await dropResults(f.db,f.alice);assert.equal(d.activity.used,10);assert.equal(d.activity.weight,6.5);assert.equal(d.activity.rooms,2);
 assert.equal((await f.row('SELECT count(*)::int AS n FROM room_messages')).n,12);
});
test('numeric variants, recent near-copies and cross-account copied text stay in chat without VP',async t=>{
 const f=await fixture(t);await f.send(f.alice,texts[0]);f.setTime('2026-11-06T00:06:00Z');
 assert.equal((await f.send(f.alice,texts[0]+' 123')).farming.counted,false);
 assert.equal((await f.send(f.alice,texts[0]+' Really.')).farming.counted,false);
 assert.equal((await f.send(f.bob,texts[0])).farming.counted,false);
 assert.equal((await f.send(f.bob,texts[1])).farming.counted,true);
 f.setTime('2026-11-06T00:07:00Z');assert.equal((await f.send(f.alice,texts[2],f.s)).farming.counted,true);
 f.setTime('2026-11-06T00:08:00Z');assert.equal((await f.send(f.alice,texts[3],f.r)).farming.counted,false);
 assert.equal((await f.row('SELECT count(*)::int AS n FROM room_messages')).n,7);
 assert.equal((await f.row('SELECT count(*)::int AS n FROM farm_contributions')).n,3);
});
test('global participation counts one account once across rooms and weighted division preserves every share',async t=>{
 const f=await fixture(t);await f.send(f.alice,texts[0]);await f.send(f.bob,texts[1]);
 f.setTime('2026-11-06T00:06:00Z');await f.send(f.alice,texts[2],f.s);
 const room=await roomFarming(f.db,f.alice,f.r);assert.equal(room.room.activity.participants,2);assert.equal(room.room.activity.global,3);
 const release=Math.floor(room.current.budget*2/100);assert.equal(room.room.estimate,Math.floor(release/3));
 f.setTime('2026-11-06T04:00:00Z');await settleDueWindows(f.db);
 const awards=await f.db.q('SELECT user_id,amount FROM farm_awards');assert.equal(awards.length,3);
 assert.ok(awards.every(r=>r.amount===Math.floor(release/3)));
 assert.ok(awards.reduce((n,r)=>n+r.amount,0)<=release);
 assert.equal((await f.row("SELECT spent FROM farm_pools WHERE id='promotions'")).spent,0);
});
test('100 participating accounts unlock the maximum; future coefficients reduce issuance without redistribution',async t=>{
 const f=await fixture(t);await f.send(f.alice,texts[0]);
 await f.db.q("INSERT INTO users(x_id,handle,name) SELECT 'batch_'||n,'batch_'||n,'Fixture' FROM generate_series(1,99) n");
 await f.db.q(`WITH messages AS (INSERT INTO room_messages(room_id,sender_id,body,request_id) SELECT $1,id,'Isolated contribution fixture',gen_random_uuid() FROM users WHERE handle LIKE 'batch_%' RETURNING id,sender_id AS user_id)
 INSERT INTO farm_contributions(message_id,room_id,user_id,window_start,content_hash,slot,units,created_at,base_units,multiplier_ppm)
 SELECT id,$1,user_id,'2026-11-06','unique_'||user_id,1,128,'2026-11-06T00:01Z',128,850000 FROM messages`,[f.r]);
 const o=await farmingOverview(f.db,f.alice),a=await currentActivity(f.db,f.alice.id,o.current);assert.equal(a.participants,100);assert.equal(a.releasedBudget,o.current.budget);
 f.setTime('2026-11-06T04:00:00Z');await settleDueWindows(f.db);
 const awards=await f.db.q('SELECT user_id,amount FROM farm_awards');assert.equal(awards.find(r=>r.user_id===f.alice.id).amount,Math.floor(o.current.budget/100));
 assert.ok(awards.filter(r=>r.user_id!==f.alice.id).every(r=>r.amount===Math.floor(o.current.budget*.85/100)));
 assert.ok(awards.reduce((n,r)=>n+r.amount,0)<o.current.budget);
});
test('milestone qualification needs three distinct settled UTC days; no NFT reductions are activated',async t=>{
 const f=await fixture(t);
 for(let i=0;i<3;i++){
  f.setTime(`2026-11-0${6+i}T00:01:00Z`);await f.send(f.alice,texts[i]);
  assert.equal((await farmingOverview(f.db,f.alice)).qualifiedFarmers,0);
  f.setTime(`2026-11-0${6+i}T04:00:00Z`);await settleDueWindows(f.db);
 }
 const o=await farmingOverview(f.db,f.alice);assert.equal(o.qualifiedFarmers,1);
 await f.db.q("INSERT INTO users(x_id,handle,name) SELECT 'qualified_'||n,'qualified_'||n,'Fixture' FROM generate_series(1,100) n");
 await f.db.q("INSERT INTO farm_farmers(user_id,x_id,qualified_at) SELECT id,x_id,'2026-11-08' FROM users WHERE handle LIKE 'qualified_%'");
 const reached=await farmingOverview(f.db,f.alice);assert.ok(reached.milestones[0].reached);assert.equal(reached.retention,1);assert.equal(reached.nftStatus,'planned');assert.equal(reached.eventReductionsEnabled,false);
 f.setTime('2026-11-08T04:01:00Z');assert.equal((await f.send(f.alice,texts[4])).farming.retention,1);
});
test('pool exhaustion and empty rounds never spend promotion VP or exceed the season balance',async t=>{
 const f=await fixture(t);await f.db.q("UPDATE farm_pools SET spent=budget-7 WHERE id='season-1'");await f.send(f.alice,texts[0]);
 f.setTime('2026-11-06T08:00:00Z');await settleDueWindows(f.db);
 assert.equal((await f.row("SELECT sum(amount)::bigint AS n FROM farm_awards")).n,0);
 assert.equal((await f.row("SELECT spent FROM farm_pools WHERE id='season-1'")).spent,349999993);
 assert.equal((await f.row("SELECT awarded FROM farm_windows WHERE starts_at='2026-11-06T04:00Z'")).awarded,0);
 assert.equal((await f.row("SELECT spent FROM farm_pools WHERE id='promotions'")).spent,0);
});
test('base event retention restores each edition independently of additional per-copy NFT boosts',()=>{
 assert.equal(eventRetentionPPM([100,250],[]),722500);assert.equal(eventRetentionPPM([100,250],[100]),850000);
 assert.equal(eventRetentionPPM(milestones,milestones),1000000);assert.equal(eventRetentionPPM([100,250],[100,100]),850000);
 assert.equal(eventRetentionPPM(milestones,[]),320577);
 assert.equal(releasedQuota(10000,1),100);assert.equal(releasedQuota(10000,101),10000);assert.equal(weightedAward(1,1,'0'),0);
 const a=analyzeContribution(texts[0]);assert.equal(a.canonical,analyzeContribution(texts[0]+' 100').canonical);
 assert.ok(nearDuplicate(a.tokens,analyzeContribution(texts[0]+' Really').tokens));assert.ok(!nearDuplicate(a.tokens,analyzeContribution(texts[1]).tokens));
});
test('six daily UTC cron triggers share the authenticated, idempotent settlement handler',async t=>{
 const f=await fixture(t),config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
 const farmCrons=config.crons.filter(c=>c.path.startsWith('/api/farm-cron/'));
 assert.deepEqual(farmCrons.map(c=>c.schedule),[0,4,8,12,16,20].map(h=>`0 ${h} * * *`));
 assert.equal(new Set(farmCrons.map(c=>c.path)).size,6);
 const h=createFarmCronHandler(fn=>fn(f.db));process.env.CRON_SECRET='local-cron-fixture';
 const call=async authorization=>{const res={setHeader(){},end(s){this.body=JSON.parse(s);}};await h({method:'GET',url:'/api/farm-cron/04',headers:{authorization}},res);return res;};
 assert.equal((await call('Bearer wrong')).statusCode,401);
 assert.equal((await f.row('SELECT last_completed_at FROM farm_scheduler_state')).last_completed_at,null);
 await f.send(f.alice,texts[0]);f.setTime('2026-11-06T04:00Z');assert.equal((await call('Bearer local-cron-fixture')).statusCode,200);
 const one=await f.row("SELECT spent FROM farm_pools WHERE id='season-1'");await call('Bearer local-cron-fixture');assert.deepEqual(await f.row("SELECT spent FROM farm_pools WHERE id='season-1'"),one);
 assert.ok((await f.row('SELECT last_completed_at FROM farm_scheduler_state')).last_completed_at);
});

test('hypothetical NFT bonuses stack per copy above 100%, with no default bonus schedule or personal ceiling',()=>{
 // These rates exercise the user's example; they are not production NFT rates.
 assert.equal(nftMultiplierPPM([100],[{event:100,quantity:10}],{100:400000}),5000000n);
 assert.equal(nftMultiplierPPM([100],[{event:100,quantity:6},{event:100,quantity:4}],{100:400000}),5000000n);
 assert.equal(nftMultiplierPPM([100,250],[{event:100,quantity:2},{event:250,quantity:3}],{100:100000,250:200000}),1800000n);
 assert.equal(nftMultiplierPPM([100],[{event:100,quantity:'9007199254740993'}],{100:400000}),1000000n+9007199254740993n*400000n);
 assert.equal(nftMultiplierPPM([],[]),1000000n);
 assert.throws(()=>nftMultiplierPPM([100],[{event:100,quantity:10}]),/not configured/);
 for(const quantity of [-1,1.5,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>nftMultiplierPPM([100],[{event:100,quantity}],{100:400000}),RangeError);
});
test('boosted global weights keep the shared fund bounded, using exact division beyond JS integer precision',()=>{
 assert.equal(weightedAward(1000000,640000000,256,768000000),833333);
 assert.equal(weightedAward(1000000,128000000,256,768000000),166666);
 // Below-baseline penalties keep the original unboosted denominator.
 assert.equal(weightedAward(1000000,64000000,256,128000000),250000);
 assert.equal(weightedAward(350000000,9007199254740992n,1,18014398509481985n),174999999);
});
test('500% snapshot contributes five times the weight and remains usable across estimates, receipts and migration',async t=>{
 const f=await fixture(t);
 await f.db.q("INSERT INTO farm_account_rounds(window_start,user_id,multiplier_ppm,nft_holdings,snapshot_ref) VALUES('2026-11-06',$1,5000000,'{\"100\":10}','isolated-hypothetical-fixture')",[f.alice.id]);
 const accepted=await f.send(f.alice,texts[0]);assert.equal(accepted.farming.retention,5);assert.equal(accepted.farming.coefficientPPM,'5000000');
 await f.send(f.bob,texts[1]);
 const a=await roomFarming(f.db,f.alice,f.r),b=await roomFarming(f.db,f.bob,f.r),release=a.room.activity.releasedBudget;
 assert.equal(a.retention,5);assert.equal(a.coefficientPPM,'5000000');assert.equal(a.room.estimate,Math.floor(release*5/6));assert.equal(b.room.estimate,Math.floor(release/6));
 assert.equal(a.nftPolicy.multiplierCap,null);assert.equal(a.nftPolicy.duplicateCopiesStack,true);assert.equal(a.nftPolicy.perTokenBonuses,null);assert.equal(a.nftStatus,'planned');
 f.setTime('2026-11-06T04:00Z');await settleDueWindows(f.db);await settleDueWindows(f.db);
 const ar=await dropResult(f.db,f.alice,'2026-11-06T00:00Z'),br=await dropResult(f.db,f.bob,'2026-11-06T00:00Z');
 assert.equal(ar.effectiveWeight,5);assert.equal(ar.weight,1);assert.equal(ar.amount,a.room.estimate);assert.equal(br.amount,b.room.estimate);assert.ok(ar.amount+br.amount<=release);
 await f.pg.exec(schema);assert.equal((await dropResult(f.db,f.alice,ar.id)).amount,ar.amount);
 assert.equal((await f.row("SELECT multiplier_ppm::text AS value FROM farm_account_rounds WHERE user_id=$1",[f.alice.id])).value,'5000000');
 assert.equal((await f.row("SELECT spent FROM farm_pools WHERE id='promotions'")).spent,0);
});
test('equal stacked boosts split fairly; numeric storage accepts weights beyond bigint without overspending',async t=>{
 const f=await fixture(t),huge='9007199254740993000000000';
 for(const user of [f.alice,f.bob])await f.db.q("INSERT INTO farm_account_rounds(window_start,user_id,multiplier_ppm) VALUES('2026-11-06',$1,$2)",[user.id,huge]);
 await f.send(f.alice,texts[0]);await f.send(f.bob,texts[1]);
 const a=await roomFarming(f.db,f.alice,f.r),release=a.room.activity.releasedBudget;assert.equal(a.coefficientPPM,huge);
 assert.equal(a.room.estimate,Math.floor(release/2));assert.equal(a.room.activity.globalEffectiveUnits,(BigInt(huge)*256n).toString());
 f.setTime('2026-11-06T04:00Z');await settleDueWindows(f.db);
 const awards=await f.db.q('SELECT amount,effective_units::text AS effective FROM farm_awards');
 assert.ok(awards.every(r=>r.amount===Math.floor(release/2)));assert.ok(awards.every(r=>r.effective===(BigInt(huge)*128n).toString()));
 for(const bad of ['-1','1000000.5'])await assert.rejects(f.db.q("UPDATE farm_account_rounds SET multiplier_ppm=$2 WHERE user_id=$1",[f.alice.id,bad]),e=>e.code==='23514');
});
