// Concurrency check in an isolated, disposable schema. Never inserts test users into public tables.
import postgres from 'postgres';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {mutate} from '../server/service.js';
import {settleDueWindows} from '../server/farming.js';
const sql=postgres(process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL,{ssl:'require',max:3,prepare:false});
const schema='vyx_check_'+randomBytes(5).toString('hex');
const leased=[];
const wrap=s=>({q:(text,params=[])=>s.unsafe(text,params),tx:async fn=>{
 await s.unsafe('BEGIN');try{const result=await fn(wrap(s));await s.unsafe('COMMIT');return result;}catch(e){await s.unsafe('ROLLBACK');throw e;}
}});
try{
 await sql`CREATE SCHEMA ${sql(schema)}`;
 for(let i=0;i<2;i++){const s=await sql.reserve();leased.push(s);await s`SET search_path TO ${sql(schema)}`;}
 await leased[0].unsafe(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
 const a=wrap(leased[0]),b=wrap(leased[1]);
 const [user]=await a.q("INSERT INTO users(x_id,handle,name) VALUES('123','test.user','Test user') RETURNING *");
 const time=new Date('2026-11-15T12:00:00Z');
 const claims=await Promise.allSettled([mutate(a,user,'claim',{id:'checkin'},time),mutate(b,user,'claim',{id:'checkin'},time)]);
 assert.equal(claims.filter(x=>x.status==='rejected'&&x.reason.status===410).length,2);
 const [fixture]=await a.q("INSERT INTO quest_claims(user_id,season,quest,period) VALUES($1,'season-1','archived-fixture','once') RETURNING id",[user.id]);
 await a.q("INSERT INTO chests(user_id,claim_id,season,tier) VALUES($1,$2,'season-1',0)",[user.id,fixture.id]);
 const requestId=randomUUID();const opens=await Promise.all([mutate(a,user,'open',{tier:0,requestId},time),mutate(b,user,'open',{tier:0,requestId},time)]);
 assert.equal(opens[0].amount,opens[1].amount);
 const [ledger]=await a.q('SELECT count(*)::int AS n,sum(amount)::int AS total FROM point_ledger');
 assert.equal(ledger.n,1);assert.equal(ledger.total,opens[0].amount);
 console.log('Neon concurrency check passed: old quest claims blocked; an existing chest opens once.');
 const eventClaims=await Promise.allSettled([mutate(a,user,'mint-event',{}),mutate(b,user,'mint-event',{})]);
 assert.equal(eventClaims.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(eventClaims.filter(x=>x.status==='rejected'&&x.reason.status===409).length,1);
 const [eventCount]=await a.q('SELECT count(*)::int AS n FROM event_mints WHERE campaign_id=$1',['halloween-2026']);
 assert.equal(eventCount.n,1);
 console.log('Halloween concurrency check passed: one collectible mint for simultaneous requests, no points awarded.');
 const key=randomUUID(),created=await Promise.all([a,b].map(db=>mutate(db,user,'room-create',{name:'Isolated test room',description:'Disposable concurrency fixture',requestId:key})));
 assert.equal(created[0].id,created[1].id);const room=created[0];
 const [peer]=await a.q("INSERT INTO users(x_id,handle,name) VALUES('124','test.peer','Test peer') RETURNING *");
 await Promise.all([a,b].map(db=>mutate(db,peer,'room-join',{id:room.id})));
 assert.equal((await a.q('SELECT count(*)::int AS n FROM room_members WHERE room_id=$1',[room.id]))[0].n,2);
 const messageKey=randomUUID(),sent=await Promise.all([a,b].map(db=>mutate(db,peer,'room-send',{id:room.id,body:'Concurrent fixture message',requestId:messageKey})));
 assert.equal(sent[0].id,sent[1].id);
 const race=await Promise.allSettled([mutate(a,peer,'room-leave',{id:room.id}),mutate(b,peer,'room-send',{id:room.id,body:'Racing leave',requestId:randomUUID()})]);
 assert.equal(race[0].status,'fulfilled');
 if(race[1].status==='rejected')assert.equal(race[1].reason.status,403);
 assert.equal((await a.q('SELECT count(*)::int AS n FROM room_members WHERE room_id=$1 AND user_id=$2',[room.id,peer.id]))[0].n,0);
 console.log('Room concurrency check passed: duplicate create/join/send requests produce one record; leave and send serialize safely.');
 const at=(db,stamp)=>({q:(query,params=[])=>{const values=[...params];if(query.includes('clock_timestamp()')){values.push(stamp);query=query.replaceAll('clock_timestamp()',`$${values.length}::timestamptz`);}return db.q(query,values);},tx:fn=>db.tx(tx=>fn(at(tx,stamp)))});
 const acceptedKey=randomUUID(),accepted=await Promise.all([a,b].map(db=>mutate(at(db,'2026-11-01T00:01:00Z'),user,'room-send',{id:room.id,body:'A thoughtful autumn community message for the isolated reward concurrency check.',requestId:acceptedKey})));
 assert.equal(accepted[0].id,accepted[1].id);
 assert.equal((await a.q('SELECT count(*)::int AS n FROM farm_contributions'))[0].n,1);
 const closures=await Promise.all([a,b].map(db=>settleDueWindows(at(db,'2026-11-01T04:00:00Z'))));
 assert.equal(closures.reduce((n,r)=>n+r.settled,0),1);
 assert.equal((await a.q('SELECT count(*)::int AS n FROM farm_awards'))[0].n,1);
 const [farmCheck]=await a.q("SELECT p.spent::text,(SELECT sum(amount)::bigint FROM farm_awards)::text AS awarded FROM farm_pools p WHERE p.id='season-1'");
 assert.equal(BigInt(farmCheck.spent),BigInt(farmCheck.awarded)+BigInt(opens[0].amount));
 console.log('Farming concurrency check passed: retry counts one contribution, simultaneous drop workers credit once, pool spending matches the receipts.');

}finally{
 for(const s of leased)s.release();
 await sql`DROP SCHEMA IF EXISTS ${sql(schema)} CASCADE`;
 await sql.end({timeout:3});
}
