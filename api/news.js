import {withDB} from '../server/db.js';
import {body,fail,handleError,json,limit,sameOrigin,session} from '../server/http.js';
import {listNews,newsAdminState,newsAdminWrite} from '../server/news.js';
import {requireAdmin} from '../server/admin.js';
import {runNewsPipeline} from '../server/news-pipeline.js';
export function createNewsHandler(useDB=withDB,fetcher=fetch){return async(req,res)=>{
 try{
  const u=new URL(req.url,'https://vyx.local'),admin=u.searchParams.get('admin')==='1';
  if(!['GET','POST'].includes(req.method))fail(405,'Method not allowed.');
  await useDB(async db=>{
   if(req.method==='POST'){
    sameOrigin(req);const user=await session(db,req);requireAdmin(user);await limit(db,'news-admin:'+user.id,30);const input=await body(req);
    if(input.action==='run'){
     await db.q("INSERT INTO news_audit(actor_id,action) VALUES($1,'run')",[user.id]);
     return json(res,200,await runNewsPipeline(db,fetcher));
    }
    return json(res,200,await newsAdminWrite(db,user,input));
   }
   if(admin)return json(res,200,await newsAdminState(db,await session(db,req)));
   return json(res,200,await listNews(db,{language:u.searchParams.get('language')||'en',category:u.searchParams.get('category')||'all',before:u.searchParams.get('before'),id:u.searchParams.get('id')}));
  });
 }catch(error){handleError(res,error);}
};}
export default createNewsHandler();
