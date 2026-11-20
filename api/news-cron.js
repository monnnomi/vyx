// Keep the existing scheduler URL for installations that use it for X quests.
import {timingSafeEqual} from 'node:crypto';
import {waitUntil} from '../server/background.js';
import {withDB} from '../server/db.js';
import {appURL,fail,handleError,hash,json} from '../server/http.js';
import {runAutomaticTaskChecks,taskQueueHasWork} from '../server/x-task-queue.js';

export function createNewsCronHandler(useDB=withDB,fetcher=fetch,background=waitUntil){
 async function run(db){
  const tasks=await runAutomaticTaskChecks(db,fetcher);
  if(tasks.status!=='already-running'&&await taskQueueHasWork(db)){
   const result=await fetcher(new URL('/api/news-cron',appURL()).href,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{Authorization:'Bearer '+process.env.CRON_SECRET}});
   if(!result.ok)throw Error('Quest worker dispatch failed.');
  }
  return tasks;
 }
 return async(req,res)=>{
  try{
   if(!['GET','POST'].includes(req.method))fail(405,'Method not allowed.');
   const expected=process.env.CRON_SECRET,actual=req.headers.authorization||'';
   if(!expected||!timingSafeEqual(Buffer.from(hash(actual)),Buffer.from(hash('Bearer '+expected))))fail(401,'Unauthorized.');
   if(req.method==='POST'){
    background(useDB(run).catch(()=>console.error('VYX automatic quest check failed')));
    return json(res,202,{accepted:true});
   }
   json(res,200,await useDB(run));
  }catch(error){handleError(res,error);}
 };
}
export default createNewsCronHandler();
