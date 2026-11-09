import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {login} from '../server/oauth.js';
import {mutate,messages} from '../server/service.js';
import {roomThread} from '../server/rooms.js';
import {recordMessageViews} from '../server/message-views.js';
import {messageReactionEmojis} from '../server/message-reactions.js';
import {createHandler} from '../api/vyx.js';
const pg=new PGlite();await pg.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
const wrap=p=>({q:async(s,v=[])=> (await p.query(s,v)).rows,tx:fn=>p.transaction(tx=>fn(wrap(tx)))}),db=wrap(pg);after(()=>pg.close());
const make=id=>db.tx(tx=>login(tx,{id,username:'engagement_'+id,name:'Member '+id,avatar:''}));
const [a,b,c,d]=await Promise.all(['8101','8102','8103','8104'].map(make));
const room=await mutate(db,a.user,'room-create',{name:'Message engagement',requestId:randomUUID()});
for(const who of [b,c])await mutate(db,who.user,'room-join',{id:room.id});
const send=(who,id,body)=>mutate(db,who.user,'room-send',{id,body,requestId:randomUUID()});
const first=await send(a,room.id,'A message for checking genuine unique viewers.'),own=await send(b,room.id,'My own message should not count me as a viewer.');
const mark=(who,kind,id,ids)=>db.tx(tx=>recordMessageViews(tx,who.user,{kind,id,messageIds:ids}));
const snapshots=async()=>({ledger:await db.q('SELECT count(*)::int AS n,COALESCE(sum(amount),0)::text AS vp FROM reward_ledger'),pools:await db.q('SELECT id,budget,spent FROM farm_pools ORDER BY id')});
let dm;

