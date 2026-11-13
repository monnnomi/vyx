import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {login,startOAuth,consumeAttempt} from '../server/oauth.js';
import {taskState,verifyTasks,xTasks,campaignPost,campaignPosts,awardTask,reserveXCheckRead} from '../server/x-tasks.js';
import {taskScopes,saveTaskAccess,openTaskToken,sealTaskToken} from '../server/x-task-access.js';
import {createHandler} from '../api/vyx.js';
import {ownNftSelection} from '../server/nft-selection.js';
import {members} from '../server/service.js';
import {token} from '../server/http.js';
const pg=new PGlite();await pg.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
const wrap=p=>({q:async(s,v=[])=> (await p.query(s,v)).rows,tx:fn=>p.transaction(tx=>fn(wrap(tx)))}),db=wrap(pg);after(()=>pg.close());
process.env.X_TASK_DAILY_BUDGET_CENTS='10000';process.env.VYX_APP_SECRET='test-secret-not-production';process.env.X_CLIENT_ID='test-client';process.env.PUBLIC_APP_URL='https://joinvyx.com';
const make=id=>db.tx(tx=>login(tx,{id,username:'tasks_'+id,name:'Task member '+id,avatar:''}));
const alice=await make('7001'),bob=await make('7002');
const grant=()=>({access_token:'PRIVATE-TOKEN',scope:taskScopes.join(' '),expires_in:7200});
const response=(data,status=200)=>({ok:status===200,status,json:async()=>data});
const timeline=(id,target=campaignPost)=>['retweeted','replied_to','quoted'].map((type,i)=>({id:String(BigInt(campaignPost)+BigInt(i+1)),author_id:id,referenced_tweets:[{type,id:target}]}));
function mock(user,{following=true,liked=true,likedPosts=campaignPosts,posts=campaignPosts.flatMap(postId=>timeline(user.x_id,postId))}={}){return async(url,options)=>{assert.equal(options.headers.Authorization,'Bearer PRIVATE-TOKEN');assert.ok(!options.method||options.method==='GET');if(url.includes('by/username'))return response({data:{id:'1234',connection_status:following?['following']:[]}});if(url.includes('liked_tweets'))return response({data:liked?likedPosts.map(id=>({id})):[],meta:{}});if(url.includes('/tweets?'))return response({data:posts,meta:{}});throw Error('Unexpected endpoint');};}
async function unlock(user){await db.q('DELETE FROM x_task_runs WHERE user_id=$1',[user.id]);}

