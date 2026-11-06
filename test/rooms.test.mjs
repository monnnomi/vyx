import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {mutate,messages} from '../server/service.js';
import {listRooms,roomSummary,roomThread,roomMembers} from '../server/rooms.js';
import {createHandler} from '../api/vyx.js';
import {hash} from '../server/http.js';

const pg=new PGlite();await pg.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
const wrap=p=>({q:async(s,v=[]) =>(await p.query(s,v)).rows,tx:fn=>p.transaction(tx=>fn(wrap(tx)))}),db=wrap(pg);
const make=async(n,x=true)=>(await db.q('INSERT INTO users(x_id,handle,name) VALUES($1,$2,$3) RETURNING *',[x?String(n):null,'room_test_'+n,'Member '+n]))[0];
const alice=await make(901),bob=await make(902),carol=await make(903),unlinked=await make(904,false);
const rejects=(p,status)=>assert.rejects(p,e=>e.status===status);
const create=(u,name='Autumn Circle',more={})=>mutate(db,u,'room-create',{name,description:'A place for our shared interests.',requestId:randomUUID(),...more});
const send=(u,id,body,requestId=randomUUID())=>mutate(db,u,'room-send',{id,body,requestId});
after(()=>pg.close());
let main,other;

test('X account creates a real room, joins once and retries creation safely',async()=>{
 const requestId=randomUUID();main=await create(alice,'Autumn Circle',{requestId});
 assert.equal((await create(alice,'Autumn Circle',{requestId})).id,main.id);
 await rejects(create(alice,'Different',{requestId}),409);
 const guest=await listRooms(db,null);assert.equal(guest.rooms.length,1);assert.equal(guest.rooms[0].member_count,1);assert.equal(guest.rooms[0].joined,false);
 assert.equal((await listRooms(db,alice,{filter:'mine'})).rooms[0].joined,true);
 assert.ok(!JSON.stringify(guest).includes('request_id'));assert.ok(!JSON.stringify(guest).includes('x_id'));
 await mutate(db,bob,'room-join',{id:main.id});await mutate(db,bob,'room-join',{id:main.id});
 assert.equal((await roomSummary(db,bob,main.id)).room.member_count,2);
});
test('guests and unlinked identities cannot create, join, read members or chat',async()=>{
 await rejects(create(unlinked),401);await rejects(roomThread(db,null,main.id),401);
 await rejects(mutate(db,unlinked,'room-join',{id:main.id}),401);
 await rejects(roomThread(db,carol,main.id),403);await rejects(roomMembers(db,carol,main.id),403);
 await rejects(send(carol,main.id,'Not a member'),403);await rejects(listRooms(db,null,{filter:'mine'}),401);
});
test('members share messages without mutual follows; room and DM access stay isolated',async()=>{
 const key=randomUUID(),message=await send(alice,main.id,'Hello from Alice',key);
 assert.equal((await send(alice,main.id,'Hello from Alice',key)).id,message.id);
 await rejects(send(alice,main.id,'Changed text',key),409);
 await send(bob,main.id,'Hello Alice');
 const thread=await roomThread(db,bob,main.id);assert.deepEqual(thread.messages.map(m=>m.body),['Hello from Alice','Hello Alice']);
 assert.equal(thread.messages[0].sender_id,alice.id);assert.ok(!JSON.stringify(thread).includes('x_id'));
 other=await create(carol,'Winter Circle');await rejects(roomThread(db,bob,other.id),403);
 await rejects(send(alice,other.id,'Wrong room',key),403);
 assert.equal((await messages(db,bob,alice.id)).length,0);
 const members=await roomMembers(db,bob,main.id);assert.equal(members.members.length,2);
});
test('room fields and message lengths validate and SQL-like text stays plain text',async()=>{
 await rejects(create(alice,'xx'),400);await rejects(create(alice,'x'.repeat(49)),400);await rejects(create(alice,'Valid',{description:'x'.repeat(241)}),400);
 await rejects(send(alice,main.id,' '),400);await rejects(send(alice,main.id,'x'.repeat(2001)),400);
 const body="<script>alert('x')</script> '); DROP TABLE rooms; --";await send(bob,main.id,body);
 assert.equal((await roomThread(db,bob,main.id)).messages.at(-1).body,body);
 await rejects(roomThread(db,alice,main.id,'bad'),400);await rejects(roomThread(db,alice,main.id,'9999999999999999999'),400);
 assert.equal((await listRooms(db,null,{search:'autumn'})).rooms.length,1);
 assert.equal((await listRooms(db,null,{search:'%'})).rooms.length,0);
 await rejects(listRooms(db,null,{page:'-1'}),400);
});
test('leaving removes read and write access; rejoining restores existing history',async()=>{
 await mutate(db,bob,'room-leave',{id:main.id});await rejects(roomThread(db,bob,main.id),403);await rejects(send(bob,main.id,'No longer joined'),403);
 assert.equal((await listRooms(db,bob,{filter:'mine'})).rooms.length,0);
 await mutate(db,bob,'room-join',{id:main.id});assert.ok((await roomThread(db,bob,main.id)).messages.length>=3);
 await rejects(mutate(db,alice,'room-leave',{id:main.id}),409);
});
test('only sender or room owner can remove a message, with no cross-room bypass',async()=>{
 const a=await send(alice,main.id,'Owner message'),b=await send(bob,main.id,'Member message');
 await rejects(mutate(db,bob,'room-delete-message',{id:main.id,messageId:a.id}),403);
 await rejects(mutate(db,carol,'room-delete-message',{id:other.id,messageId:b.id}),404);
 await mutate(db,alice,'room-delete-message',{id:main.id,messageId:b.id});
 await mutate(db,alice,'room-delete-message',{id:main.id,messageId:a.id});
 const ids=(await roomThread(db,bob,main.id)).messages.map(m=>m.id);assert.ok(!ids.includes(a.id));assert.ok(!ids.includes(b.id));
 assert.equal((await db.q('SELECT count(*)::int AS n FROM room_messages WHERE deleted_at IS NOT NULL'))[0].n,2);
});
test('history uses stable cursors, without duplicates across pages',async()=>{
 const room=await create(carol,'History Circle');
 await db.q(`INSERT INTO room_messages(room_id,sender_id,body,request_id) SELECT $1,$2,'Message '||n,gen_random_uuid() FROM generate_series(1,125) n`,[room.id,carol.id]);
 const a=await roomThread(db,carol,room.id),b=await roomThread(db,carol,room.id,a.nextBefore),c=await roomThread(db,carol,room.id,b.nextBefore);
 assert.equal(a.messages.length,60);assert.equal(b.messages.length,60);assert.equal(c.messages.length,5);assert.equal(c.nextBefore,null);
 const all=[...c.messages,...b.messages,...a.messages];assert.equal(new Set(all.map(m=>m.id)).size,125);assert.equal(all[0].body,'Message 1');assert.equal(all.at(-1).body,'Message 125');
 await rejects(send(carol,room.id,'Rate limited'),429);
});
test('account limits and owner-only closing are enforced on the server',async()=>{
 const u=await make(905);for(let i=0;i<5;i++)await create(u,'Limit room '+i);await rejects(create(u,'Sixth room'),429);
 await rejects(mutate(db,bob,'room-close',{id:main.id}),403);
 await mutate(db,alice,'room-close',{id:main.id});
 assert.ok(!(await listRooms(db,null)).rooms.some(r=>r.id===main.id));
 await rejects(roomThread(db,bob,main.id),404);await rejects(mutate(db,bob,'room-join',{id:main.id}),404);await rejects(send(bob,main.id,'Closed'),404);
});
test('HTTP requires session and same origin, ignores forged actor, and never returns chat to guests',async()=>{
 process.env.PUBLIC_APP_URL='https://vyx-social.vercel.app';process.env.VYX_APP_SECRET='isolated-test-secret';
 const handler=createHandler(fn=>fn(db)),token='a'.repeat(43);
 await db.q("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",[hash(token),bob.id]);
 const call=async(action,{method='GET',body,auth=false,origin=process.env.PUBLIC_APP_URL}={})=>{
  const req={method,url:'/api/vyx?action='+action,body,headers:{origin,'content-type':'application/json',...(auth?{cookie:'vyx_session='+token}:{})},socket:{remoteAddress:'127.0.0.1'}};
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(v){this.result=JSON.parse(v);}};await handler(req,res);return res;
 };
 assert.equal((await call('room-thread&id='+other.id)).statusCode,401);
 assert.equal((await call('room-create',{method:'POST',body:{name:'Forged',requestId:randomUUID()}})).statusCode,401);
 assert.equal((await call('room-join',{method:'POST',auth:true,origin:'https://evil.invalid',body:{id:other.id}})).statusCode,403);
 const joined=await call('room-join',{method:'POST',auth:true,body:{id:other.id,user_id:carol.id}});assert.equal(joined.statusCode,200);
 assert.equal((await roomSummary(db,bob,other.id)).room.joined,true);
 const thread=await call('room-thread&id='+other.id,{auth:true});assert.equal(thread.statusCode,200);assert.equal(thread.headers['Cache-Control'],'no-store');
 assert.equal((await call('rooms')).result.rooms.some(r=>'messages' in r),false);
});
test('room discovery paginates, and membership and room capacity limits hold',async()=>{
 const u=await make(906);
 await db.q(`INSERT INTO rooms(owner_id,name,request_id) SELECT $1,'Membership fixture '||n,gen_random_uuid() FROM generate_series(1,50) n`,[u.id]);
 await db.q('INSERT INTO room_members(room_id,user_id) SELECT id,$1 FROM rooms WHERE owner_id=$1',[u.id]);
 await rejects(mutate(db,u,'room-join',{id:other.id}),409);
 const a=await listRooms(db,null),b=await listRooms(db,null,{page:a.nextPage});
 assert.equal(a.rooms.length,24);assert.equal(b.rooms.length,24);assert.equal(new Set([...a.rooms,...b.rooms].map(r=>r.id)).size,48);
 const full=await create(alice,'Full room');
 await db.q(`INSERT INTO users(x_id,handle,name) SELECT 'fill_'||n,'capacity_'||n,'Capacity fixture' FROM generate_series(1,499) n`);
 await db.q("INSERT INTO room_members(room_id,user_id) SELECT $1,id FROM users WHERE handle LIKE 'capacity_%'",[full.id]);
 await rejects(mutate(db,bob,'room-join',{id:full.id}),409);
 assert.equal((await roomSummary(db,null,full.id)).room.member_count,500);
});
