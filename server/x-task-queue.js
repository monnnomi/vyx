import {xTasks,taskBudgetCap,verifyTasks} from './x-tasks.js';
import {taskScopes,taskAutomationStart} from './x-task-access.js';

// Start with the next UTC allowance reset; no extra reads on the exhausted launch day.
const definitions=JSON.stringify(xTasks.map(({id,kind})=>({id,kind})));
async function candidate(db,includeRunning=false){
 const [row]=await db.q(`SELECT u.id,u.x_id,u.is_system FROM x_task_access a
 JOIN users u ON u.id=a.user_id LEFT JOIN x_task_runs r ON r.user_id=u.id
 WHERE clock_timestamp()>=$1::timestamptz AND a.expires_at>clock_timestamp()
 AND a.x_id=u.x_id AND NOT u.is_system AND string_to_array(a.scopes,' ') @> $2::text[]
 AND (COALESCE(r.locked_until,'epoch')<clock_timestamp() AND COALESCE(r.checked_at,'epoch')<=clock_timestamp()-interval '15 minutes'
   OR $5::boolean AND r.locked_until>=clock_timestamp())
 AND NOT EXISTS(SELECT 1 FROM rate_limits WHERE bucket='x-task-checks:'||u.id::text
   AND window_start=floor(extract(epoch FROM clock_timestamp())/86400)*86400 AND count>=20)
 AND EXISTS(SELECT 1 FROM jsonb_to_recordset($3::text::jsonb) AS t(id text,kind text)
   WHERE NOT EXISTS(SELECT 1 FROM x_task_awards w WHERE w.x_id=u.x_id AND w.task_id=t.id)
   AND $4::integer-COALESCE((SELECT reserved_cents FROM x_task_api_budget WHERE day=(clock_timestamp() AT TIME ZONE 'UTC')::date),0)>=CASE WHEN t.kind='follow' THEN 1 ELSE 5 END)
 ORDER BY COALESCE(r.checked_at,'epoch'),a.connected_at,u.id LIMIT 1`,[taskAutomationStart(),taskScopes,definitions,taskBudgetCap(),includeRunning]);
 return row||null;
}
export async function taskQueueHasWork(db,{includeRunning=false}={}){return Boolean(await candidate(db,includeRunning));}
export async function runAutomaticTaskChecks(db,fetcher=fetch){
 const user=await candidate(db);
 if(!user)return {status:await taskQueueHasWork(db,{includeRunning:true})?'already-running':'idle',checked:0,awarded:0};
 try{
  const deadline=Date.now()+42000;
  const result=await verifyTasks(db,user,{taskId:'all'},(url,options)=>{
   if(Date.now()>deadline)throw Object.assign(Error('Automatic verification will continue on the next pass.'),{status:503});
   return fetcher(url,options);
  });
  return {status:'checked',checked:1,awarded:result.awarded};
 }catch(error){
  // Back off invalid grants and provider failures without manufacturing task proofs.
  await db.q(`INSERT INTO x_task_runs(user_id,locked_until,checked_at) VALUES($1,clock_timestamp(),clock_timestamp())
   ON CONFLICT(user_id) DO UPDATE SET checked_at=clock_timestamp() WHERE x_task_runs.locked_until<clock_timestamp()`,[user.id]);
  return {status:error.status===429?'waiting':'unavailable',checked:1,awarded:0};
 }
}
