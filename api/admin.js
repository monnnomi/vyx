import {moderationQueue,moderate} from '../server/social.js';
import {withDB} from '../server/db.js';
import {session,fail,handleError,json,body,sameOrigin,limit} from '../server/http.js';
import {adminOverview,requireAdmin} from '../server/admin.js';
import {settleDueWindows,farmingAdmin} from '../server/farming.js';
export function createAdminHandler(useDB=withDB){return async function handler(req,res){
 try{
  if(!['GET','POST'].includes(req.method))fail(405,'Method not allowed.');
  const url=new URL(req.url,'https://vyx.local');
  await useDB(async db=>{const user=await session(db,req);requireAdmin(user);if(req.method==='POST'){sameOrigin(req);await limit(db,'admin:'+user.id,30);return json(res,200,await moderate(db,user,await body(req)));}if(url.searchParams.get('action')==='moderation')return json(res,200,await moderationQueue(db,user));if(url.searchParams.get('action')==='farming'){await settleDueWindows(db);return json(res,200,await farmingAdmin(db));}json(res,200,await adminOverview(db,user,{query:url.searchParams.get('q'),filter:url.searchParams.get('filter'),page:url.searchParams.get('page')}));});
 }catch(e){handleError(res,e);}
};}
export default createAdminHandler();
