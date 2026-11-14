import {waitUntil} from '../server/background.js';
import {withDB} from '../server/db.js';
import {fail,handleError,json} from '../server/http.js';
import {requireNewsCron} from '../server/news-pipeline.js';
import {runNewsJobs,dispatchNewsQueue} from '../server/news-jobs.js';
import {createNewsWorkerHandler} from '../server/news-worker.js';
export function createNewsCronHandler(useDB=withDB,fetcher=fetch,background=waitUntil){const worker=createNewsWorkerHandler(useDB,fetcher,background);return async(req,res)=>{try{if(req.method==='POST')return worker(req,res);if(req.method!=='GET')fail(405,'Method not allowed.');requireNewsCron(req);await useDB(async db=>{const result=await runNewsJobs(db,fetcher);if((await db.q('SELECT collection_mode FROM news_settings WHERE id=1'))[0].collection_mode==='batch')background(useDB(d=>dispatchNewsQueue(d,fetcher)).catch(()=>console.error('VYX news worker dispatch failed')));json(res,200,result);});}catch(error){handleError(res,error);}};}
export default createNewsCronHandler();
