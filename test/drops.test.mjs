import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {mutate} from '../server/service.js';
import {settleDueWindows} from '../server/farming.js';
import {dropResults,dropResult,revealDrop,notifications,readNotifications} from '../server/drops.js';
import {createHandler} from '../api/vyx.js';
import {hash} from '../server/http.js';
const pg=new PGlite();await pg.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
let now='2026-11-01T00:01:00Z';
const wrap=p=>({q:async(s,v=[])=>{const params=[...v];if(s.includes('clock_timestamp()')){params.push(now);s=s.replaceAll('clock_timestamp()',`$${params.length}::timestamptz`);}return (await p.query(s,params)).rows;},tx:fn=>p.transaction(t=>fn(wrap(t)))}),db=wrap(pg);
const make=async n=>(await db.q('INSERT INTO users(x_id,handle,name) VALUES($1,$2,$2) RETURNING *',[n,'drop_'+n]))[0];
const a=await make('101'),b=await make('102');
const room=async name=>(await mutate(db,a,'room-create',{name,requestId:randomUUID()})).id;
const r1=await room('First room'),r2=await room('Second room');
const send=(r,body)=>mutate(db,a,'room-send',{id:r,body,requestId:randomUUID()});
await send(r1,'Thoughtful conversations help our community develop interesting new creative ideas.');
now='2026-11-01T00:06:00Z';await send(r2,'Sharing a different perspective can make this community a more welcoming place.');
after(()=>pg.close());
const rejected=(p,status)=>assert.rejects(p,e=>e.status===status);
const sum=async()=>Number((await db.q('SELECT sum(amount)::bigint AS n FROM reward_ledger WHERE user_id=$1',[a.id]))[0].n||0);

test('a drop is unavailable until settlement and cannot be read by another account',async()=>{
 await rejected(dropResult(db,a,'2026-11-01T00:00:00Z'),404);
 await rejected(revealDrop(db,a,'2026-11-01T00:00:00Z'),404);
 assert.equal((await db.q('SELECT count(*)::int AS n FROM drop_reveals'))[0].n,0);
 now='2026-11-01T04:00:00Z';await settleDueWindows(db);
 const result=await dropResult(db,a,'2026-11-01T00:00:00Z');
 assert.equal(result.status,'FINALIZED');assert.equal(result.rooms.length,2);assert.equal(result.activity,2);
 assert.equal(result.amount,result.rooms.reduce((n,r)=>n+r.amount,0));assert.equal(result.amount,await sum());
 await rejected(dropResult(db,b,result.id),404);await rejected(revealDrop(db,b,result.id),404);
 await rejected(dropResults(db,null),401);await rejected(dropResult(db,a,'invalid'),400);
});
test('old room awards form one personal round; opening is durable, idempotent and never credits points',async()=>{
 const d=await dropResults(db,a);assert.equal(d.results.length,1);assert.equal(d.results[0].rooms,2);
 assert.equal(d.summary.unopened,1);assert.equal(d.summary.total,await sum());assert.equal(d.summary.today,await sum());
 const balance=await sum(),id=d.results[0].id;
 const one=await revealDrop(db,a,id);now='2026-11-01T04:01:00Z';const two=await revealDrop(db,a,id);
 assert.equal(one.revealedAt,two.revealedAt);assert.equal(await sum(),balance);
 const fresh=await dropResults(db,a);assert.equal(fresh.summary.unopened,0);assert.equal(fresh.results[0].revealedAt,one.revealedAt);
 assert.equal((await db.q('SELECT count(*)::int AS n FROM drop_reveals'))[0].n,1);
});
test('history is cursor paginated without duplicating rounds; zero-point final results remain accessible',async()=>{
 now='2026-11-06T00:00:00Z';
 // Historical receipts fixture. Closed rounds can contain activity but no points (fund exhausted).
 for(let i=1;i<=23;i++){
  const id=new Date(Date.parse('2026-11-01T00:00:00Z')+i*14400000).toISOString();
  await db.q('UPDATE farm_windows SET settled_at=$2 WHERE starts_at=$1',[id,now]);
  await db.q('INSERT INTO room_drops(window_start,room_id,base_budget,awarded,activity,active_members) VALUES($1,$2,0,0,1,1)',[id,r1]);
  await db.q("INSERT INTO farm_awards(user_id,room_id,window_start,season,amount,activity,units) VALUES($1,$2,$3,'season-1',0,1,128)",[a.id,r1,id]);
 }
 const first=await dropResults(db,a),next=await dropResults(db,a,{before:first.nextBefore});
 assert.equal(first.results.length,20);assert.equal(next.results.length,4);
 assert.equal(new Set([...first.results,...next.results].map(r=>r.id)).size,24);
 assert.equal(first.results[0].amount,0);const before=await sum();
 assert.equal((await revealDrop(db,a,first.results[0].id)).amount,0);assert.equal(await sum(),before);
 await rejected(dropResults(db,a,{before:'nope'}),400);
});
test('notifications come from real events; read state is private and persisted',async()=>{
 await db.q('INSERT INTO follows(follower_id,following_id) VALUES($1,$2)',[b.id,a.id]);
 const [post]=await db.q('INSERT INTO posts(user_id,body) VALUES($1,$2) RETURNING id',[a.id,'An actual community story for checking comment notifications.']);
 await db.q('INSERT INTO comments(user_id,post_id,body) VALUES($1,$2,$3)',[b.id,post.id,'A real reply in this test.']);
 let n=await notifications(db,a);assert.ok(n.items.some(x=>x.kind==='drop'));assert.ok(n.items.some(x=>x.kind==='follow'));assert.ok(n.items.some(x=>x.kind==='comment'));
 assert.ok(n.items.some(x=>x.unread));
 // Move controlled clock beyond DB-created social timestamps for this acknowledgement.
 now='2027-01-01T00:00:00Z';await readNotifications(db,a);n=await notifications(db,a);assert.ok(n.items.every(x=>!x.unread));
 assert.equal((await notifications(db,b)).items.length,0);
});
test('HTTP requires sign-in and same-origin writes; client amounts and recipients are ignored',async()=>{
 const key='d'.repeat(43);await db.q("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,'2028-01-01')",[hash(key),a.id]);
 process.env.PUBLIC_APP_URL='https://vyx-social.vercel.app';process.env.VYX_APP_SECRET='test-secret';
 const h=createHandler(fn=>fn(db));
 const call=async(action,{user=true,method='GET',origin,body={}}={})=>{const req={method,url:'/api/vyx?action='+action,headers:{...(user?{cookie:'vyx_session='+key}:{}),...(origin?{origin}:{}),'content-type':'application/json'},body};const res={setHeader(){},end(s){this.result=JSON.parse(s);}};await h(req,res);return res;};
 assert.equal((await call('drops',{user:false})).statusCode,401);
 assert.equal((await call('drop-reveal',{method:'POST',body:{id:'2026-11-01T00:00:00Z'}})).statusCode,403);
 const before=await sum();
 const res=await call('drop-reveal',{method:'POST',origin:process.env.PUBLIC_APP_URL,body:{id:'2026-11-01T00:00:00Z',user_id:b.id,amount:999999999}});
 assert.equal(res.statusCode,200);assert.notEqual(res.result.amount,999999999);assert.equal(await sum(),before);
});
