import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {login} from '../server/oauth.js';
import {saveTaskAccess,taskScopes,openTaskToken} from '../server/x-task-access.js';
import {xTasks,campaignPosts,awardTask,verifyTasks,taskState} from '../server/x-tasks.js';
import {runAutomaticTaskChecks,taskQueueHasWork} from '../server/x-task-queue.js';
import {runNewsJobs,dispatchNewsQueue} from '../server/news-jobs.js';
import {reserveNewsCost} from '../server/news-budget.js';

const pg=new PGlite();await pg.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
const wrap=p=>({q:async(s,a=[])=>(await p.query(s,a)).rows,tx:fn=>p.transaction(t=>fn(wrap(t)))}),db=wrap(pg);
process.env.VYX_APP_SECRET='isolated-queue-secret';process.env.X_TASK_DAILY_BUDGET_CENTS='100';process.env.X_TASK_AUTOMATION_START_AT='2000-01-01T00:00:00Z';process.env.CRON_SECRET='fixture-cron';process.env.PUBLIC_APP_URL='https://joinvyx.com';
after(()=>pg.close());let accountNumber=88000;
async function account(){const a=await db.tx(tx=>login(tx,{id:String(++accountNumber),username:'queue_'+accountNumber,name:'Queue QA',avatar:''}));await saveTaskAccess(db,a.user,{access_token:'fixture-task-token',scope:taskScopes.join(' '),expires_in:7200});return a.user;}
async function reset(){await db.q('DELETE FROM x_task_access');await db.q('DELETE FROM x_task_runs');await db.q('DELETE FROM x_task_api_budget');await db.q('DELETE FROM news_budget');await db.q('UPDATE news_settings SET enabled=false');process.env.X_TASK_AUTOMATION_START_AT='2000-01-01T00:00:00Z';}
function provider(user,{complete=true,status=200}={}){const calls=[];return {calls,fetcher:async(url,options)=>{calls.push(url);assert.equal(options.headers.Authorization,'Bearer fixture-task-token');assert.ok(!options.method||options.method==='GET');let data=[];
 if(url.includes('by/username'))data={id:'1234',connection_status:complete?['following']:[]};
 else if(url.includes('liked_tweets'))data=complete?campaignPosts.map(id=>({id})):[];
 else if(url.includes('/tweets?'))data=complete?campaignPosts.flatMap(id=>['retweeted','replied_to','quoted'].map((type,i)=>({id:String(BigInt(id)+BigInt(i+1)),author_id:user.x_id,referenced_tweets:[{id,type}]}))):[];
 else throw Error('Unexpected provider endpoint');
 return new Response(JSON.stringify({data}),{status});}};}