test('task rewards exactly match the campaign and cannot be changed by callers',()=>{assert.deepEqual(xTasks.map(t=>t.amount),[1000,1500,2000,1500,2500,1500,2000,1500]);assert.equal(xTasks.reduce((n,t)=>n+t.amount,0),13500);assert.equal(new Set(xTasks.map(t=>t.id)).size,8);assert.ok(xTasks.slice(5).every(t=>t.postId==='2121127790556680479'&&t.url.endsWith(t.postId)));});
test('task OAuth is read-only, bound to the signed-in X identity, with an allowlisted return',async()=>{
 const binding=token(),u=new URL(await startOAuth(db,binding,new Date(),'/tasks',null,alice.user.x_id));assert.equal(u.searchParams.get('scope'),taskScopes.join(' '));assert.doesNotMatch(u.searchParams.get('scope'),/write|offline|dm\./);
 const a=await consumeAttempt(db,u.searchParams.get('state'),binding);assert.equal(a.return_to,'/tasks');assert.equal(a.expected_x_id,alice.user.x_id);
 const normal=new URL(await startOAuth(db,token()));assert.equal(normal.searchParams.get('scope'),'tweet.read users.read');
});
test('short-lived verification tokens are encrypted and bound to their account; incomplete grants are rejected',async()=>{
 const sealed=sealTaskToken('PRIVATE-TOKEN',alice.user.x_id);assert.ok(!sealed.includes('PRIVATE'));assert.equal(openTaskToken(sealed,alice.user.x_id),'PRIVATE-TOKEN');assert.throws(()=>openTaskToken(sealed,bob.user.x_id));
 assert.equal(await saveTaskAccess(db,alice.user,{...grant(),scope:'tweet.read users.read'}),false);
 assert.equal(await saveTaskAccess(db,alice.user,grant()),true);await saveTaskAccess(db,bob.user,grant());
 assert.equal((await taskState(db,alice.user)).connected,true);assert.ok(!JSON.stringify(await taskState(db,alice.user)).includes('PRIVATE-TOKEN'));
});
test('official positive proofs award exactly once, debit promotions and update the shared VP ledger',async()=>{
 const before=(await db.q("SELECT spent FROM farm_pools WHERE id='promotions'"))[0].spent;
 const r=await verifyTasks(db,alice.user,{taskId:'all',amount:999999,userId:bob.user.id},mock(alice.user));assert.equal(r.awarded,13500);assert.equal(r.earned,13500);assert.ok(r.tasks.every(t=>t.status==='awarded'));
 const again=await verifyTasks(db,alice.user,{taskId:'all'},()=>{throw Error('Must not call X twice');});assert.equal(again.awarded,0);
 assert.equal(Number((await db.q("SELECT spent FROM farm_pools WHERE id='promotions'"))[0].spent)-Number(before),13500);
 assert.equal(Number((await db.q('SELECT sum(amount) AS n FROM reward_ledger WHERE user_id=$1',[alice.user.id]))[0].n),13500);
 assert.equal((await ownNftSelection(db,alice.user)).confirmedVP,13500);
 assert.equal((await members(db,alice.user,'season-1')).find(u=>u.id===alice.user.id).points,13500);
});
test('wrong author, wrong target, likes, quotes and replies cannot masquerade as each other',async()=>{
 const r=await verifyTasks(db,bob.user,{taskId:'all'},mock(bob.user,{following:false,liked:false,posts:[...timeline(alice.user.x_id),...timeline(bob.user.x_id,'111')]}));assert.equal(r.awarded,0);assert.equal(r.earned,0);assert.ok(r.tasks.every(t=>t.status==='not-verified'));
 await assert.rejects(verifyTasks(db,bob.user,{taskId:'all'},mock(bob.user)),e=>e.status===429);
 await unlock(bob.user);
 const onlyReply=timeline(bob.user.x_id).filter(p=>p.referenced_tweets[0].type==='replied_to');
 const v=await verifyTasks(db,bob.user,{taskId:'all'},mock(bob.user,{following:false,liked:false,posts:onlyReply}));assert.equal(v.awarded,1500);assert.equal(v.tasks.find(t=>t.kind==='quote').status,'not-verified');
});
test('X failures, partial responses, missing relationship and pagination limits never create a reward',async()=>{
 for(const code of [401,402,403,429,500]){await unlock(bob.user);const r=await verifyTasks(db,bob.user,{taskId:xTasks[0].id},async()=>response({},code));assert.equal(r.awarded,0);assert.equal(r.tasks[0].status,'unavailable');}
 await unlock(bob.user);const partial=await verifyTasks(db,bob.user,{taskId:xTasks[0].id},async()=>response({data:{id:'1234'}}));assert.equal(partial.awarded,0);
 await unlock(bob.user);const broken=await verifyTasks(db,bob.user,{taskId:xTasks[1].id},async()=>response({data:[{id:campaignPost}],errors:[{message:'partial'}]}));assert.equal(broken.awarded,0);
 await unlock(bob.user);let calls=0;const limit=await verifyTasks(db,bob.user,{taskId:xTasks[1].id},async()=>{calls++;return response({data:[{id:'123'}],meta:{next_token:'next'}});});assert.equal(calls,3);assert.equal(limit.awarded,0);
});
test('exhausted reserve rolls back and duplicate award cannot debit the fund again',async()=>{
 const [pool]=await db.q("SELECT spent FROM farm_pools WHERE id='promotions'");
 await db.q("UPDATE farm_pools SET spent=budget WHERE id='promotions'");
 await assert.rejects(awardTask(db,bob.user,xTasks[0],'1234'),e=>e.status===409);
 assert.equal((await db.q('SELECT * FROM x_task_awards WHERE user_id=$1 AND task_id=$2',[bob.user.id,xTasks[0].id])).length,0);
 await db.q("UPDATE farm_pools SET spent=$1 WHERE id='promotions'",[pool.spent]);
 assert.equal(await awardTask(db,alice.user,xTasks[0],'1234'),0);
});
test('private task verification requires sign-in and same-origin; expired access requires reconnect',async()=>{
 const app=createHandler(fn=>fn(db));async function call({user=null,origin='https://joinvyx.com',action='verify-tasks'}={}){const r={headers:{},statusCode:200,setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(t){this.data=JSON.parse(t);}};await app({method:'POST',url:'/api/vyx?action='+action,headers:{origin,'content-type':'application/json',...(user?{cookie:'vyx_session='+user.sessionToken}:{})},body:{taskId:'all',userId:alice.user.id}},r);return r;}
 assert.equal((await call()).statusCode,401);assert.equal((await call({user:bob,origin:'https://other.invalid'})).statusCode,403);
 await db.q("UPDATE x_task_access SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",[bob.user.id]);await unlock(bob.user);await assert.rejects(verifyTasks(db,bob.user,{taskId:xTasks[0].id},mock(bob.user)),e=>e.status===409);
 assert.equal((await taskState(db,bob.user)).connected,false);
});

