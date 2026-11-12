import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {mutate,questState,messages,state,feed} from '../server/service.js';
import {startOAuth,consumeAttempt,login,xIdentity,challenge} from '../server/oauth.js';
import {session,hash,sameOrigin,limit} from '../server/http.js';

const pg=new PGlite();
await pg.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
const adapter=p=>({q:async(sql,params=[])=> (await p.query(sql,params)).rows,tx:fn=>p.transaction(tx=>fn(adapter(tx)))});
const db=adapter(pg),now=new Date('2026-11-10T12:00:00Z');
const make=async(id,name)=> (await db.q('INSERT INTO users(x_id,x_username,handle,name) VALUES($1,$2,$2,$3) RETURNING *',[id,'test_'+id,name]))[0];
const alice=await make('101','Alice'),bob=await make('102','Bob'),carol=await make('103','Carol');
after(()=>pg.close());
const rejects=(p,status)=>assert.rejects(p,e=>e.status===status);
test('only the author can edit or delete published posts',async()=>{
 const {id}=await mutate(db,alice,'post',{body:'Original test post for the community.'});
 await mutate(db,bob,'comment',{id,body:'Reply'});
 await mutate(db,bob,'react',{id});
 await rejects(mutate(db,bob,'post-edit',{id,body:'Unauthorized replacement text.'}),404);
 await rejects(mutate(db,bob,'post-delete',{id}),404);
 await mutate(db,alice,'post-edit',{id,body:'Updated test post for the community.'});
 assert.equal((await db.q('SELECT body FROM posts WHERE id=$1',[id]))[0].body,'Updated test post for the community.');
 assert.equal((await db.q('SELECT id FROM comments WHERE post_id=$1',[id])).length,1);
 await mutate(db,alice,'post-delete',{id});
 assert.equal((await db.q('SELECT id FROM posts WHERE id=$1',[id])).length,0);
});

