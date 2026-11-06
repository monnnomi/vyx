import {timingSafeEqual,createHash} from 'node:crypto';
import {withDB} from '../server/db.js';
import {fail,handleError,json} from '../server/http.js';
import {cleanupMedia,mediaAvailable} from '../server/media.js';
import {blobStorage} from '../server/media-storage.js';
import {settleDueWindows} from '../server/farming.js';
const digest=s=>createHash('sha256').update(s).digest();
export function createFarmCronHandler(useDB=withDB){return async function handler(req,res){
 try{
  if(req.method!=='GET')fail(405,'Method not allowed.');
  const expected=process.env.CRON_SECRET,actual=String(req.headers.authorization||'');
  if(!expected||!timingSafeEqual(digest(actual),digest('Bearer '+expected)))fail(401,'Unauthorized.');
  await useDB(async db=>{
   await db.q('UPDATE farm_scheduler_state SET last_started_at=clock_timestamp() WHERE id=1');
   const result=await settleDueWindows(db,12);
   if(mediaAvailable())await cleanupMedia(db,blobStorage);
   await db.q('UPDATE farm_scheduler_state SET last_completed_at=clock_timestamp(),last_settled=$1 WHERE id=1',[result.settled]);
   json(res,200,result);
  });
 }catch(e){handleError(res,e);}
};}
export default createFarmCronHandler();