test('verification reads have an atomic daily allowance before calling X',async()=>{
 await db.q('DELETE FROM x_task_api_budget');process.env.X_TASK_DAILY_BUDGET_CENTS='6';
 await reserveXCheckRead(db,'https://api.x.com/2/users/by/username/vyxsocial');
 await reserveXCheckRead(db,'https://api.x.com/2/users/7001/tweets?max_results=10');
 await assert.rejects(reserveXCheckRead(db,'https://api.x.com/2/users/7001/liked_tweets?max_results=10'),e=>e.status===503);
 const [r]=await db.q('SELECT reserved_cents FROM x_task_api_budget');assert.equal(r.reserved_cents,6);process.env.X_TASK_DAILY_BUDGET_CENTS='10000';
});

test('historical task receipts stay intact and only the three new actions add another 5000 VP',async()=>{
 const account=await make('7010');await saveTaskAccess(db,account.user,grant());
 for(const task of xTasks.slice(0,5))await awardTask(db,account.user,task,'historical-'+task.kind);
 const before=await db.q('SELECT * FROM x_task_awards WHERE user_id=$1 ORDER BY task_id',[account.user.id]);
 const poolBefore=Number((await db.q("SELECT spent FROM farm_pools WHERE id='promotions'"))[0].spent),calls=[];
 const provider=mock(account.user,{likedPosts:[campaignPosts[1]],posts:timeline(account.user.x_id,campaignPosts[1])});
 const result=await verifyTasks(db,account.user,{taskId:'all',postId:campaignPost,amount:999999},async(url,options)=>{calls.push(url);return provider(url,options);});
 assert.equal(result.awarded,5000);assert.equal(result.earned,13500);assert.equal(result.total,13500);assert.ok(result.tasks.every(t=>t.status==='awarded'));
 assert.equal(calls.length,2);assert.equal(calls.filter(u=>u.includes('/liked_tweets')).length,1);assert.ok(calls.find(u=>u.includes('/tweets?')).includes('since_id='+campaignPosts[1]));
 const after=await db.q('SELECT * FROM x_task_awards WHERE user_id=$1 ORDER BY task_id',[account.user.id]);
 assert.deepEqual(after.filter(r=>before.some(old=>old.id===r.id)),before);
 assert.equal(Number((await db.q("SELECT spent FROM farm_pools WHERE id='promotions'"))[0].spent)-poolBefore,5000);
 assert.equal((await verifyTasks(db,account.user,{taskId:'all'},()=>{throw Error('Already awarded');})).awarded,0);
});

