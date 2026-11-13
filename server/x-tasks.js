import {fail} from './http.js';
import {calendar} from './config.js';
import {getTaskAccess} from './x-task-access.js';
export const campaignPost='2119014238463152187';
export const campaignPosts=Object.freeze([campaignPost,'2121127790556680479']);
export const xTasks=Object.freeze([
 {id:'x-vyx-follow-v1',kind:'follow',title:'Follow VYX on X',amount:1000,url:'https://x.com/vyxsocial'},
 {id:'x-vyx-like-2119014238463152187',kind:'like',postId:campaignPost,title:'Like the VYX post',amount:1500,url:'https://x.com/vyxsocial/status/'+campaignPost},
 {id:'x-vyx-repost-2119014238463152187',kind:'repost',postId:campaignPost,title:'Repost the VYX post',amount:2000,url:'https://x.com/vyxsocial/status/'+campaignPost},
 {id:'x-vyx-reply-2119014238463152187',kind:'reply',postId:campaignPost,title:'Comment on the VYX post',amount:1500,url:'https://x.com/vyxsocial/status/'+campaignPost},
 {id:'x-vyx-quote-2119014238463152187',kind:'quote',postId:campaignPost,title:'Quote the VYX post',amount:2500,url:'https://x.com/intent/tweet?url='+encodeURIComponent('https://x.com/vyxsocial/status/'+campaignPost)},
 {id:'x-vyx-like-2121127790556680479',kind:'like',postId:campaignPosts[1],title:'Like the VYX product update',amount:1500,url:'https://x.com/vyxsocial/status/'+campaignPosts[1]},
 {id:'x-vyx-repost-2121127790556680479',kind:'repost',postId:campaignPosts[1],title:'Repost the VYX product update',amount:2000,url:'https://x.com/vyxsocial/status/'+campaignPosts[1]},
 {id:'x-vyx-reply-2121127790556680479',kind:'reply',postId:campaignPosts[1],title:'Reply to the VYX product update',amount:1500,url:'https://x.com/vyxsocial/status/'+campaignPosts[1]}
]);
export const xTaskTotal=xTasks.reduce((sum,t)=>sum+t.amount,0);
export async function reserveXCheckRead(db,url){
 // Conservative upper bounds at current X read rates: one user or up to ten posts.
 const configured=Number(process.env.X_TASK_DAILY_BUDGET_CENTS||100);
 const cap=Number.isInteger(configured)&&configured>=1&&configured<=100000?configured:100;
 const cents=url.includes('/users/by/username/')?1:url.includes('/following?')?10:5;
 const [row]=await db.q("INSERT INTO x_task_api_budget(day,reserved_cents) SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date,$1::integer WHERE $1::integer<=$2::integer ON CONFLICT(day) DO UPDATE SET reserved_cents=x_task_api_budget.reserved_cents+EXCLUDED.reserved_cents WHERE x_task_api_budget.reserved_cents+EXCLUDED.reserved_cents<=$2::integer RETURNING day",[cents,cap]);
 if(!row)fail(503,'The daily X verification allowance has been reached. Your completed rewards remain safe; please check again later.');
}
export async function taskState(db,user){
 if(user)await db.q('DELETE FROM x_task_access WHERE user_id=$1 AND expires_at<=clock_timestamp()',[user.id]);
 const awards=user?await db.q('SELECT task_id,amount,created_at FROM x_task_awards WHERE x_id=$1',[user.x_id]):[];
 const checks=user?await db.q('SELECT task_id,status,detail,checked_at FROM x_task_checks WHERE user_id=$1',[user.id]):[];
 const [access]=user?await db.q('SELECT expires_at FROM x_task_access WHERE user_id=$1 AND x_id=$2 AND expires_at>clock_timestamp()',[user.id,user.x_id]):[];
 return {connected:Boolean(access),expiresAt:access?.expires_at||null,total:xTaskTotal,earned:awards.reduce((n,a)=>n+a.amount,0),tasks:xTasks.map(t=>{const a=awards.find(a=>a.task_id===t.id),c=checks.find(c=>c.task_id===t.id);return {...t,status:a?'awarded':c?.status||'not-verified',detail:a?'Verified by X. VP added to your account.':c?.detail||'Complete the action on X, then return here.',awardedAt:a?.created_at||null,checkedAt:c?.checked_at||null};})};
}
export async function awardTask(db,user,task,proof,now=new Date()){
 return db.tx(async tx=>{
  await tx.q('SELECT id FROM users WHERE id=$1 FOR UPDATE',[user.id]);
  const [old]=await tx.q('SELECT id FROM x_task_awards WHERE x_id=$1 AND task_id=$2',[user.x_id,task.id]);if(old)return 0;
  const [pool]=await tx.q("UPDATE farm_pools SET spent=spent+$1 WHERE id='promotions' AND spent+$1<=budget RETURNING id",[task.amount]);
  if(!pool)fail(409,'The promotion reward fund is currently exhausted.');
  await tx.q('INSERT INTO x_task_awards(user_id,x_id,task_id,season,amount,proof_id) VALUES($1,$2,$3,$4,$5,$6)',[user.id,user.x_id,task.id,calendar(now).season,task.amount,proof]);
  return task.amount;
 });
}
async function xGet(path,token,fetcher){
 let response;try{response=await fetcher('https://api.x.com/2/'+path,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(5000),redirect:'error'});}catch(err){if(err.status)throw err;fail(503,'X could not be reached. Please try again later.');}
 if(response.status===401)fail(409,'Reconnect X to continue task verification.');
 if(response.status===402||response.status===403)fail(503,'X API access or credits are unavailable. The VYX team needs to check the developer account.');
 if(response.status===429)fail(429,'X is temporarily limiting checks. Please wait before trying again.');
 if(!response.ok)throw Object.assign(new Error('X could not confirm this action right now. Please try again later.'),{status:503,xStatus:response.status});
 let data;try{data=await response.json();}catch{fail(503,'X returned an incomplete verification response.');}
 if(data.errors?.length)fail(503,'X returned an incomplete verification response.');return data;
}
// Limited pages keep checks bounded. Absence is never treated as proof of completion.
async function scanMany(path,token,predicates,fetcher,pages=3){
 let next=null;const items=[];
 for(let i=0;i<pages;i++){
  const r=await xGet(path+(next?'&pagination_token='+encodeURIComponent(next):''),token,fetcher);
  if(r.data!=null&&!Array.isArray(r.data))fail(503,'X returned an incomplete verification response.');
  items.push(...(r.data||[]));
  if(predicates.every(predicate=>items.some(predicate)))return {items,limited:false};
  next=r.meta?.next_token;if(!next)return {items,limited:false};
 }
 return {items,limited:true};
}
async function scan(path,token,predicate,fetcher,pages=3){
 const result=await scanMany(path,token,[predicate],fetcher,pages);
 return {proof:result.items.find(predicate)?.id||null,limited:result.limited};
}
export async function verifyTasks(db,user,input={},fetcher=fetch){
 if(!user?.x_id||user.is_system)fail(401,'Sign in with X to verify tasks.');
 const requested=input.taskId==='all'?xTasks:xTasks.filter(t=>t.id===input.taskId);if(!requested.length)fail(400,'Choose a valid task.');
 const state=await taskState(db,user),pending=requested.filter(t=>!state.tasks.find(a=>a.id===t.id&&a.status==='awarded'));
 if(!pending.length)return {...state,awarded:0};
 const access=await getTaskAccess(db,user);
 const providerFetcher=fetcher;fetcher=async(url,options)=>{await reserveXCheckRead(db,url);return providerFetcher(url,options);};
 const [run]=await db.q("INSERT INTO x_task_runs(user_id,locked_until,checked_at) VALUES($1,clock_timestamp()+interval '55 seconds',clock_timestamp()) ON CONFLICT(user_id) DO UPDATE SET locked_until=EXCLUDED.locked_until,checked_at=EXCLUDED.checked_at WHERE x_task_runs.locked_until<clock_timestamp() AND x_task_runs.checked_at<clock_timestamp()-interval '60 seconds' RETURNING user_id",[user.id]);
 if(!run)fail(429,'Please wait one minute between verification requests.');
 let awarded=0,timeline=null,likes=null,halt=null;
 const referenceTypes={repost:'retweeted',reply:'replied_to',quote:'quoted'};
 const matches=(post,task)=>post.author_id===user.x_id&&post.referenced_tweets?.some(r=>r.id===task.postId&&r.type===referenceTypes[task.kind]);
 const timelineTasks=pending.filter(t=>referenceTypes[t.kind]);
 const sinceId=timelineTasks.map(t=>t.postId).reduce((a,b)=>!a||BigInt(b)<BigInt(a)?b:a,null);
 try{
  for(const task of pending){
   let proof=null,detail='Action not confirmed yet. X may take a moment to update; you can check again.',status='not-verified';
   try{
    if(halt)throw halt;
    if(task.kind==='follow'){
     let r;try{r=await xGet('users/by/username/vyxsocial?user.fields=connection_status',access.token,fetcher);}catch(err){if(err.xStatus!==400)throw err;r=await xGet('users/by/username/vyxsocial',access.token,fetcher);}
     if(!/^\d+$/.test(r.data?.id||''))fail(503,'X did not return the VYX account. Please try again later.');
     if(Array.isArray(r.data.connection_status)){if(r.data.connection_status.includes('following'))proof=r.data.id;}
     else {const match=await scan('users/'+user.x_id+'/following?max_results=10',access.token,p=>p.id===r.data.id,fetcher,2);proof=match.proof;if(match.limited)detail='Not found in the recent follows checked. Keep following VYX and try again later.';}
    }else if(task.kind==='like'){
     // Share one bounded scan across all pending like tasks, including failures.
     likes||=scanMany('users/'+user.x_id+'/liked_tweets?max_results=10',access.token,pending.filter(t=>t.kind==='like').map(t=>p=>p.id===t.postId),fetcher);
     const r=await likes;proof=r.items.find(p=>p.id===task.postId)?.id||null;
     if(!proof&&r.limited)detail='Not found in the recent likes checked. Keep the like in place and try again later.';
    }else{
     // Each proof must match both the exact campaign post and reference type.
     timeline||=scanMany('users/'+user.x_id+'/tweets?max_results=10&since_id='+sinceId+'&tweet.fields=author_id,referenced_tweets',access.token,timelineTasks.map(t=>p=>matches(p,t)),fetcher);
     const result=await timeline;proof=result.items.find(p=>matches(p,task))?.id||null;
    }
    if(proof){awarded+=await awardTask(db,user,task,proof);status='verified';detail='Verified by X. VP added to your account.';}
   }catch(err){status='unavailable';detail=err.status?err.message:'Verification is temporarily unavailable.';if([409,429].includes(err.status)||/credits|daily X verification/.test(detail))halt=err;}
   await db.q('INSERT INTO x_task_checks(user_id,task_id,status,detail) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,task_id) DO UPDATE SET status=EXCLUDED.status,detail=EXCLUDED.detail,checked_at=clock_timestamp()',[user.id,task.id,status,detail]);
  }
 }finally{await db.q('UPDATE x_task_runs SET locked_until=clock_timestamp() WHERE user_id=$1',[user.id]);}
 return {...await taskState(db,user),awarded};
}
