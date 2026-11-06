import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {handleUpload} from '@vercel/blob/client';
import {withDB} from '../server/db.js';
import {body,sameOrigin,session,fail,handleError,json,appURL} from '../server/http.js';
import {prepareMedia,uploadGrant,finalizeMedia,readableMedia,mediaRange,mediaAvailable,uploadMediaPart,readMediaPart} from '../server/media.js';
import {blobStorage} from '../server/media-storage.js';
export function createMediaHandler(useDB=withDB,storage=blobStorage,uploadHandler=handleUpload){return async function handler(req,res){
 try{
  const action=new URL(req.url,'https://vyx.local').searchParams.get('action');
  if(!['GET','HEAD','POST'].includes(req.method))fail(405,'Method not allowed.');
  if(!mediaAvailable())fail(503,'Photo and video uploads are being connected. Please try again shortly.');
  if(action==='file'&&['GET','HEAD'].includes(req.method)){
   const a=await useDB(async db=>readableMedia(db,await session(db,req),new URL(req.url,'https://vyx.local').searchParams.get('id')));
   const range=mediaRange(req.headers.range,a.byte_size);
   const stream=req.method==='HEAD'?null:await storage.open(a,range);
   res.statusCode=range.status;res.setHeader('Content-Type',a.content_type);res.setHeader('Content-Length',String(range.end-range.start+1));
   res.setHeader('Cache-Control','private, no-store');res.setHeader('Accept-Ranges','bytes');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
   if(range.status===206)res.setHeader('Content-Range',`bytes ${range.start}-${range.end}/${a.byte_size}`);
   if(req.method==='HEAD')return res.end();
   return await pipeline(Readable.fromWeb(stream),res);
  }
  if(req.method!=='POST')fail(405,'Method not allowed.');
  if(action==='part'){
   sameOrigin(req);if(req.headers['content-type']!=='application/octet-stream')fail(415,'Send a binary file part.');
   const user=await useDB(db=>session(db,req));if(!user?.x_id)fail(401,'Sign in with X to upload.');
   const params=new URL(req.url,'https://vyx.local').searchParams,part=params.get('part');if(!/^[1-9]\d?$/.test(part||''))fail(400,'Invalid file part.');
   const bytes=await readMediaPart(req);const result=await useDB(db=>uploadMediaPart(db,user,params.get('id'),Number(part),bytes,storage));return json(res,200,result);
  }
  const input=await body(req);
  if(action==='upload'){
   // Upload-complete callbacks have no browser session; the SDK verifies their signature.
   if(input.type!=='blob.upload-completed')sameOrigin(req);
   const result=await uploadHandler({body:input,request:req,
    onBeforeGenerateToken:async(pathname,payload)=>{
     sameOrigin(req);let id;try{id=JSON.parse(payload).id;}catch{fail(400,'Invalid upload.');}
     return useDB(async db=>({...await uploadGrant(db,await session(db,req),id,pathname),callbackUrl:appURL()+'/api/media?action=upload'}));
    },
    onUploadCompleted:async({blob,tokenPayload})=>{
     let id;try{id=JSON.parse(tokenPayload).id;}catch{fail(400,'Invalid upload receipt.');}
     await useDB(async db=>{
      // Bind the verified callback to the server-allocated pathname, never a client URL.
      const [a]=await db.q('SELECT pathname,status FROM media_assets WHERE id=$1',[id]);if(!a||a.pathname!==blob.pathname)fail(403,'Invalid upload receipt.');
      if(['deleting','deleted'].includes(a.status)){await storage.del(a.pathname);return;}
      await finalizeMedia(db,storage,id);
     });
    }
   });return json(res,200,result);
  }
  sameOrigin(req);
  await useDB(async db=>{
   const user=await session(db,req);if(!user?.x_id)fail(401,'Sign in with X to add photos and videos.');
   if(action==='prepare')return json(res,200,await prepareMedia(db,user,input));
   if(action==='complete')return json(res,200,await finalizeMedia(db,storage,input.id,user.id));
   fail(404,'Media action not found.');
  });
 }catch(e){if(res.headersSent){res.destroy?.();return;}handleError(res,e);}
};}
export default createMediaHandler();