test('fetching messages never counts as a view; distinct accounts count once and the author is excluded',async()=>{
 const before=await snapshots();
 assert.equal((await roomThread(db,b.user,room.id)).messages.find(m=>m.id===first.id).view_count,0);
 assert.equal((await db.q('SELECT count(*)::int AS n FROM message_views'))[0].n,0);
 const r=await mark(b,'room',room.id,[first.id,first.id,own.id]);
 assert.equal(r.views.find(v=>v.id===first.id).view_count,1);assert.equal(r.views.find(v=>v.id===first.id).viewed_by_me,true);assert.equal(r.views.find(v=>v.id===own.id).view_count,0);
 await mark(b,'room',room.id,[first.id]);await mark(c,'room',room.id,[first.id]);await mark(a,'room',room.id,[first.id]);
 const row=(await roomThread(db,a.user,room.id)).messages.find(m=>m.id===first.id);assert.equal(row.view_count,2);assert.equal(row.viewed_by_me,false);
 assert.equal((await db.q('SELECT count(*)::int AS n FROM message_views WHERE room_message_id=$1',[first.id]))[0].n,2);
 assert.deepEqual(await snapshots(),before);
});
test('room views reject outsiders, foreign IDs, deleted messages, muted messages and archived rooms atomically',async()=>{
 await assert.rejects(mark(d,'room',room.id,[first.id]),e=>e.status===403);
 const other=await mutate(db,d.user,'room-create',{name:'Another private room',requestId:randomUUID()});
 const foreign=await send(d,other.id,'This message belongs to a different room.');
 const unseen=await send(a,room.id,'This valid message must not be counted in a mixed invalid batch.');
 await assert.rejects(mark(b,'room',room.id,[unseen.id,foreign.id]),e=>e.status===404);
 assert.equal((await db.q('SELECT count(*)::int AS n FROM message_views WHERE room_message_id=$1',[unseen.id]))[0].n,0);
 await mutate(db,a.user,'room-delete-message',{id:room.id,messageId:unseen.id});await assert.rejects(mark(b,'room',room.id,[unseen.id]),e=>e.status===404);
 await mutate(db,b.user,'member-control',{id:a.user.id,control:'muted',enabled:true});await assert.rejects(mark(b,'room',room.id,[first.id]),e=>e.status===404);
 await mutate(db,b.user,'member-control',{id:a.user.id,control:'muted',enabled:false});
 await mutate(db,d.user,'room-close',{id:other.id});await assert.rejects(mark(d,'room',other.id,[foreign.id]),e=>e.status===403);
});
test('DM views are private to participants and never count the sender or an unrelated account',async()=>{
 [dm]=await db.q('INSERT INTO messages(sender_id,recipient_id,body,request_id) VALUES($1,$2,$3,gen_random_uuid()) RETURNING id',[a.user.id,b.user.id,'Private read receipt test']);
 assert.equal((await messages(db,b.user,a.user.id)).find(m=>m.id===dm.id).view_count,0);
 await mark(a,'dm',b.user.id,[dm.id]);assert.equal((await mark(b,'dm',a.user.id,[dm.id])).views[0].view_count,1);
 await mark(b,'dm',a.user.id,[dm.id]);await assert.rejects(mark(d,'dm',a.user.id,[dm.id]),e=>e.status===404);
 const received=(await messages(db,a.user,b.user.id)).find(m=>m.id===dm.id);assert.equal(received.view_count,1);assert.equal(received.viewed_by_me,false);assert.ok(!('viewers' in received));
 await mutate(db,a.user,'member-control',{id:b.user.id,control:'blocked',enabled:true});await assert.rejects(mark(b,'dm',a.user.id,[dm.id]),e=>e.status===403);
 await mutate(db,a.user,'member-control',{id:b.user.id,control:'blocked',enabled:false});
});
test('new reactions replace or remove the previous one without changing views; schema upgrades preserve receipts',async()=>{
 assert.equal(messageReactionEmojis.length,24);assert.equal(new Set(messageReactionEmojis).size,24);
 for(const emoji of messageReactionEmojis){await mutate(db,b.user,'message-react',{kind:'room',id:first.id,emoji,enabled:true});const m=(await roomThread(db,b.user,room.id)).messages.find(m=>m.id===first.id);assert.deepEqual(m.reactions,[{emoji,count:1,mine:true}]);assert.equal(m.view_count,2);}
 await assert.rejects(mutate(db,b.user,'message-react',{kind:'room',id:first.id,emoji:'not-an-emoji',enabled:true}),e=>e.status===400);
 const migration=await readFile(new URL('../db/message-engagement.sql',import.meta.url),'utf8');
 const before=await db.q('SELECT * FROM message_views ORDER BY viewed_at,user_id');await pg.exec(migration);await pg.exec(migration);assert.deepEqual(await db.q('SELECT * FROM message_views ORDER BY viewed_at,user_id'),before);
 assert.equal((await roomThread(db,b.user,room.id)).messages.find(m=>m.id===first.id).reactions[0].emoji,'⚡');
 await mutate(db,b.user,'message-react',{kind:'room',id:first.id,emoji:'⚡',enabled:false});assert.equal((await roomThread(db,b.user,room.id)).messages.find(m=>m.id===first.id).reactions.length,0);
});
test('view recording requires same-origin authentication, bounded IDs and the actual session account',async()=>{
 process.env.PUBLIC_APP_URL='https://joinvyx.com';const app=createHandler(fn=>fn(db));
 async function call({who=b,method='POST',origin='https://joinvyx.com',input={kind:'room',id:room.id,messageIds:[first.id],userId:c.user.id}}={}){const res={headers:{},statusCode:200,setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(t){this.data=JSON.parse(t);}};await app({method,url:'/api/vyx?action=message-views',headers:{origin,...(who?{cookie:'vyx_session='+who.sessionToken}:{}),'content-type':'application/json'},body:input},res);return res;}
 assert.equal((await call({who:null})).statusCode,401);assert.equal((await call({origin:'https://foreign.invalid'})).statusCode,403);assert.equal((await call({method:'GET'})).statusCode,404);
 for(const input of [{kind:'post',id:room.id,messageIds:[first.id]},{kind:'room',id:room.id,messageIds:[]},{kind:'room',id:room.id,messageIds:Array(61).fill(first.id)},{kind:'room',id:room.id,messageIds:['invalid']}])assert.equal((await call({input})).statusCode,400);
 const r=await call();assert.equal(r.statusCode,200);assert.equal(r.headers['cache-control'],'no-store');assert.deepEqual(Object.keys(r.data.views[0]).sort(),['id','view_count','viewed_by_me']);
});
