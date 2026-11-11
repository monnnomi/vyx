import {withDB} from '../server/db.js';
import {session,sameOrigin,body,fail,handleError,json,cookie,setCookie,token,hash,limit,ipKey} from '../server/http.js';
export async function touchPresence(db,user,visitorToken,page){
 const allowed=['news','feed','tasks','rewards','leaderboard','messages','rooms','profile','whitelist','admin'];
 const route=allowed.includes(page)?page:'feed';
 await db.q(`INSERT INTO presence_sessions(token_hash,user_id,page,last_seen_at) VALUES($1,$2,$3,clock_timestamp())
 ON CONFLICT(token_hash) DO UPDATE SET user_id=EXCLUDED.user_id,page=EXCLUDED.page,last_seen_at=EXCLUDED.last_seen_at`,[hash(visitorToken),user?.id||null,route]);
 if(user)await db.q('UPDATE users SET last_seen_at=clock_timestamp() WHERE id=$1',[user.id]);
}
export function createPresenceHandler(useDB=withDB){return async function handler(req,res){
 try{
  if(req.method!=='POST')fail(405,'Method not allowed.');sameOrigin(req);
  const input=await body(req);
  await useDB(async db=>{
   await limit(db,'presence:'+ipKey(req),60);
   const user=await session(db,req);
   let visitor=cookie(req,'vyx_presence');
   if(!/^[\w-]{43}$/.test(visitor||'')){visitor=token();setCookie(res,'vyx_presence',visitor,86400);}
   await touchPresence(db,user,visitor,input.page);json(res,200,{ok:true});
  });
 }catch(e){handleError(res,e);}
};}
export default createPresenceHandler();