test('automatic checks wait for the launch reset and only use current, explicitly granted X access',async()=>{
 await reset();const user=await account();process.env.X_TASK_AUTOMATION_START_AT='3000-01-01T00:00:00Z';
 assert.equal(await taskQueueHasWork(db),false);assert.equal((await runAutomaticTaskChecks(db,()=>{throw Error('No paid read before launch');})).status,'idle');
 assert.equal((await db.q('SELECT * FROM x_task_api_budget')).length,0);process.env.X_TASK_AUTOMATION_START_AT='2000-01-01T00:00:00Z';assert.equal(await taskQueueHasWork(db),true);
 await db.q("UPDATE x_task_access SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",[user.id]);assert.equal(await taskQueueHasWork(db),false);
 const other=await account();await db.q("UPDATE x_task_access SET scopes='tweet.read users.read' WHERE user_id=$1",[other.id]);assert.equal(await taskQueueHasWork(db),false);
});
test('background verification awards only official proofs, credits all pending actions once and uses no news funds',async()=>{
 await reset();const user=await account(),p=provider(user),before=Number((await db.q("SELECT spent FROM farm_pools WHERE id='promotions'"))[0].spent);
 const result=await runAutomaticTaskChecks(db,p.fetcher);assert.equal(result.awarded,13500);assert.equal(result.checked,1);assert.equal(p.calls.length,3);
 assert.equal(Number((await db.q("SELECT spent FROM farm_pools WHERE id='promotions'"))[0].spent)-before,13500);assert.equal((await taskState(db,user)).earned,13500);
 assert.equal((await db.q('SELECT reserved_cents FROM x_task_api_budget'))[0].reserved_cents,11);assert.equal((await db.q('SELECT * FROM news_budget')).length,0);
 assert.equal((await runAutomaticTaskChecks(db,()=>{throw Error('Never recheck completed tasks');})).status,'idle');
});
test('unconfirmed actions back off for fifteen minutes; disconnecting cancels background verification',async()=>{
 await reset();const user=await account(),p=provider(user,{complete:false});assert.equal((await runAutomaticTaskChecks(db,p.fetcher)).awarded,0);assert.equal(p.calls.length,3);
 assert.equal(await taskQueueHasWork(db),false);await runAutomaticTaskChecks(db,p.fetcher);assert.equal(p.calls.length,3);
 await db.q("UPDATE x_task_runs SET checked_at=clock_timestamp()-interval '16 minutes' WHERE user_id=$1",[user.id]);assert.equal(await taskQueueHasWork(db),true);
 await db.q('DELETE FROM x_task_access WHERE user_id=$1',[user.id]);assert.equal(await taskQueueHasWork(db),false);
});
test('quest checks run before news and delay new news reservations only while a fundable check is due',async()=>{
 await reset();const user=await account(),p=provider(user);await db.q('UPDATE news_settings SET enabled=true');
 await assert.rejects(reserveNewsCost(db,'ai',1),/waiting for automatic quest/);assert.equal((await db.q('SELECT * FROM news_budget')).length,0);
 const result=await runNewsJobs(db,p.fetcher);assert.equal(result.status,'quest-priority');assert.equal(result.tasks.awarded,13500);assert.equal(result.processed,0);assert.equal(p.calls.length,3);
 await reserveNewsCost(db,'ai',1);assert.equal((await db.q('SELECT reserved_cents FROM news_budget'))[0].reserved_cents,1);
});
test('the exhausted quest allowance is retained and never borrows the independent news budget',async()=>{
 await reset();const user=await account();await awardTask(db,user,xTasks[0],'prior-follow-proof');await db.q("INSERT INTO x_task_api_budget(day,reserved_cents) VALUES((clock_timestamp() AT TIME ZONE 'UTC')::date,98)");
 assert.equal(await taskQueueHasWork(db),false);assert.equal((await runAutomaticTaskChecks(db,()=>{throw Error('Cap prevents X reads');})).status,'idle');
 assert.equal((await db.q('SELECT reserved_cents FROM x_task_api_budget'))[0].reserved_cents,98);await db.q('UPDATE news_settings SET enabled=true');await reserveNewsCost(db,'ai',1);
 assert.equal((await db.q('SELECT reserved_cents FROM x_task_api_budget'))[0].reserved_cents,98);assert.equal((await db.q('SELECT reserved_cents FROM news_budget'))[0].reserved_cents,1);
});
test('an in-flight verification holds priority without duplicate X calls or a worker dispatch loop',async()=>{
 await reset();const user=await account(),p=provider(user);await db.q('UPDATE news_settings SET enabled=true');let release,started;const began=new Promise(r=>started=r),gate=new Promise(r=>release=r);
 const first=runAutomaticTaskChecks(db,async(...args)=>{started();await gate;return p.fetcher(...args);});await began;
 assert.equal(await taskQueueHasWork(db),false);assert.equal(await taskQueueHasWork(db,{includeRunning:true}),true);
 assert.equal((await runAutomaticTaskChecks(db,p.fetcher)).status,'already-running');await assert.rejects(reserveNewsCost(db,'ai',1),/waiting for automatic quest/);
 await dispatchNewsQueue(db,()=>{throw Error('Do not spin while another worker owns the check');});release();assert.equal((await first).awarded,13500);assert.equal(p.calls.length,3);
});
test('manual and automatic checks share the existing per-account daily cap',async()=>{
 await reset();const user=await account();await db.q("INSERT INTO rate_limits(bucket,window_start,count) VALUES($1,floor(extract(epoch FROM clock_timestamp())/86400)*86400,20)",['x-task-checks:'+user.id]);
 assert.equal(await taskQueueHasWork(db),false);await assert.rejects(verifyTasks(db,user,{taskId:'all'},()=>{throw Error('No call after the daily cap');}),e=>e.status===429);
 assert.equal((await db.q('SELECT * FROM x_task_api_budget')).length,0);
});
test('expired provider credentials cannot mint rewards or spin an immediate background retry',async()=>{
 await reset();const user=await account(),p=provider(user,{status:401});assert.equal((await runAutomaticTaskChecks(db,p.fetcher)).awarded,0);assert.equal(p.calls.length,1);assert.equal(await taskQueueHasWork(db),false);
 assert.equal((await db.q('SELECT * FROM x_task_awards WHERE user_id=$1',[user.id])).length,0);
});

