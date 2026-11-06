import {withDB} from '../../server/db.js';
import {fail,handleError,ipKey,limit,redirect,setCookie,token} from '../../server/http.js';
import {startOAuth} from '../../server/oauth.js';
export default async function handler(req,res){
 try{
  if(req.method!=='GET')fail(405,'Method not allowed.');
  if(!process.env.X_CLIENT_ID||!process.env.X_CLIENT_SECRET||!process.env.VYX_APP_SECRET)return redirect(res,'/?auth=setup#feed');
  await withDB(async db=>{
   await limit(db,'oauth:'+ipKey(req),12,600);
   const binding=token(),returnTo=new URL(req.url,'https://vyx.local').searchParams.get('returnTo');
   const url=await startOAuth(db,binding,new Date(),returnTo,new URL(req.url,'https://vyx.local').searchParams.get('ref'));
   setCookie(res,'vyx_oauth',binding,600);redirect(res,url);
  });
 }catch(e){handleError(res,e);}
}
