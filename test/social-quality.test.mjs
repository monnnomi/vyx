import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {mutate,feed,comments,messages} from '../server/service.js';
import {searchCommunity,memberProfile,postDetail,handleAvailability,memberPreferences,moderationQueue,moderate,recordProductEvent} from '../server/social.js';
import {roomThread,listRooms} from '../server/rooms.js';
import {notifications} from '../server/drops.js';
const pg=new PGlite();await pg.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
const wrap=p=>({q:async(s,v=[])=> (await p.query(s,v)).rows,tx:fn=>p.transaction(tx=>fn(wrap(tx)))}),db=wrap(pg);
after(()=>pg.close());
async function member(id,name){return (await db.q('INSERT INTO users(x_id,x_username,handle,name) VALUES($1,$2,$2,$3) RETURNING *',[id,'quality_'+id,name]))[0];}
const alice=await member('80001','Alice'),bob=await member('80002','Bob'),outsider=await member('80003','Outsider');
process.env.VYX_ADMIN_X_IDS=alice.x_id;
const post=await mutate(db,bob,'post',{body:"A thoughtful story about ceramics & friends — isn't it good?"});
const room=await mutate(db,bob,'room-create',{name:'Pottery workshop',description:'People making ceramics together',language:'English',topic:'What are you making this week?',requestId:randomUUID()});
await mutate(db,alice,'room-join',{id:room.id});
const msg=await mutate(db,bob,'room-send',{id:room.id,body:'A private conversation about the next pottery workshop.',requestId:randomUUID()});
test('database search finds old posts beyond the loaded page and never searches private conversations',async()=>{
 await db.q("UPDATE posts SET created_at='2024-01-01' WHERE id=$1",[post.id]);
 for(let i=0;i<32;i++)await db.q('INSERT INTO posts(user_id,body) VALUES($1,$2)',[alice.id,'Recent irrelevant post '+i]);
 assert.ok(!(await feed(db,alice)).some(p=>p.id===post.id));
 const r=await searchCommunity(db,null,'ceramics');assert.equal(r.posts[0].id,post.id);assert.equal(r.rooms[0].id,room.id);assert.equal(r.rooms[0].language,'English');
 const secret=await searchCommunity(db,outsider,'private conversation');assert.equal(secret.posts.length,0);assert.ok(!JSON.stringify(secret).includes(msg.id));
 assert.equal((await postDetail(db,alice,post.id)).post.id,post.id);
});
test('Following excludes own posts without follows; profile includes bio, interests, posts and hosted rooms',async()=>{
 assert.equal((await feed(db,alice,{filter:'following'})).length,0);
 await mutate(db,bob,'profile',{name:'Bob',handle:'ceramic.bob',bio:'',interests:'Ceramics, design'});
 const profile=await memberProfile(db,alice,bob.id);assert.equal(profile.person.interests,'Ceramics, design');assert.ok(profile.posts.some(p=>p.id===post.id));assert.equal(profile.rooms[0].id,room.id);
 assert.equal((await handleAvailability(db,alice,'ceramic.bob')).available,false);
 assert.equal((await handleAvailability(db,bob,'ceramic.bob')).available,true);
 assert.equal((await handleAvailability(db,alice,'x_123456')).valid,false);
});
test('mute hides content; block removes mutual follows and prevents sending, following and reacting on the server',async()=>{
 await mutate(db,alice,'follow',{id:bob.id});await mutate(db,bob,'follow',{id:alice.id});
 await mutate(db,alice,'member-control',{id:bob.id,control:'muted',enabled:true});
 assert.equal((await feed(db,alice,{author:bob.id})).length,0);assert.equal((await roomThread(db,alice,room.id)).messages.length,0);
 const mutedRoom=(await listRooms(db,alice)).rooms.find(r=>r.id===room.id);
 assert.equal(mutedRoom.last_message,null);assert.equal(mutedRoom.unread_count,0);
 await mutate(db,alice,'member-control',{id:bob.id,control:'muted',enabled:false});
 await mutate(db,alice,'member-control',{id:bob.id,control:'blocked',enabled:true});
 for(const promise of [mutate(db,bob,'message',{id:alice.id,body:'Blocked hello',requestId:randomUUID()}),mutate(db,bob,'follow',{id:alice.id}),mutate(db,alice,'react',{id:post.id}),messages(db,bob,alice.id)])await assert.rejects(promise,e=>e.status===403);
 assert.equal((await feed(db,bob,{filter:'following'})).length,0);
 assert.equal((await memberPreferences(db,alice)).controls[0].blocked,true);
 await mutate(db,alice,'member-control',{id:bob.id,control:'blocked',enabled:false});
 assert.equal((await memberProfile(db,alice,bob.id)).person.following,false);
});
test('room hosts can edit discovery metadata, other members cannot',async()=>{
 await assert.rejects(mutate(db,alice,'room-edit',{id:room.id,name:'Stolen room'}),e=>e.status===403);
 await mutate(db,bob,'room-edit',{id:room.id,name:'Ceramics circle',description:'A space to learn pottery',language:'English / Russian',topic:'Share your first cup'});
 assert.equal((await listRooms(db,null,{search:'Russian'})).rooms[0].topic,'Share your first cup');
});
test('reports require access, persist once and reach only the admin queue',async()=>{
 await assert.rejects(mutate(db,outsider,'report',{id:msg.id,kind:'room-message',reason:'Spam'}),e=>e.status===404);
 const report=await mutate(db,alice,'report',{id:msg.id,kind:'room-message',reason:'Spam',detail:'Please review this message'});
 const again=await mutate(db,alice,'report',{id:msg.id,kind:'room-message',reason:'Spam'});assert.equal(report.id,again.id);
 await assert.rejects(moderationQueue(db,bob),e=>e.status===403);
 const q=await moderationQueue(db,alice);assert.ok(q.reports[0].content.includes('pottery'));
 await moderate(db,alice,{id:report.id,status:'dismissed',resolution:'Valid conversation, no violation'});
 assert.equal((await moderationQueue(db,alice)).reports[0].status,'dismissed');
});
test('notification choices and room mutes persist and filter before results are returned',async()=>{
 await mutate(db,bob,'follow',{id:alice.id});
 await mutate(db,bob,'room-send',{id:room.id,body:'Hello @quality_80001 — your next ceramics project sounds interesting.',requestId:randomUUID()});
 assert.ok((await notifications(db,alice)).items.some(n=>n.kind==='room-mention'));
 await mutate(db,alice,'room-mute',{id:room.id,enabled:true});
 assert.equal((await notifications(db,alice)).items.some(n=>n.kind==='room-mention'),false);
 await mutate(db,alice,'notification-preferences',{follows:false,comments:false,mentions:false,drops:true});
 assert.equal((await notifications(db,alice)).items.some(n=>n.category==='social'),false);
 assert.equal((await memberPreferences(db,alice)).notifications.follows,false);
});
test('deletion request is idempotent, visible to the owner/admin and cancellable without erasing an account',async()=>{
 await mutate(db,bob,'deletion-request',{confirm:true});await mutate(db,bob,'deletion-request',{confirm:true});
 assert.equal((await memberPreferences(db,bob)).deletion.status,'requested');assert.equal((await memberPreferences(db,outsider)).deletion,null);
 assert.equal((await moderationQueue(db,alice)).deletions.length,1);
 await mutate(db,bob,'deletion-cancel',{});assert.equal((await memberPreferences(db,bob)).deletion.status,'cancelled');
 assert.ok((await db.q('SELECT id FROM users WHERE id=$1',[bob.id])).length);
});
test('product metrics require consent and drop unapproved text or identifiers',async()=>{
 await assert.rejects(recordProductEvent(db,{event:'search',consent:false}),e=>e.status===400);
 await recordProductEvent(db,{event:'search',consent:true,section:'explore',outcome:'empty',query:'SECRET',userId:alice.id});
 const rows=await db.q('SELECT * FROM product_events');assert.equal(rows.length,1);assert.ok(!JSON.stringify(rows).includes('SECRET'));assert.ok(!JSON.stringify(rows).includes(alice.id));
});