const renewableScopes = [...taskScopes, 'offline.access'].join(' ');
async function expiredRenewable(user) {
 await saveTaskAccess(db,user,{scope:renewableScopes,access_token:'old-access',refresh_token:'first-refresh',expires_in:7200});
 await db.q("UPDATE x_task_access SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",[user.id]);
}

test('expired renewable grant survives a status read, rotates once and awards from a scheduled check',async()=>{
 await reset();
 const user=await account();
 await expiredRenewable(user);
 const state=await taskState(db,user);
 assert.equal(state.renewable,true);
 assert.equal(state.connected,true);
 assert.equal(await taskQueueHasWork(db),true);
 const reads=provider(user);
 let refreshes=0;
 const result=await runAutomaticTaskChecks(db,async(url,options)=>{
  if(url!=='https://api.x.com/2/oauth2/token')return reads.fetcher(url,options);
  refreshes++;
  assert.equal(options.body.get('refresh_token'),'first-refresh');
  assert.equal(options.body.get('grant_type'),'refresh_token');
  return Response.json({access_token:'fixture-task-token',refresh_token:'second-refresh',expires_in:7200});
 });
 assert.equal(result.awarded,13500);
 assert.equal(refreshes,1);
 const [row]=await db.q('SELECT * FROM x_task_access WHERE user_id=$1',[user.id]);
 assert.equal(openTaskToken(row.sealed_refresh_token,'refresh:'+user.x_id),'second-refresh');
 assert.equal((await db.q('SELECT reserved_cents FROM x_task_api_budget'))[0].reserved_cents,11);
});

test('transient refresh failures preserve consent and a revoked refresh grant requires reconnection',async()=>{
 await reset();
 const user=await account();
 await expiredRenewable(user);
 for(const [status,error,connected] of [[503,'temporarily_unavailable',true],[400,'invalid_grant',false]]) {
  await assert.rejects(verifyTasks(db,user,{taskId:'all'},()=>Promise.resolve(Response.json({error},{status}))),e=>e.status===(connected?503:409));
  assert.equal((await taskState(db,user)).connected,connected);
  await db.q('DELETE FROM x_task_runs WHERE user_id=$1',[user.id]);
 }
 assert.equal(await taskQueueHasWork(db),false);
 assert.equal((await db.q('SELECT * FROM x_task_api_budget')).length,0);
});

test('early access rejection renews once, meters the retry, and keeps an unrotated refresh token',async()=>{
 await reset();
 const user=await account();
 await saveTaskAccess(db,user,{scope:renewableScopes,access_token:'early-expiry',refresh_token:'still-valid',expires_in:7200});
 const calls=[];
 const result=await verifyTasks(db,user,{taskId:xTasks[1].id},async(url,options)=>{
  calls.push(url);
  if(url.endsWith('/oauth2/token'))return Response.json({access_token:'replaced',expires_in:7200});
  if(options.headers.Authorization==='Bearer early-expiry')return Response.json({},{status:401});
  assert.equal(options.headers.Authorization,'Bearer replaced');
  return Response.json({data:[{id:campaignPosts[0]}]});
 });
 assert.equal(calls.length,3);
 assert.equal(result.awarded,1500);
 assert.equal(result.renewable,true);
 assert.equal((await db.q('SELECT reserved_cents FROM x_task_api_budget'))[0].reserved_cents,10);
});
