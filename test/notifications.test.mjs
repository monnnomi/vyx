import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import {PGlite} from '@electric-sql/pglite';
import {notifications,readNotifications} from '../server/drops.js';
import {mutate} from '../server/service.js';
import {memberPreferences} from '../server/social.js';
import {createHandler} from '../api/vyx.js';
import {hash} from '../server/http.js';
const pg=new PGlite();await pg.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
const wrap=p=>({q:async(s,v=[])=>(await p.query(s,v)).rows,tx:fn=>p.transaction(tx=>fn(wrap(tx)))}),db=wrap(pg);
after(()=>pg.close());
async function setup(){
 const make=async()=>{const id=randomUUID();return (await db.q('INSERT INTO users(x_id,handle,name) VALUES($1,$1,$2) RETURNING *',[id,'Member '+id.slice(0,4)]))[0];};
 const a=await make(),b=await make(),c=await make();
 const [post]=await db.q('INSERT INTO posts(user_id,body) VALUES($1,$2) RETURNING *',[a.id,'A community post for notification delivery and privacy checks.']);
 return {a,b,c,post};
}
async function like(b,post,when='2026-11-14T10:00:00Z'){await db.q('INSERT INTO reactions(user_id,post_id,created_at) VALUES($1,$2,$3)',[b.id,post.id,when]);}
async function dm(b,a,body='A new direct message',when='2026-11-14T10:00:01Z'){return (await db.q('INSERT INTO messages(sender_id,recipient_id,body,request_id,created_at) VALUES($1,$2,$3,$4,$5) RETURNING id',[b.id,a.id,body,randomUUID(),when]))[0];}
const read=(u,n)=>readNotifications(db,u,{id:n.id,createdAt:n.created_at});
test('likes and incoming direct messages belong to the recipient; self likes and unrelated accounts are excluded',async()=>{
 const {a,b,c,post}=await setup();await like(b,post);await like(a,post);await dm(b,a);await dm(a,b);
 const n=await notifications(db,a);assert.deepEqual(n.items.map(n=>n.kind).sort(),['like','message']);assert.equal(n.unreadCount,2);
 assert.equal(n.items.find(n=>n.kind==='message').target,b.id);assert.equal(n.items.find(n=>n.kind==='like').target,post.id);
 assert.equal((await notifications(db,c)).items.length,0);assert.equal((await notifications(db,b)).items.length,1);
 const incoming=n.items.find(n=>n.kind==='message');await db.q('INSERT INTO message_views(user_id,message_id) VALUES($1,$2)',[a.id,incoming.id.slice(8)]);
 const viewed=await notifications(db,a);assert.equal(viewed.unreadCount,1);assert.equal(viewed.items.find(n=>n.kind==='message').unread,false);
 await assert.rejects(notifications(db,null),e=>e.status===401);
});
test('individual reads are private, versioned, idempotent and cannot clear another event',async()=>{
 const {a,b,c,post}=await setup();await like(b,post,'2026-11-14T10:00:00.123456Z');await dm(b,a);
 let n=await notifications(db,a),liked=n.items.find(n=>n.kind==='like');await read(a,liked);await read(a,liked);
 n=await notifications(db,a);assert.equal(n.unreadCount,1);assert.equal(n.items.find(n=>n.kind==='message').unread,true);
 await assert.rejects(read(c,liked),e=>e.status===404);
 await assert.rejects(readNotifications(db,a,{id:liked.id,createdAt:'2028-01-01T00:00:00.000Z'}),e=>e.status===404);
 await db.q('DELETE FROM reactions WHERE user_id=$1 AND post_id=$2',[b.id,post.id]);await like(b,post,'2026-11-14T10:01:00Z');
 assert.equal((await notifications(db,a)).items.find(n=>n.kind==='like').unread,true);
 assert.equal((await db.q('SELECT count(*)::int AS n FROM notification_reads WHERE user_id=$1',[a.id]))[0].n,1);
});
test('mark all uses the displayed cutoff and unread count includes events beyond the latest 50',async()=>{
 const {a,b}=await setup();for(let i=0;i<55;i++)await dm(b,a,'Message '+i,new Date(Date.parse('2026-11-14T10:00:00Z')+i*1000).toISOString());
 let n=await notifications(db,a);assert.equal(n.items.length,50);assert.equal(n.unreadCount,55);
 await readNotifications(db,a,{through:'2026-11-14T10:00:30Z'});assert.equal((await notifications(db,a)).unreadCount,24);
 await readNotifications(db,a);assert.equal((await notifications(db,a)).unreadCount,0);
 await readNotifications(db,a,{through:'2020-01-01T00:00:00Z'});assert.equal((await notifications(db,a)).unreadCount,0);
});
test('muting, blocks in either direction, preferences and post removal filter the inbox on the server',async()=>{
 const {a,b,post}=await setup();await like(b,post);await dm(b,a);
 await db.q('INSERT INTO member_controls(user_id,target_id,muted) VALUES($1,$2,true)',[a.id,b.id]);
 assert.equal((await notifications(db,a)).unreadCount,0);
 await db.q('DELETE FROM member_controls WHERE user_id=$1',[a.id]);
 await db.q('INSERT INTO member_controls(user_id,target_id,blocked) VALUES($1,$2,true)',[b.id,a.id]);assert.equal((await notifications(db,a)).items.length,0);
 await db.q('DELETE FROM member_controls WHERE user_id=$1',[b.id]);
 const prefs={follows:true,comments:true,mentions:true,drops:true,likes:false,messages:false};
 await mutate(db,a,'notification-preferences',prefs);assert.equal((await notifications(db,a)).items.length,0);
 const {likes,messages,...oldClient}=prefs;await mutate(db,a,'notification-preferences',oldClient);
 assert.equal((await memberPreferences(db,a)).notifications.likes,false);assert.equal((await memberPreferences(db,a)).notifications.messages,false);
 await mutate(db,a,'notification-preferences',{...prefs,likes:true,messages:true});
 await mutate(db,a,'post-delete',{id:post.id});assert.deepEqual((await notifications(db,a)).items.map(n=>n.kind),['message']);
});
test('inbox conditional responses are private, account-specific, and change when an event is read',async()=>{
 const {a,b,c,post}=await setup();await like(b,post);
 const key='n'.repeat(43),keyC='c'.repeat(43);await db.q("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,'2028-01-01'),($3,$4,'2028-01-01')",[hash(key),a.id,hash(keyC),c.id]);
 process.env.PUBLIC_APP_URL='https://joinvyx.com';process.env.VYX_APP_SECRET='isolated-notification-test';const handler=createHandler(fn=>fn(db));
 const call=async(token,tag,method='GET',origin)=>{const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(raw){this.raw=raw;}};await handler({url:'/api/vyx?action='+ (method==='GET'?'notifications':'notifications-read'),method,headers:{cookie:'vyx_session='+token,...(tag?{'if-none-match':tag}:{}),...(origin?{origin}:{}),'content-type':'application/json'},body:{}},res);return res;};
 const first=await call(key);assert.equal(first.statusCode,200);assert.equal(first.headers.Vary,'Cookie');assert.ok(first.headers['Cache-Control'].includes('no-store'));
 const unchanged=await call(key,first.headers.ETag);assert.equal(unchanged.statusCode,304);assert.equal(unchanged.raw,undefined);
 assert.equal((await call(keyC,first.headers.ETag)).statusCode,200);assert.equal((await call('missing')).statusCode,401);
 assert.equal((await call(key,null,'POST')).statusCode,403);assert.equal((await call(key,null,'POST','https://joinvyx.com')).statusCode,200);
 assert.equal((await call(key,first.headers.ETag)).statusCode,200);
});
test('additive notification migration can be repeated without changing an existing read receipt',async()=>{
 const {a,b,post}=await setup();await like(b,post);const n=(await notifications(db,a)).items[0];await read(a,n);
 const migration=await readFile(new URL('../server/notification-schema.sql',import.meta.url),'utf8');await pg.exec(migration);await pg.exec(migration);
 assert.equal((await notifications(db,a)).unreadCount,0);
});
const source=await readFile(new URL('../public/notifications.js',import.meta.url),'utf8');
function browser(){
 const store=new Map(),shown=[],context=vm.createContext({data:{user:{id:'alice'}},inboxData:null,document:{hidden:false,addEventListener(){}},window:{addEventListener(){}},navigator:{},localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},setTimeout:()=>1,clearTimeout(){},AbortController,Date,console,renderProductBadge(){},shown});
 vm.runInContext(source+ '\nshowLiveNotice=n=>shown.push(n.id);',context);
 const snapshot=(items,stamp=1)=>({items,unreadCount:items.filter(n=>n.unread).length,serverNow:new Date(stamp*1000).toISOString()});
 return {context,shown,send:(items,stamp)=>{context.snapshot=snapshot(items,stamp);vm.runInContext('acceptLiveNotifications(snapshot)',context);}};
}
const notice=(id,unread=true,created_at='2026-11-14T10:00:00Z')=>({id,unread,created_at,kind:'like',title:'A like',body:'Hello',target:'post'});
test('client establishes a quiet baseline, alerts once across renders, queues hidden events and ignores stale snapshots',()=>{
 const b=browser();b.send([notice('old')],1);assert.deepEqual(b.shown,[]);
 b.send([notice('new'),notice('old')],2);b.send([notice('new'),notice('old')],3);assert.deepEqual(b.shown,['new']);
 b.context.document.hidden=true;b.send([notice('hidden'),notice('new'),notice('old')],4);assert.deepEqual(b.shown,['new']);
 b.context.document.hidden=false;vm.runInContext('flushNotificationPopups()',b.context);assert.deepEqual(b.shown,['new','hidden']);
 b.send([notice('stale')],1);assert.deepEqual(b.shown,['new','hidden']);
});
test('client discards pending previews on read/filter and resets all state when the account changes',()=>{
 const b=browser();b.send([],1);b.context.document.hidden=true;b.send([notice('read-before-return')],2);b.send([notice('read-before-return',false)],3);
 b.context.document.hidden=false;vm.runInContext('flushNotificationPopups()',b.context);assert.deepEqual(b.shown,[]);
 b.context.data.user={id:'bob'};b.send([notice('bob-old')],4);assert.deepEqual(b.shown,[]);b.send([notice('bob-new'),notice('bob-old')],5);assert.deepEqual(b.shown,['bob-new']);
 b.context.data.user=null;vm.runInContext('syncLiveNotificationOwner()',b.context);assert.equal(vm.runInContext('liveInbox.owner',b.context),null);
});