test('message reactions are idempotent, replaceable and limited to participants',async()=>{
 await mutate(db,alice,'message-react',{kind:'room',id:msg.id,emoji:'❤️',enabled:true});
 await mutate(db,alice,'message-react',{kind:'room',id:msg.id,emoji:'❤️',enabled:true});
 let r=(await roomThread(db,alice,room.id)).messages.find(m=>m.id===msg.id).reactions;
 assert.deepEqual(r,[{emoji:'❤️',count:1,mine:true}]);
 await assert.rejects(mutate(db,outsider,'message-react',{kind:'room',id:msg.id,emoji:'🔥',enabled:true}),e=>e.status===404);
 await mutate(db,alice,'message-react',{kind:'room',id:msg.id,emoji:'🔥',enabled:true});
 await mutate(db,bob,'message-react',{kind:'room',id:msg.id,emoji:'🔥',enabled:true});
 r=(await roomThread(db,alice,room.id)).messages.find(m=>m.id===msg.id).reactions;assert.equal(r[0].count,2);
 await mutate(db,alice,'message-react',{kind:'room',id:msg.id,emoji:'🔥',enabled:false});
 const [dm]=await db.q('INSERT INTO messages(sender_id,recipient_id,body,request_id) VALUES($1,$2,$3,gen_random_uuid()) RETURNING id',[alice.id,bob.id,'Reaction test']);
 await mutate(db,bob,'message-react',{kind:'dm',id:dm.id,emoji:'👍',enabled:true});
 assert.equal((await messages(db,alice,bob.id)).find(m=>m.id===dm.id).reactions[0].mine,false);
 await assert.rejects(mutate(db,outsider,'message-react',{kind:'dm',id:dm.id,emoji:'👍',enabled:true}),e=>e.status===404);
 await mutate(db,alice,'member-control',{id:bob.id,control:'blocked',enabled:true});
 await assert.rejects(mutate(db,bob,'message-react',{kind:'dm',id:dm.id,emoji:'👍',enabled:true}),e=>e.status===403);
});
