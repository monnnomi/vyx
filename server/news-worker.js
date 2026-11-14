import {waitUntil} from './background.js';
import {withDB} from './db.js';
import {fail,handleError,json} from './http.js';
import {requireNewsCron} from './news-pipeline.js';
import {runNewsJobs,dispatchNewsQueue} from './news-jobs.js';
export function createNewsWorkerHandler(useDB=withDB,fetcher=fetch,background=waitUntil){return async(req,res)=>{
 try{
  if(req.method!=='POST')fail(405,'Method not allowed.');requireNewsCron(req);
  background(useDB(async db=>{
   const result=await runNewsJobs(db,fetcher);
   if(result.status!=='already-running')await dispatchNewsQueue(db,fetcher);
  }).catch(()=>console.error('VYX news background task failed')));
  json(res,202,{accepted:true});
 }catch(error){handleError(res,error);}
};}
export default createNewsWorkerHandler();
