import {withDB} from '../server/db.js';
import {body,fail,handleError,json,limit,sameOrigin,session,ipKey} from '../server/http.js';
import {listNewsComments,writeNewsComment} from '../server/news-comments.js';
import {listNews,newsAdminState,newsAdminWrite} from '../server/news.js';
import {requireAdmin} from '../server/admin.js';
import {waitUntil} from '../server/background.js';
import {runNewsJobs,dispatchNewsQueue} from '../server/news-jobs.js';
export function createNewsHandler(useDB=withDB,fetcher=fetch,background=waitUntil){return async(req,res)=>{
 try{
  const u=new URL(req.url,'https://vyx.local'),admin=u.searchParams.get('admin')==='1';
  if(!['GET','POST'].includes(req.method))fail(405,'Method not allowed.');
  await useDB(async db=>{
   if(req.method==='POST'){
    sameOrigin(req);const user=await session(db,req),input=await body(req);
    if(['comment-add','comment-edit','comment-delete'].includes(input.action)){
     if(!user)fail(401,'Sign in with X to comment.');
     await limit(db,'news-comments:'+user.id,30);await limit(db,'news-comments-ip:'+ipKey(req),90);
     return json(res,200,await writeNewsComment(db,user,input));
    }
    requireAdmin(user);await limit(db,'news-admin:'+user.id,30);
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
   const viewer=await session(db,req);
   if(u.searchParams.get('action')==='comments')return json(res,200,await listNewsComments(db,viewer,{id:u.searchParams.get('id'),before:u.searchParams.get('before')}));
   return json(res,200,await listNews(db,{category:u.searchParams.get('category')||'all',before:u.searchParams.get('before'),id:u.searchParams.get('id'),viewer}));
  });
 }catch(error){handleError(res,error);}
};}
export default createNewsHandler();