test('new account starts at zero; public state excludes private message data',async()=>{
 const s=await state(db,alice,now);assert.equal(s.user.points,0);assert.deepEqual(s.user.inventory,[0,0,0,0]);assert.ok(!('x_id' in s.user));assert.ok(!('messages' in s));
 const guest=await state(db,null,now);assert.equal(guest.user,null);assert.equal(guest.quests.length,0);assert.ok(guest.members.every(u=>!u.is_system));
});
test('all removed quests are unavailable and cannot award new chests',async()=>{
 for(const id of ['checkin','publish','react','follow','profile','seasonal','journey'])await rejects(mutate(db,alice,'claim',{id},now),410);
 assert.deepEqual(await questState(db,alice,now),[]);
 assert.equal((await db.q('SELECT count(*)::int AS n FROM chests WHERE user_id=$1',[alice.id]))[0].n,0);
});
test('server opens a chest once and replays the same receipt',async()=>{
 const [claim]=await db.q("INSERT INTO quest_claims(user_id,season,quest,period) VALUES($1,'season-1','archived-fixture','once') RETURNING id",[alice.id]);
 await db.q("INSERT INTO chests(user_id,claim_id,season,tier) VALUES($1,$2,'season-1',0)",[alice.id,claim.id]);
 const requestId=randomUUID(),a=await mutate(db,alice,'open',{tier:0,requestId,amount:999999},now);
 assert.ok(a.amount>=20&&a.amount<=80);
 const b=await mutate(db,alice,'open',{tier:0,requestId},now);assert.equal(a.amount,b.amount);
 await rejects(mutate(db,alice,'open',{tier:0,requestId:randomUUID()},now),409);
 const [ledger]=await db.q('SELECT count(*)::int AS n,sum(amount)::int AS amount FROM point_ledger WHERE user_id=$1',[alice.id]);assert.equal(ledger.n,1);assert.equal(ledger.amount,a.amount);
});
test('existing balances stay scoped to their original season',async()=>{
 const december=new Date('2026-12-01T00:00:00Z');
 const s=await state(db,alice,december);assert.equal(s.user.points,0);assert.ok(s.user.all_points>0);
});
test('posts and reactions keep working without active quests',async()=>{
 const p=await mutate(db,bob,'post',{body:'A real community story with #VYX and some details.'},now);
 const own=await mutate(db,alice,'post',{body:'My own story for the season, also with #VYX.'},now);
 await mutate(db,alice,'react',{id:own.id},now);
 const official=(await db.q('SELECT p.id FROM posts p JOIN users u ON u.id=p.user_id WHERE u.is_system'))[0];
 await mutate(db,alice,'react',{id:official.id},now);
 await mutate(db,alice,'react',{id:p.id},now);await mutate(db,alice,'react',{id:p.id},now);await mutate(db,alice,'react',{id:p.id},now);
 assert.deepEqual(await questState(db,alice,now),[]);
 const stories=await feed(db,alice);assert.equal(stories.find(row=>row.id===p.id).likes,1);assert.equal(stories.find(row=>row.id===p.id).liked,true);
 await rejects(mutate(db,alice,'claim',{id:'react'},now),410);
 await rejects(mutate(db,alice,'post',{body:'short'},now),400);
});
test('profiles validate usernames and preserve plain text without SQL interpolation',async()=>{
 await mutate(db,alice,'profile',{name:'Alice',handle:'alice.club',bio:"Hello <script>alert(1)</script> and ' SQL text."},now);
 await rejects(mutate(db,bob,'profile',{name:'Bob',handle:'alice.club',bio:'Hello there.'},now),409);
 await rejects(mutate(db,bob,'profile',{name:'Bob',handle:'vyx.admin',bio:'Hello there.'},now),400);
 const [u]=await db.q('SELECT * FROM users WHERE id=$1',[alice.id]);assert.ok(u.bio.includes('<script>'));assert.equal(u.profile_completed,true);
 await rejects(mutate(db,alice,'claim',{id:'profile'},now),410);
});
test('DMs require mutual follows, are idempotent and are invisible to a third user',async()=>{
 await rejects(mutate(db,alice,'message',{id:bob.id,body:'Hello',requestId:randomUUID()},now),403);
 await mutate(db,alice,'follow',{id:bob.id},now);await mutate(db,bob,'follow',{id:alice.id},now);
 const requestId=randomUUID();const a=await mutate(db,alice,'message',{id:bob.id,body:'Private hello',requestId},now);
 const b=await mutate(db,alice,'message',{id:bob.id,body:'Private hello',requestId},now);assert.equal(a.id,b.id);
 assert.equal((await messages(db,bob,alice.id)).length,1);
 assert.equal((await messages(db,carol,alice.id)).length,0);assert.equal((await messages(db,carol,bob.id)).length,0);
});
test('saved posts remain scoped to their owner',async()=>{
 const [p]=await db.q('SELECT id FROM posts WHERE user_id=$1',[bob.id]);await mutate(db,alice,'save',{id:p.id},now);
 assert.equal((await feed(db,alice,{filter:'saved'})).length,1);assert.equal((await feed(db,bob,{filter:'saved'})).length,0);assert.equal((await feed(db,null,{filter:'saved'})).length,0);
});
test('OAuth uses S256, minimum scopes, a cookie-bound state and rejects replay',async()=>{
 process.env.X_CLIENT_ID='test-client';process.env.X_CLIENT_SECRET='test-secret';process.env.PUBLIC_APP_URL='https://vyx-social.vercel.app';
 const binding='a'.repeat(43),url=new URL(await startOAuth(db,binding));
 assert.equal(url.origin,'https://x.com');assert.equal(url.searchParams.get('scope'),'tweet.read users.read');assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 const s=url.searchParams.get('state');await rejects(consumeAttempt(db,s,'b'.repeat(43)),400);
 const attempt=await consumeAttempt(db,s,binding);assert.equal(challenge(attempt.verifier),url.searchParams.get('code_challenge'));
 await rejects(consumeAttempt(db,s,binding),400);
});
test('repeated X login keeps one user and preserves the edited VYX profile',async()=>{
 const a=await db.tx(tx=>login(tx,{id:'999',username:'samex',name:'Original',avatar:''}));
 await mutate(db,a.user,'profile',{name:'Edited',handle:'edited.user',bio:'My public story.'},now);
 const b=await db.tx(tx=>login(tx,{id:'999',username:'newx',name:'Changed on X',avatar:''}));
 assert.equal(a.user.id,b.user.id);assert.equal(b.user.name,'Edited');assert.equal(b.user.handle,'edited.user');
 const [s]=await db.q('SELECT token_hash FROM sessions WHERE user_id=$1',[a.user.id]);assert.notEqual(s.token_hash,a.sessionToken);assert.equal(s.token_hash.length,64);
 const resolved=await session(db,{headers:{cookie:'vyx_session='+b.sessionToken}});assert.equal(resolved.id,a.user.id);
 assert.equal(await session(db,{headers:{cookie:'vyx_session=forged'}}),null);
});
test('X token exchange does not request write access or accept malformed identities',async()=>{
 let calls=0;const fetcher=async(url,options)=>{calls++;if(calls===1){assert.equal(url,'https://api.x.com/2/oauth2/token');assert.ok(options.headers.Authorization.startsWith('Basic '));return {ok:true,json:async()=>({access_token:'test-access'})};}assert.equal(options.headers.Authorization,'Bearer test-access');return {ok:true,json:async()=>({data:{id:'777',username:'valid',name:'User',profile_image_url:'https://tracker.invalid/a'}})};};
 const identity=await xIdentity('code','verifier',fetcher);assert.equal(identity.avatar,'');assert.equal(identity.id,'777');assert.equal(calls,2);
 await rejects(xIdentity('bad','bad',async()=>({ok:false})),502);
});
test('CSRF blocks foreign and missing origins, and rate limits persist',async()=>{
 assert.throws(()=>sameOrigin({headers:{origin:'https://evil.invalid'}}),e=>e.status===403);assert.throws(()=>sameOrigin({headers:{}}),e=>e.status===403);
 sameOrigin({headers:{origin:'https://vyx-social.vercel.app'}});
 await limit(db,'test-limit',1,60,now);await rejects(limit(db,'test-limit',1,60,now),429);
});