test('supporting either campaign post cannot complete tasks for the other post',async()=>{
 for(const target of campaignPosts){
  const account=await make(target===campaignPost?'7011':'7012');await saveTaskAccess(db,account.user,grant());
  const result=await verifyTasks(db,account.user,{taskId:'all'},mock(account.user,{following:false,likedPosts:[target],posts:timeline(account.user.x_id,target)}));
  assert.equal(result.awarded,target===campaignPost?7500:5000);
  for(const task of result.tasks.filter(t=>t.postId))assert.equal(task.status,task.postId===target?'awarded':'not-verified');
 }
});

test('shared pagination continues beyond the old post proofs and reads each likes/timeline page once',async()=>{
 const account=await make('7013');await saveTaskAccess(db,account.user,grant());const calls=[];
 const result=await verifyTasks(db,account.user,{taskId:'all'},async(url)=>{
  const u=new URL(url);calls.push(u);
  if(url.includes('/by/username/'))return response({data:{id:'1234',connection_status:['following']}});
  if(url.includes('/liked_tweets'))return response(u.searchParams.has('pagination_token')?{data:[{id:campaignPost}],meta:{}}:{data:[{id:campaignPosts[1]}],meta:{next_token:'likes-page-2'}});
  if(url.includes('/tweets?'))return response(u.searchParams.has('pagination_token')?{data:timeline(account.user.x_id,campaignPosts[1]),meta:{}}:{data:timeline(account.user.x_id,campaignPost),meta:{next_token:'posts-page-2'}});
  throw Error('Unexpected request');
 });
 assert.equal(result.awarded,13500);assert.equal(calls.filter(u=>u.pathname.endsWith('/liked_tweets')).length,2);assert.equal(calls.filter(u=>u.pathname.endsWith('/tweets')).length,2);
 assert.ok(calls.filter(u=>u.pathname.endsWith('/tweets')).every(u=>u.searchParams.get('since_id')===campaignPost));
});

test('a failed shared scan is not retried per task and partial timeline evidence cannot award VP',async()=>{
 const account=await make('7014');await saveTaskAccess(db,account.user,grant());let likes=0,posts=0;
 const result=await verifyTasks(db,account.user,{taskId:'all'},async url=>{
  if(url.includes('/by/username/'))return response({data:{id:'1234',connection_status:[]}});
  if(url.includes('/liked_tweets')){likes++;return response({},500);}
  if(url.includes('/tweets?')){posts++;return posts===1?response({data:timeline(account.user.x_id,campaignPosts[1]),meta:{next_token:'more'}}):response({data:[],errors:[{message:'partial response'}]});}
  throw Error('Unexpected request');
 });
 assert.equal(result.awarded,0);assert.equal(likes,1);assert.equal(posts,2);
 assert.ok(result.tasks.filter(t=>t.kind==='like'||['reply','repost','quote'].includes(t.kind)).every(t=>t.status==='unavailable'));
 assert.equal((await taskState(db,account.user)).earned,0);
});

test('a single new reply checks only its exact post/type and needs one bounded timeline page',async()=>{
 const account=await make('7015');await saveTaskAccess(db,account.user,grant());const task=xTasks.find(t=>t.kind==='reply'&&t.postId===campaignPosts[1]);let reads=0;
 const result=await verifyTasks(db,account.user,{taskId:task.id},async url=>{
  const u=new URL(url);assert.equal(u.searchParams.get('since_id'),campaignPosts[1]);assert.ok(u.pathname.endsWith('/tweets'));reads++;
  return response({data:timeline(account.user.x_id,campaignPosts[1]).filter(p=>p.referenced_tweets[0].type==='replied_to'),meta:{next_token:'unneeded-page'}});
 });
 assert.equal(reads,1);assert.equal(result.awarded,1500);assert.equal(result.tasks.filter(t=>t.status==='awarded').length,1);
});

