import {withDB} from '../server/db.js';
import {session,fail,handleError,json} from '../server/http.js';
import {settleDueWindows,farmingOverview,roomFarming} from '../server/farming.js';
export function createFarmHandler(useDB=withDB){return async function handler(req,res){
 try{
  if(req.method!=='GET')fail(405,'Method not allowed.');
  const url=new URL(req.url,'https://vyx.local');
  await useDB(async db=>{
   const user=await session(db,req),id=url.searchParams.get('room');
   if(id&&!user)fail(401,'Sign in with X to view room farming.');
   await settleDueWindows(db);
   json(res,200,id?await roomFarming(db,user,id):await farmingOverview(db,user));
  });
 }catch(e){handleError(res,e);}
};}
export default createFarmHandler();
