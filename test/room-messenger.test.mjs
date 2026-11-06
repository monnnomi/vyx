import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {mutate} from '../server/service.js';
import {listRooms,roomSummary,roomThread,roomMessage,roomMentionCandidates} from '../server/rooms.js';
import {notifications} from '../server/drops.js';
import {createHandler} from '../api/vyx.js';
import {hash} from '../server/http.js';
const schema=await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'),pg=new PGlite();await pg.exec(schema);
const wrap=p=>({q:async(s,v=[])=>(await p.query(s,v)).rows,tx:fn=>p.transaction(tx=>fn(wrap(tx)))}),db=wrap(pg);
const make=async(n)=>(await db.q('INSERT INTO users(x_id,handle,name) VALUES($1,$2,$3) RETURNING *',['messenger_'+n,'messenger_'+n,'Messenger '+n]))[0];
const alice=await make('alice'),bob=await make('bob'),carol=await make('carol');
const create=async(owner,name='Messenger Circle')=>mutate(db,owner,'room-create',{name,requestId:randomUUID()});
const send=(who,id,body,more={})=>mutate(db,who,'room-send',{id,body,requestId:randomUUID(),...more});
const join=(who,id)=>mutate(db,who,'room-join',{id});
const summary=async(who,id)=>(await roomSummary(db,who,id)).room;
const rejects=(promise,status)=>assert.rejects(promise,e=>e.status===status);
after(()=>pg.close());

test('private previews and per-account unread positions; GET never marks a conversation read',async()=>{
 const r=await create(alice);await send(alice,r.id,'Earlier history');await join(bob,r.id);
 assert.equal((await summary(bob,r.id)).unread_count,0);
 const a=await send(alice,r.id,'First new message');await send(bob,r.id,'My own reply');
 let mine=await summary(bob,r.id);assert.equal(mine.unread_count,1);assert.equal(mine.last_message.body,'My own reply');
 assert.equal((await summary(alice,r.id)).unread_count,1);
 for(const who of [null,carol]){const x=await summary(who,r.id);assert.equal(x.unread_count,0);assert.equal(x.last_message,null);assert.equal(x.mention_count,0);}
 const t=await roomThread(db,bob,r.id);assert.equal((await summary(bob,r.id)).unread_count,1);
 const through=t.messages.find(m=>m.id===a.id).seq;await send(alice,r.id,'Arrived after the snapshot');
 await mutate(db,bob,'room-read',{id:r.id,through,user_id:alice.id});
 assert.equal((await summary(bob,r.id)).unread_count,1);assert.equal((await summary(alice,r.id)).unread_count,1);
 const latest=(await roomThread(db,bob,r.id)).messages.at(-1).seq;
 await mutate(db,bob,'room-read',{id:r.id,through:latest});await mutate(db,bob,'room-read',{id:r.id,through});
 assert.equal((await summary(bob,r.id)).unread_count,0);
 assert.equal((await roomThread(db,bob,r.id)).lastReadSeq,latest);
 await rejects(mutate(db,carol,'room-read',{id:r.id,through:latest}),403);
 const second=await create(carol,'Another Circle'),foreign=await send(carol,second.id,'Outside this room');await join(bob,second.id);
 const foreignSeq=(await roomThread(db,carol,second.id)).messages.find(m=>m.id===foreign.id).seq;
 await rejects(mutate(db,bob,'room-read',{id:r.id,through:foreignSeq}),400);
 await rejects(mutate(db,bob,'room-read',{id:r.id,through:'9999999999999999999'}),400);
});

test('reply retries bind to the same target and deleted quotes no longer expose body or sender',async()=>{
 const r=await create(alice,'Reply Circle');await join(bob,r.id);
 const parent=await send(alice,r.id,'An original private thought'),key=randomUUID();
 const reply=await send(bob,r.id,'An answer',{replyTo:parent.id,requestId:key});
 assert.equal((await send(bob,r.id,'An answer',{replyTo:parent.id,requestId:key})).id,reply.id);
 await rejects(send(bob,r.id,'An answer',{requestId:key}),409);
 let message=(await roomMessage(db,bob,r.id,reply.id)).message;
 assert.equal(message.reply.body,'An original private thought');assert.equal(message.reply.name,alice.name);
 const other=await create(carol,'Private Elsewhere'),outside=await send(carol,other.id,'Never leak this');
 await rejects(send(bob,r.id,'Cross room quote',{replyTo:outside.id}),404);
 await rejects(roomMessage(db,bob,r.id,outside.id),404);
 await mutate(db,alice,'room-delete-message',{id:r.id,messageId:parent.id});
 message=(await roomMessage(db,bob,r.id,reply.id)).message;assert.equal(message.reply.removed,true);assert.equal(message.reply.body,null);assert.equal(message.reply.name,null);
 await rejects(send(bob,r.id,'Quote a removed message',{replyTo:parent.id}),404);
 await rejects(roomMessage(db,carol,r.id,reply.id),403);
});

