import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {listRooms} from '../server/rooms.js';

const pg=new PGlite();await pg.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
const base=Date.parse('2026-11-05T12:00:00Z'),at=hours=>new Date(base+hours*3600000).toISOString();
let clock=at(0);
const db={q:async(sql,params=[])=>{
 if(sql.includes('statement_timestamp()')){params=[...params,clock];sql=sql.replaceAll('statement_timestamp()',`$${params.length}::timestamptz`);}
 return (await pg.query(sql,params)).rows;
}};
const people=[];
for(let i=0;i<4;i++)people.push((await db.q('INSERT INTO users(x_id,handle,name) VALUES($1,$2,$2) RETURNING *',['activity_'+i,'activity_'+i]))[0]);
const system=(await db.q("INSERT INTO users(handle,name,is_system) VALUES('activity_system','System',true) RETURNING *"))[0];
async function room(name,created=-120){
 const [r]=await db.q('INSERT INTO rooms(owner_id,name,request_id,created_at) VALUES($1,$2,$3,$4) RETURNING *',[people[0].id,name,randomUUID(),at(created)]);
 await db.q('INSERT INTO room_members(room_id,user_id) VALUES($1,$2)',[r.id,people[0].id]);return r;
}
async function message(r,person,body,hours=0,deleted=false){
 return (await db.q('INSERT INTO room_messages(room_id,sender_id,body,request_id,created_at,deleted_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[r.id,person.id,body,randomUUID(),at(hours),deleted?at(0):null]))[0];
}
const directory=search=>listRooms(db,null,{search});
after(()=>pg.close());

test('sustained conversation ranks above one fresh message and a newly created empty room',async()=>{
 const active=await room('Sustained: old community'),recent=await room('Sustained: last message',-1),empty=await room('Sustained: newest empty',0);
 for(const [i,p] of people.entries())for(const hour of [-18,-12,-6])await message(active,p,'Conversation '+i+' at '+hour,hour);
 await message(recent,people[0],'The most recent message',0);
 const result=await directory('Sustained:');assert.deepEqual(result.rooms.map(r=>r.id),[active.id,recent.id,empty.id]);
 assert.ok(!JSON.stringify(result).includes('score'));assert.equal(result.rooms[0].last_message,null);
});

test('several participants outrank a single-author flood; deleted and system messages do not help',async()=>{
 const community=await room('Diversity: community'),flood=await room('Diversity: flood'),removed=await room('Diversity: removed'),automated=await room('Diversity: system');
 for(const p of people)await message(community,p,'My contribution '+p.handle);
 for(let i=0;i<100;i++)await message(flood,people[0],'Flood item '+i);
 for(let i=0;i<12;i++){await message(removed,people[i%4],'Removed '+i,0,true);await message(automated,system,'Automated '+i);}
 const rows=(await directory('Diversity:')).rooms;assert.equal(rows[0].id,community.id);assert.equal(rows[1].id,flood.id);
});

test('repeating old text with case or whitespace changes cannot refresh its ranking',async()=>{
 const repeated=await room('Repeats: repeated old conversation'),fresh=await room('Repeats: fresh conversation');
 for(const p of people){await message(repeated,p,'A shared idea',-72);for(let i=0;i<8;i++)await message(repeated,p,'  A   SHARED\nidea  ');}
 await message(fresh,people[0],'A new conversation today');
 assert.equal((await directory('Repeats:')).rooms[0].id,fresh.id);
});

test('idle rooms decay and activity outside seven days or in the future cannot inflate the list',async()=>{
 const established=await room('Decay: established'),challenger=await room('Decay: challenger'),ancient=await room('Decay: ancient');
 for(const p of people){await message(established,p,'Earlier discussion '+p.handle,-1);await message(ancient,p,'Archived week '+p.handle,-169);}
 await message(challenger,people[0],'Tomorrow is not activity yet',48);
 clock=at(0);assert.equal((await directory('Decay:')).rooms[0].id,established.id);
 clock=at(24);assert.equal((await directory('Decay:')).rooms[0].id,established.id);
 clock=at(48);assert.equal((await directory('Decay:')).rooms[0].id,challenger.id);clock=at(0);
});

test('ranking happens before pagination, applies to joined/search lists, and includes media conversations',async()=>{
 const busy=await room('Pages: oldest active',-150);
 const m=await message(busy,people[0],'');
 await db.q("INSERT INTO media_assets(id,owner_id,scope,target_id,kind,content_type,byte_size,pathname,status,room_message_id) VALUES($1,$2,'room',$3,'image','image/png',100,$4,'attached',$5)",[randomUUID(),people[0].id,busy.id,'activity-test/'+randomUUID(),m.id]);
 for(let i=0;i<26;i++)await room('Pages: quiet '+i,-i);
 const first=await directory('Pages:'),second=await listRooms(db,null,{search:'Pages:',page:first.nextPage});
 assert.equal(first.rooms[0].id,busy.id);assert.equal(first.rooms.length,24);assert.equal(second.rooms.length,3);
 assert.equal(new Set([...first.rooms,...second.rooms].map(r=>r.id)).size,27);
 assert.equal((await listRooms(db,people[0],{filter:'mine',search:'Pages:'})).rooms[0].id,busy.id);
 const [closed]=await db.q('UPDATE rooms SET archived_at=$2 WHERE id=$1 RETURNING id',[busy.id,at(0)]);
 assert.ok(!(await directory('Pages:')).rooms.some(r=>r.id===closed.id));
});
