import {withDB} from '../../../server/db.js';
import {cookie,redirect,setCookie,fail} from '../../../server/http.js';
import {consumeAttempt,xIdentity,login} from '../../../server/oauth.js';
export default async function handler(req,res){
 let returnTo='/';
 try{
  if(req.method!=='GET')fail(405,'Method not allowed.');
  const params=new URL(req.url,'https://vyx.local').searchParams;
  const binding=cookie(req,'vyx_oauth');
  await withDB(async db=>{
   const attempt=await consumeAttempt(db,params.get('state'),binding);
   returnTo=attempt.return_to==='/admin'?'/admin':'/';
   if(params.get('error'))fail(400,'Sign-in was cancelled.');
   const code=params.get('code');if(!code||code.length>2000)fail(400,'Missing sign-in code.');
   const identity=await xIdentity(code,attempt.verifier);
   const result=await db.tx(tx=>login(tx,identity));
   setCookie(res,'vyx_session',result.sessionToken,30*86400);redirect(res,returnTo==='/admin'?'/admin?auth=success':'/?auth=success#feed');
  });
 }catch(e){
  // Never log provider response bodies, authorization codes, tokens or secrets.
  console.error('X sign-in failed',e.status||500);setCookie(res,'vyx_oauth','',0);redirect(res,returnTo==='/admin'?'/admin?auth=failed':'/?auth=failed#feed');
 }
}
