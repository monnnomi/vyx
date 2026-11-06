import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {login,startOAuth,consumeAttempt} from '../server/oauth.js';
import {adminOverview,isAdmin} from '../server/admin.js';
import {createAdminHandler} from '../api/admin.js';
import {createPresenceHandler,touchPresence} from '../api/presence.js';
import {createHandler} from '../api/vyx.js';
import {mutate} from '../server/service.js';
import {hash,token} from '../server/http.js';

const pg=new PGlite();await pg.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
const wrap=(p,time)=>({q:async(sql,args=[])=>{
 if(time&&sql.includes('clock_timestamp()')){sql=sql.replaceAll('clock_timestamp()',`($${args.length+1}::timestamptz)`);args=[...args,time];}
 return (await p.query(sql,args)).rows;
},tx:fn=>p.transaction(tx=>fn(wrap(tx,time)))}),db=wrap(pg);
const owner=await db.tx(tx=>login(tx,{id:'1001',username:'owner',name:'Owner',avatar:''}));
const member=await db.tx(tx=>login(tx,{id:'1002',username:'owner_name_copy',name:'Owner',avatar:''}));
process.env.PUBLIC_APP_URL='https://vyx-social.vercel.app';process.env.VYX_APP_SECRET=token();process.env.VYX_ADMIN_X_IDS='1001';
after(()=>pg.close());
async function call(handler,{method='GET',url='/api/admin',user=null,origin='https://vyx-social.vercel.app',body={}}={}){
 const headers={origin,'content-type':'application/json'};if(user)headers.cookie='vyx_session='+user.sessionToken;
 const req={method,url,headers,body};const res={headers:{},statusCode:200,setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(data){this.text=data;}};
 await handler(req,res);return {status:res.statusCode,headers:res.headers,data:JSON.parse(res.text)};
}
test('administrator role uses an explicit immutable X allowlist and fails closed',()=>{
 assert.equal(isAdmin(owner.user),true);assert.equal(isAdmin(member.user),false);
 const previous=process.env.VYX_ADMIN_X_IDS;delete process.env.VYX_ADMIN_X_IDS;
 assert.equal(isAdmin(owner.user),false);process.env.VYX_ADMIN_X_IDS=previous;
});
test('admin API denies anonymous and normal authenticated users without returning private records',async()=>{
 const handler=createAdminHandler(fn=>fn(db));
 for(const [user,status] of [[null,401],[member,403]]){
  const r=await call(handler,{user,url:'/api/admin?admin=true&x_id=1001'});assert.equal(r.status,status);assert.deepEqual(Object.keys(r.data),['error']);assert.equal(r.headers['cache-control'],'no-store');
 }
 const ok=await call(handler,{user:owner});assert.equal(ok.status,200);assert.equal(ok.data.counts.connected,2);assert.equal(ok.data.users.length,2);
});
test('online counts deduplicate signed-in accounts and exclude expired activity',async()=>{
 const first=token(),second=token(),guest=token(),expired=token();
 await touchPresence(db,member.user,first,'feed');await touchPresence(db,member.user,second,'profile');await touchPresence(db,null,guest,'feed');await touchPresence(db,null,expired,'feed');
 await db.q("UPDATE presence_sessions SET last_seen_at=clock_timestamp()-interval '91 seconds' WHERE token_hash=$1",[hash(expired)]);
 const result=await adminOverview(db,owner.user);assert.equal(result.counts.online_members,1);assert.equal(result.counts.online_guests,1);assert.equal(result.counts.online,2);
 assert.equal(result.users.find(u=>u.id===member.user.id).online,true);
 const [stored]=await db.q('SELECT token_hash FROM presence_sessions WHERE token_hash=$1',[hash(first)]);assert.notEqual(stored.token_hash,first);
});
test('mint monitoring and filters report one collectible for one connected account',async()=>{
 const mintTime=new Date('2026-10-31T12:00:00Z');
 await mutate(wrap(pg,mintTime),member.user,'mint-event',{},mintTime);
 const result=await adminOverview(db,owner.user,{filter:'minted'});assert.equal(result.counts.minted,1);assert.equal(result.counts.not_minted,1);assert.equal(result.users.length,1);assert.equal(result.users[0].x_id,'1002');assert.ok(result.users[0].mint_id);
 const pending=await adminOverview(db,owner.user,{filter:'not-minted'});assert.equal(pending.users.length,1);assert.equal(pending.users[0].x_id,'1001');
 assert.equal((await adminOverview(db,owner.user,{query:'does-not-exist'})).users.length,0);
 assert.equal((await adminOverview(db,owner.user,{query:"' OR 1=1 --"})).users.length,0);
});
test('mint and presence routes ignore forged identity values and enforce origin checks',async()=>{
 const app=createHandler(fn=>fn(db)),presence=createPresenceHandler(fn=>fn(db));
 const denied=await call(app,{method:'POST',url:'/api/vyx?action=mint-event',body:{x_id:'1001',user_id:owner.user.id}});assert.equal(denied.status,401);
 const foreign=await call(presence,{method:'POST',url:'/api/presence',origin:'https://other.invalid'});assert.equal(foreign.status,403);
 const guest=await call(presence,{method:'POST',url:'/api/presence',body:{page:'admin',user_id:owner.user.id}});assert.equal(guest.status,200);assert.deepEqual(guest.data,{ok:true});assert.ok(/httponly/i.test(guest.headers['set-cookie']));assert.ok(/secure/i.test(guest.headers['set-cookie']));
});
test('successful X logins update connection metadata without making another user',async()=>{
 const again=await db.tx(tx=>login(tx,{id:'1002',username:'renamed',name:'Same person',avatar:''}));assert.equal(again.user.id,member.user.id);assert.equal(again.user.login_count,2);assert.ok(again.user.last_login_at);
 assert.equal((await adminOverview(db,owner.user)).counts.connected,2);
});
test('admin OAuth return is allowed, arbitrary external redirects are rejected',async()=>{
 process.env.X_CLIENT_ID='test-client';process.env.X_CLIENT_SECRET='test-secret';
 for(const [path,expected] of [['/admin','/admin'],['https://evil.invalid','/']]){
  const binding=token(),url=new URL(await startOAuth(db,binding,new Date(),path));const attempt=await consumeAttempt(db,url.searchParams.get('state'),binding);assert.equal(attempt.return_to,expected);
 }
});
