import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {login} from '../server/oauth.js';
import {mutate,state,feed,members} from '../server/service.js';
import {memberProfile,moderate} from '../server/social.js';
import {roomThread} from '../server/rooms.js';
import {memberReputation} from '../server/reputation.js';
import {createHandler} from '../api/vyx.js';
const pg=new PGlite();await pg.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
const wrap=p=>({q:async(s,v=[])=>(await p.query(s,v)).rows,tx:fn=>p.transaction(tx=>fn(wrap(tx)))}),db=wrap(pg);after(()=>pg.close());
let sequence=0;
async function fixture(){
 const n=++sequence;
 const accounts=await Promise.all([0,1,2,3].map(k=>db.tx(tx=>login(tx,{id:String(90000+n*4+k),username:'reputation_'+n+'_'+k,name:'Reputation member '+k,avatar:''}))));
 const [a,b,c,d]=accounts,room=await mutate(db,a.user,'room-create',{name:'Recognition fixture '+n,requestId:randomUUID()});
 for(const who of [b,c])await mutate(db,who.user,'room-join',{id:room.id});
 const send=()=>mutate(db,a.user,'room-send',{id:room.id,body:'A contribution for testing recognition from other people. '+randomUUID(),requestId:randomUUID()});
 const post=()=>mutate(db,a.user,'post',{body:'A public contribution for testing recognition. '+randomUUID(),requestId:randomUUID()});
 const react=(who,m,enabled=true,emoji='👍')=>mutate(db,who.user,'message-react',{kind:'room',id:m.id,emoji,enabled});
 const like=(who,p)=>mutate(db,who.user,'react',{id:p.id});
 const reputation=()=>memberReputation(db,a.user.id);
 return {a,b,c,d,room,send,post,react,like,reputation};
}
test('self reactions do not count; each recognized contribution counts once while people are unique across both sources',async()=>{
 const f=await fixture(),m=await f.send(),p=await f.post();assert.deepEqual(await f.reputation(),{recognized:0,people:0});
 await f.react(f.a,m);await f.like(f.a,p);assert.deepEqual(await f.reputation(),{recognized:0,people:0});
 await f.react(f.b,m);await f.react(f.c,m);assert.deepEqual(await f.reputation(),{recognized:1,people:2});
 await f.like(f.b,p);await f.like(f.c,p);assert.deepEqual(await f.reputation(),{recognized:2,people:2});
 await f.like(f.d,p);assert.deepEqual(await f.reputation(),{recognized:2,people:3});
 await f.react(f.b,m,true,'🔥');assert.deepEqual(await f.reputation(),{recognized:2,people:3});
});
test('removing the final external reaction removes recognition; DM reactions never contribute',async()=>{
 const f=await fixture(),m=await f.send();await f.react(f.b,m);await f.react(f.c,m);await f.react(f.b,m,false);assert.deepEqual(await f.reputation(),{recognized:1,people:1});
 await f.react(f.c,m,false);assert.deepEqual(await f.reputation(),{recognized:0,people:0});
 const [dm]=await db.q('INSERT INTO messages(sender_id,recipient_id,body,request_id) VALUES($1,$2,$3,gen_random_uuid()) RETURNING id',[f.a.user.id,f.b.user.id,'A private contribution is never reputation.']);
 await mutate(db,f.b.user,'message-react',{kind:'dm',id:dm.id,emoji:'❤️',enabled:true});assert.deepEqual(await f.reputation(),{recognized:0,people:0});
 const p=await f.post();await f.like(f.b,p);assert.deepEqual(await f.reputation(),{recognized:1,people:1});await f.like(f.b,p);assert.deepEqual(await f.reputation(),{recognized:0,people:0});
});
test('deleted messages, archived rooms and moderator-removed posts no longer contribute',async()=>{
 const f=await fixture(),m=await f.send();await f.react(f.b,m);await mutate(db,f.a.user,'room-delete-message',{id:f.room.id,messageId:m.id});assert.deepEqual(await f.reputation(),{recognized:0,people:0});
 const m2=await f.send();await f.react(f.b,m2);await mutate(db,f.a.user,'room-close',{id:f.room.id});assert.deepEqual(await f.reputation(),{recognized:0,people:0});
 const p=await f.post();await f.like(f.b,p);await mutate(db,f.b.user,'save',{id:p.id});
 const reply=await mutate(db,f.c.user,'comment',{id:p.id,body:'A dependent fixture reply.'});
 for(const [scope,parent] of [['post',p.id],['comment',reply.id]])await db.q(`INSERT INTO media_assets(id,owner_id,scope,kind,content_type,byte_size,pathname,status,post_id,comment_id) VALUES(gen_random_uuid(),$1,$2,'image','image/png',10,$3,'attached',$4,$5)`,[f.a.user.id,scope,'isolated-reputation/'+parent,scope==='post'?parent:null,scope==='comment'?parent:null]);
 assert.deepEqual(await f.reputation(),{recognized:1,people:1});
 process.env.VYX_ADMIN_X_IDS=f.a.user.x_id;
 const report=await mutate(db,f.b.user,'report',{kind:'post',id:p.id,reason:'Isolated moderation test'});
 await moderate(db,f.a.user,{id:report.id,status:'resolved',resolution:'Removed disposable fixture',remove:true});assert.deepEqual(await f.reputation(),{recognized:0,people:0});
 assert.equal((await db.q('SELECT count(*)::int AS n FROM comments WHERE post_id=$1',[p.id]))[0].n,0);assert.equal((await db.q('SELECT count(*)::int AS n FROM saved_posts WHERE post_id=$1',[p.id]))[0].n,0);
 assert.equal((await db.q("SELECT count(*)::int AS n FROM media_assets WHERE pathname LIKE 'isolated-reputation/%' AND status='deleting' AND post_id IS NULL AND comment_id IS NULL"))[0].n,2);
 const g=await fixture(),gm=await g.send();await g.react(g.b,gm);process.env.VYX_ADMIN_X_IDS=g.a.user.x_id;
 const gr=await mutate(db,g.b.user,'report',{kind:'room-message',id:gm.id,reason:'Isolated moderation test'});await moderate(db,g.a.user,{id:gr.id,status:'resolved',resolution:'Removed disposable fixture',remove:true});assert.deepEqual(await g.reputation(),{recognized:0,people:0});
});
test('blocks exclude both directions, unblocking restores real reactions, and mutes do not change global status',async()=>{
 const f=await fixture(),m=await f.send(),p=await f.post();await f.react(f.b,m);await f.like(f.b,p);assert.deepEqual(await f.reputation(),{recognized:2,people:1});
 for(const [actor,target] of [[f.a,f.b],[f.b,f.a]]){
  await mutate(db,actor.user,'member-control',{id:target.user.id,control:'blocked',enabled:true});assert.deepEqual(await f.reputation(),{recognized:0,people:0});
  await mutate(db,actor.user,'member-control',{id:target.user.id,control:'blocked',enabled:false});assert.deepEqual(await f.reputation(),{recognized:2,people:1});
 }
 await mutate(db,f.a.user,'member-control',{id:f.b.user.id,control:'muted',enabled:true});assert.deepEqual(await f.reputation(),{recognized:2,people:1});
});
test('global aggregates are identical for owners, guests and non-members without opening room history or exposing reactors',async()=>{
 const f=await fixture(),m=await f.send();await f.react(f.b,m);
 for(const viewer of [f.a.user,f.b.user,f.d.user,null]){
  const profile=await memberProfile(db,viewer,f.a.user.id);assert.deepEqual(profile.person.reputation,{recognized:1,people:1});assert.deepEqual(Object.keys(profile.person.reputation).sort(),['people','recognized']);assert.equal(profile.person.following_count,0);
 }
 await assert.rejects(roomThread(db,f.d.user,f.room.id),e=>e.status===403);
 await mutate(db,f.b.user,'room-leave',{id:f.room.id});assert.deepEqual(await f.reputation(),{recognized:1,people:1});
 const other=await mutate(db,f.b.user,'room-create',{name:'Another recognition room',requestId:randomUUID()});await mutate(db,f.a.user,'room-join',{id:other.id});
 const otherMessage=await mutate(db,f.a.user,'room-send',{id:other.id,body:'An ordinary member contribution remains after leaving.',requestId:randomUUID()});
 await f.react(f.b,otherMessage);await mutate(db,f.a.user,'room-leave',{id:other.id});assert.deepEqual(await f.reputation(),{recognized:2,people:1});
 const list=await members(db,null,'season-1');assert.ok(list.every(u=>!('reputation' in u)));
 assert.ok((await feed(db,null)).every(p=>!('reputation' in p.author)));
});
test('profile reads do not affect VP or pools and reputation stays the same across reward seasons',async()=>{
 const f=await fixture(),p=await f.post();await f.like(f.b,p);
 const ledger=()=>db.q('SELECT * FROM reward_ledger ORDER BY created_at,user_id,amount');const pools=()=>db.q('SELECT id,budget,spent FROM farm_pools ORDER BY id');
 const before=[await ledger(),await pools()];await f.reputation();await memberProfile(db,null,f.a.user.id);assert.deepEqual([await ledger(),await pools()],before);
 const november=await state(db,f.a.user,new Date('2026-11-15T00:00Z')),december=await state(db,f.a.user,new Date('2026-12-15T00:00Z'));
 assert.equal(november.calendar.season,'season-1');assert.equal(december.calendar.season,'season-2');assert.deepEqual(november.user.reputation,{recognized:1,people:1});assert.deepEqual(december.user.reputation,november.user.reputation);
});
test('the index migration is repeatable and preserves reactions, reputation and reward records',async()=>{
 const f=await fixture(),m=await f.send(),p=await f.post();await f.react(f.b,m);await f.like(f.c,p);
 const snapshot=async()=>({reputation:await f.reputation(),likes:await db.q('SELECT * FROM reactions ORDER BY user_id,post_id'),messageReactions:await db.q('SELECT * FROM message_reactions ORDER BY user_id,room_message_id,message_id'),ledger:await db.q('SELECT * FROM reward_ledger ORDER BY created_at,user_id,amount')});
 const before=await snapshot(),migration=await readFile(new URL('../db/reputation.sql',import.meta.url),'utf8');await pg.exec(migration);await pg.exec(migration);assert.deepEqual(await snapshot(),before);
 assert.match((await db.q("SELECT indexdef FROM pg_indexes WHERE indexname='reactions_post_reputation_idx'"))[0].indexdef,/post_id, user_id/);
});
test('HTTP profiles return server totals; posted reputation is ignored and reaction CSRF protection remains intact',async()=>{
 process.env.PUBLIC_APP_URL='https://joinvyx.com';process.env.VYX_APP_SECRET='isolated-reputation-test-secret';const f=await fixture(),m=await f.send();await f.react(f.b,m);const app=createHandler(fn=>fn(db));
 async function call({method='GET',action='member-profile',who=f.a,input,origin='https://joinvyx.com'}={}){const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(t){this.data=JSON.parse(t);}};await app({method,url:'/api/vyx?action='+action+'&id='+f.a.user.id,headers:{origin,...(who?{cookie:'vyx_session='+who.sessionToken}:{}),'content-type':'application/json'},body:input},res);return res;}
 const guest=await call({who:null});assert.equal(guest.statusCode,200);assert.equal(guest.headers['cache-control'],'no-store');assert.deepEqual(guest.data.person.reputation,{recognized:1,people:1});
 assert.equal((await call({method:'POST',action:'profile',input:{name:f.a.user.name,handle:f.a.user.handle,reputation:{recognized:9999,people:9999}}})).statusCode,200);assert.deepEqual(await f.reputation(),{recognized:1,people:1});
 assert.equal((await call({method:'POST',action:'message-react',origin:'https://foreign.invalid',input:{kind:'room',id:m.id,emoji:'👍',enabled:false}})).statusCode,403);assert.deepEqual(await f.reputation(),{recognized:1,people:1});
});
