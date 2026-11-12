import {withDB} from '../server/db.js';
import {body,fail,handleError,json,limit,sameOrigin,session} from '../server/http.js';
import {listNews,newsAdminState,newsAdminWrite} from '../server/news.js';
import {requireAdmin} from '../server/admin.js';
import {waitUntil} from '@vercel/functions';
import {runNewsJobs,dispatchNewsQueue} from '../server/news-jobs.js';
export function createNewsHandler(useDB=withDB,fetcher=fetch,background=waitUntil){return async(req,res)=>{
 try{
  const u=new URL(req.url,'https://vyx.local'),admin=u.searchParams.get('admin')==='1';
  if(!['GET','POST'].includes(req.method))fail(405,'Method not allowed.');
  await useDB(async db=>{
   if(req.method==='POST'){
    sameOrigin(req);const user=await session(db,req);requireAdmin(user);await limit(db,'news-admin:'+user.id,30);const input=await body(req);
    if(input.action==='run'){
     await db.q("INSERT INTO news_audit(actor_id,action) VALUES($1,'run')",[user.id]);
     const result=await runNewsJobs(db,fetcher);
     if((await db.q('SELECT collection_mode FROM news_settings WHERE id=1'))[0].collection_mode==='batch')background(useDB(d=>dispatchNewsQueue(d,fetcher)).catch(()=>console.error('VYX news worker dispatch failed')));
     return json(res,200,result);
    }
    const result=await newsAdminWrite(db,user,input);
    return json(res,200,result);
   }
   if(admin)return json(res,200,await newsAdminState(db,await session(db,req)));
   return json(res,200,await listNews(db,{category:u.searchParams.get('category')||'all',before:u.searchParams.get('before'),id:u.searchParams.get('id')}));
  });
 }catch(error){handleError(res,error);}
};}
export default createNewsHandler();
