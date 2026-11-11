import {withDB} from '../server/db.js';
import {body,fail,handleError,json,limit,sameOrigin,session} from '../server/http.js';
import {listNews,newsAdminState,newsAdminWrite} from '../server/news.js';
export function createNewsHandler(useDB=withDB){return async(req,res)=>{
 try{
  const u=new URL(req.url,'https://vyx.local'),admin=u.searchParams.get('admin')==='1';
  if(!['GET','POST'].includes(req.method))fail(405,'Method not allowed.');
  await useDB(async db=>{
   if(req.method==='POST'){sameOrigin(req);const user=await session(db,req);await limit(db,'news-admin:'+String(user?.id||'guest'),30);return json(res,200,await newsAdminWrite(db,user,await body(req)));}
   if(admin)return json(res,200,await newsAdminState(db,await session(db,req)));
   return json(res,200,await listNews(db,{language:u.searchParams.get('language')||'en',category:u.searchParams.get('category')||'all',before:u.searchParams.get('before'),id:u.searchParams.get('id')}));
  });
 }catch(error){handleError(res,error);}
};}
export default createNewsHandler();
