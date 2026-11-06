import {withDB} from '../server/db.js';
import {session,fail,handleError,json} from '../server/http.js';
import {adminOverview,requireAdmin} from '../server/admin.js';
import {settleDueWindows,farmingAdmin} from '../server/farming.js';
export function createAdminHandler(useDB=withDB){return async function handler(req,res){
 try{
  if(req.method!=='GET')fail(405,'Method not allowed.');
  const url=new URL(req.url,'https://vyx.local');
  await useDB(async db=>{const user=await session(db,req);requireAdmin(user);if(url.searchParams.get('action')==='farming'){await settleDueWindows(db);return json(res,200,await farmingAdmin(db));}json(res,200,await adminOverview(db,user,{query:url.searchParams.get('q'),filter:url.searchParams.get('filter'),page:url.searchParams.get('page')}));});
 }catch(e){handleError(res,e);}
};}
export default createAdminHandler();