test('only the owner pins a current-room message; removing it clears the pin and previews',async()=>{
 const r=await create(bob,'Pinned Circle');await join(alice,r.id);const message=await send(alice,r.id,'A note for everyone');
 await rejects(mutate(db,alice,'room-pin',{id:r.id,messageId:message.id}),403);
 await mutate(db,bob,'room-pin',{id:r.id,messageId:message.id});
 assert.equal((await roomThread(db,alice,r.id)).pinned.body,'A note for everyone');
 assert.ok(!JSON.stringify(await summary(null,r.id)).includes('A note for everyone'));
 const other=await create(carol,'Pin Elsewhere'),outside=await send(carol,other.id,'Foreign pin');
 await rejects(mutate(db,bob,'room-pin',{id:r.id,messageId:outside.id}),404);
 await mutate(db,alice,'room-delete-message',{id:r.id,messageId:message.id});
 assert.equal((await roomThread(db,bob,r.id)).pinned,null);assert.equal((await summary(bob,r.id)).last_message,null);
 await rejects(mutate(db,bob,'room-pin',{id:r.id,messageId:message.id}),404);
 await mutate(db,bob,'room-pin',{id:r.id,messageId:null});
});

test('mentions are deduplicated and restricted to current room members, with private notifications',async()=>{
 const r=await create(alice,'Mention Circle');await join(bob,r.id);
 const message=await send(alice,r.id,'Hello @MESSENGER_BOB, @messenger_bob. @messenger_carol @messenger_alice');
 const m=(await roomMessage(db,bob,r.id,message.id)).message;assert.deepEqual(m.mentions.map(p=>p.id),[bob.id]);
 assert.equal((await summary(bob,r.id)).mention_count,1);assert.equal((await summary(alice,r.id)).mention_count,0);
 const candidates=await roomMentionCandidates(db,alice,r.id,'messenger_b');assert.deepEqual(candidates.members.map(m=>m.id),[bob.id]);
 await rejects(roomMentionCandidates(db,carol,r.id,''),403);
 assert.ok((await notifications(db,bob)).items.some(n=>n.kind==='room-mention'&&n.target===r.id));
 assert.ok(!(await notifications(db,carol)).items.some(n=>n.kind==='room-mention'&&n.target===r.id));
 await mutate(db,bob,'room-read',{id:r.id,through:m.seq});assert.equal((await summary(bob,r.id)).mention_count,0);
 await mutate(db,bob,'room-leave',{id:r.id});assert.equal((await summary(bob,r.id)).last_message,null);
 assert.ok(!(await notifications(db,bob)).items.some(n=>n.kind==='room-mention'&&n.target===r.id));
 await join(bob,r.id);assert.equal((await summary(bob,r.id)).unread_count,0);
 await mutate(db,alice,'room-delete-message',{id:r.id,messageId:message.id});
 assert.ok(!(await notifications(db,bob)).items.some(n=>n.kind==='room-mention'&&n.target===r.id));
});

test('schema reruns preserve read positions and do not swallow later unread messages',async()=>{
 const r=await create(carol,'Migration Circle');await join(bob,r.id);await send(carol,r.id,'Seen');
 const through=(await roomThread(db,bob,r.id)).messages.at(-1).seq;await mutate(db,bob,'room-read',{id:r.id,through});
 await send(carol,r.id,'Still unread after migration');await pg.exec(schema);
 assert.equal((await summary(bob,r.id)).unread_count,1);assert.equal((await roomThread(db,bob,r.id)).lastReadSeq,through);
});

test('HTTP protects read receipts and quote/mention lookups with session and same-origin checks',async()=>{
 process.env.PUBLIC_APP_URL='https://vyx-social.vercel.app';process.env.VYX_APP_SECRET='isolated-messenger-test';
 const r=await create(bob,'HTTP Circle');await join(alice,r.id);const m=await send(bob,r.id,'HTTP private message');
 const seq=(await roomThread(db,alice,r.id)).messages.at(-1).seq,token='b'.repeat(43);
 await db.q("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",[hash(token),alice.id]);
 const handler=createHandler(fn=>fn(db));
 const call=async(action,{method='GET',auth=true,origin=process.env.PUBLIC_APP_URL,body}={})=>{
  const req={method,url:'/api/vyx?action='+action,body,headers:{origin,'content-type':'application/json',...(auth?{cookie:'vyx_session='+token}:{})},socket:{remoteAddress:'127.0.0.1'}};
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(v){this.result=JSON.parse(v);}};await handler(req,res);return res;
 };
 assert.equal((await call('room-message&id='+r.id+'&messageId='+m.id,{auth:false})).statusCode,401);
 assert.equal((await call('room-mention-candidates&id='+r.id,{auth:false})).statusCode,401);
 assert.equal((await call('room-read',{method:'POST',body:{id:r.id,through:seq},origin:'https://evil.invalid'})).statusCode,403);
 const result=await call('room-read',{method:'POST',body:{id:r.id,through:seq}});assert.equal(result.statusCode,200);assert.equal(result.headers['Cache-Control'],'no-store');
 assert.equal(result.result.room.unread_count,0);
 assert.equal((await call('room-message&id='+r.id+'&messageId='+m.id)).result.message.body,'HTTP private message');
});