test('parallel duplicate claims for a new task debit the promotion pool once',async()=>{
 const account=await make('7016'),task=xTasks.find(t=>t.kind==='like'&&t.postId===campaignPosts[1]);
 const before=Number((await db.q("SELECT spent FROM farm_pools WHERE id='promotions'"))[0].spent);
 const amounts=await Promise.all(Array.from({length:5},()=>awardTask(db,account.user,task,campaignPosts[1])));
 assert.equal(amounts.reduce((a,b)=>a+b,0),1500);assert.equal(Number((await db.q("SELECT spent FROM farm_pools WHERE id='promotions'"))[0].spent)-before,1500);
 assert.equal((await db.q('SELECT count(*)::int n FROM x_task_awards WHERE user_id=$1 AND task_id=$2',[account.user.id,task.id]))[0].n,1);
});

test('an exhausted usable allowance pauses pending actions without X calls or extra reward/check records',async()=>{
 process.env.X_TASK_DAILY_BUDGET_CENTS='100';
 const account=await make('7017');await saveTaskAccess(db,account.user,grant());
 for(const task of xTasks.slice(0,5))await awardTask(db,account.user,task,'historical-'+task.kind);
 await db.q("INSERT INTO x_task_api_budget(day,reserved_cents) VALUES((clock_timestamp() AT TIME ZONE 'UTC')::date,98) ON CONFLICT(day) DO UPDATE SET reserved_cents=98");
 const before=await db.q('SELECT * FROM x_task_awards WHERE user_id=$1 ORDER BY task_id',[account.user.id]),state=await taskState(db,account.user);
 assert.equal(state.connected,true);assert.equal(state.availability.state,'paused');assert.equal(state.earned,8500);
 assert.ok(state.tasks.slice(5).every(t=>t.canCheck===false));assert.ok(new Date(state.availability.retryAt)>new Date());assert.equal(new Date(state.availability.retryAt).getUTCHours(),0);
 const result=await verifyTasks(db,account.user,{taskId:'all'},()=>{throw Error('No paid reads while paused');});assert.equal(result.awarded,0);
 assert.deepEqual(await db.q('SELECT * FROM x_task_awards WHERE user_id=$1 ORDER BY task_id',[account.user.id]),before);
 assert.equal((await db.q('SELECT count(*)::int n FROM x_task_checks WHERE user_id=$1',[account.user.id]))[0].n,0);
 assert.equal((await db.q('SELECT reserved_cents FROM x_task_api_budget WHERE day=(clock_timestamp() AT TIME ZONE \'UTC\')::date'))[0].reserved_cents,98);
 process.env.X_TASK_DAILY_BUDGET_CENTS='10000';
});

test('remaining allowance may confirm a follow while more expensive post checks stay disabled',async()=>{
 process.env.X_TASK_DAILY_BUDGET_CENTS='100';const account=await make('7018');await saveTaskAccess(db,account.user,grant());
 const state=await taskState(db,account.user);assert.equal(state.availability.state,'limited');assert.equal(state.tasks[0].canCheck,true);assert.ok(state.tasks.slice(1).every(t=>!t.canCheck));let reads=0;
 const provider=mock(account.user);
 const result=await verifyTasks(db,account.user,{taskId:'all'},(url,options)=>{reads++;return provider(url,options);});
 assert.equal(reads,1);assert.equal(result.awarded,1000);assert.equal(result.availability.state,'paused');
 assert.equal((await db.q('SELECT reserved_cents FROM x_task_api_budget WHERE day=(clock_timestamp() AT TIME ZONE \'UTC\')::date'))[0].reserved_cents,99);
 process.env.X_TASK_DAILY_BUDGET_CENTS='10000';
});
