import {randomUUID,createHash} from 'node:crypto';
import {fail,text,uuid,limit} from './http.js';
export const mediaLimits={maxPhotos:4,maxVideos:1,chunkBytes:2*1024*1024,imageBytes:10*1024*1024,videoBytes:50*1024*1024,dailyBytes:100*1024*1024,dailyFiles:20,storageBytes:512*1024*1024};
export const mediaTypes={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/avif':'avif','video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov'};
export const mediaAvailable=()=>Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const parents={post:'post_id',comment:'comment_id',room:'room_message_id',message:'message_id'};
export function mediaProjection(alias,column){
 if(!['p','m','c'].includes(alias)||!Object.values(parents).includes(column))throw new Error('Invalid media query.');
 return `COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'kind',a.kind,'content_type',a.content_type,'byte_size',a.byte_size,'url','/api/media?action=file&id='||a.id::text) ORDER BY a.position) FROM media_assets a WHERE a.${column}=${alias}.id AND a.status='attached'),'[]'::jsonb) AS media`;
}
export function mediaIds(value){
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length>4)fail(400,'Attach up to 4 photos or 1 video.');
 const ids=value.map(uuid);if(new Set(ids).size!==ids.length)fail(400,'Choose each attachment once.');return ids;
}
export async function authorizeUpload(db,user,scope,target){
 if(!user?.x_id||user.is_system)fail(401,'Sign in with X to add photos and videos.');
 if(!Object.hasOwn(parents,scope))fail(400,'Choose where to share your file.');
 if(scope==='post'){if(target!=null)fail(400,'Start a new post attachment.');return;}
 uuid(target);
 if(scope==='comment'){if(!(await db.q('SELECT 1 FROM posts WHERE id=$1',[target])).length)fail(404,'Post not found.');return;}
 if(scope==='room'){
  const rows=await db.q('SELECT 1 FROM room_members m JOIN rooms r ON r.id=m.room_id WHERE m.room_id=$1 AND m.user_id=$2 AND r.archived_at IS NULL',[target,user.id]);
  if(!rows.length)fail(403,'Join this room before adding attachments.');return;
 }
 const rows=await db.q('SELECT 1 FROM follows a JOIN follows b ON a.follower_id=b.following_id AND a.following_id=b.follower_id WHERE a.follower_id=$1 AND a.following_id=$2',[user.id,target]);
 if(!rows.length)fail(403,'Follow each other before sharing direct attachments.');
}
export async function prepareMedia(db,user,input){
 const mime=text(input.contentType,1,80),size=input.size,kind=mime.startsWith('image/')?'image':'video';
 if(!Object.hasOwn(mediaTypes,mime))fail(415,'Use JPG, PNG, WebP, GIF, AVIF, MP4, WebM or MOV.');
 if(!Number.isSafeInteger(size)||size<1||size>(kind==='image'?mediaLimits.imageBytes:mediaLimits.videoBytes))fail(413,kind==='image'?'Photos can be up to 10 MB.':'Videos can be up to 50 MB.');
 return db.tx(async tx=>{
  await authorizeUpload(tx,user,input.scope,input.targetId??null);
  await tx.q('SELECT id FROM users WHERE id=$1 FOR UPDATE',[user.id]);
  await tx.q('SELECT id FROM media_state WHERE id=1 FOR UPDATE');
  const [daily]=await tx.q("SELECT count(*)::int AS files,COALESCE(sum(byte_size),0)::bigint AS bytes FROM media_assets WHERE owner_id=$1 AND created_at>clock_timestamp()-interval '24 hours'",[user.id]);
  if(daily.files>=mediaLimits.dailyFiles||Number(daily.bytes)+size>mediaLimits.dailyBytes)fail(429,'Your daily upload allowance is used. Please try again tomorrow.');
  const [storage]=await tx.q("SELECT COALESCE(sum(byte_size*CASE WHEN status IN('pending','deleting') THEN 2 ELSE 1 END),0)::bigint AS bytes FROM media_assets WHERE status IN('pending','ready','attached','deleting')");
  if(Number(storage.bytes)+size*2>mediaLimits.storageBytes)fail(503,'The media store is full. Please try again later.');
  const id=randomUUID(),pathname='vyx/'+id+'.'+mediaTypes[mime];
  await tx.q('INSERT INTO media_assets(id,owner_id,scope,target_id,kind,content_type,byte_size,pathname) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,user.id,input.scope,input.targetId??null,kind,mime,size,pathname]);
  return {id,pathname,kind,contentType:mime,size};
 });
}
export async function uploadGrant(db,user,id,pathname){
 uuid(id);const [asset]=await db.q('SELECT * FROM media_assets WHERE id=$1 AND owner_id=$2',[id,user?.id||null]);
 if(!asset||asset.pathname!==pathname)fail(403,'This upload does not belong to your account.');
 if(asset.status!=='pending'||new Date(asset.created_at).getTime()+30*60000<Date.now())fail(409,'This upload has expired. Choose the file again.');
 await authorizeUpload(db,user,asset.scope,asset.target_id);await limit(db,'media-token:'+user.id,40);
 return {allowedContentTypes:[asset.content_type],maximumSizeInBytes:asset.byte_size,addRandomSuffix:false,allowOverwrite:false,validUntil:Date.now()+10*60000,tokenPayload:JSON.stringify({id:asset.id})};
}
export function validMediaBytes(bytes,mime){
 const b=Buffer.from(bytes),ascii=(start,end)=>b.subarray(start,end).toString('ascii');
 if(mime==='image/jpeg')return b.length>=3&&b[0]===255&&b[1]===216&&b[2]===255;
 if(mime==='image/png')return b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(mime==='image/gif')return ['GIF87a','GIF89a'].includes(ascii(0,6));
 if(mime==='image/webp')return ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP';
 if(mime==='video/webm')return b.subarray(0,4).equals(Buffer.from([26,69,223,163]));
 const avif=ascii(4,8)==='ftyp'&&/avif|avis/.test(ascii(8,Math.min(b.length,64)));
 if(mime==='image/avif')return avif;
 if(mime==='video/quicktime')return !avif&&(ascii(4,8)==='ftyp'&&ascii(8,12)==='qt  '||['moov','mdat','wide'].includes(ascii(4,8)));
 if(mime==='video/mp4')return !avif&&ascii(4,8)==='ftyp'&&!/heic|heix|mif1|qt  /.test(ascii(8,32));
 return false;
}
export async function finalizeMedia(db,storage,id,ownerId=null){
 uuid(id);
 return db.tx(async tx=>{
  const [asset]=await tx.q('SELECT * FROM media_assets WHERE id=$1 FOR UPDATE',[id]);
  if(!asset||ownerId&&ownerId!==asset.owner_id)fail(404,'Attachment not found.');
  if(['ready','attached'].includes(asset.status))return {id:asset.id,kind:asset.kind,status:asset.status};
  if(asset.status!=='pending'||new Date(asset.expires_at)<new Date())fail(409,'This upload has expired.');
  const parts=await tx.q('SELECT * FROM media_upload_parts WHERE asset_id=$1 ORDER BY part_number',[asset.id]);
  if(parts.length){
   if(parts.length!==Math.ceil(asset.byte_size/mediaLimits.chunkBytes)||parts.reduce((n,p)=>n+p.byte_size,0)!==asset.byte_size)fail(409,'Wait for all parts of this file to upload.');
   await storage.assemble(asset,parts);
  }
  const info=await storage.head(asset.pathname);
  if(info.pathname!==asset.pathname||info.size!==asset.byte_size||info.contentType!==asset.content_type)fail(415,'The uploaded file does not match its attachment.');
  const sample=await storage.sample(info.url,Math.min(512,asset.byte_size));
  if(!validMediaBytes(sample,asset.content_type))fail(415,'The file format could not be verified. Choose another file.');
  if(parts.length){await storage.del(parts.map(p=>p.pathname));await tx.q('DELETE FROM media_upload_parts WHERE asset_id=$1',[asset.id]);}
  await tx.q("UPDATE media_assets SET status='ready',storage_url=$2,uploaded_at=clock_timestamp() WHERE id=$1",[asset.id,info.url]);
  return {id:asset.id,kind:asset.kind,status:'ready'};
 });
}
export async function attachMedia(tx,user,scope,target,parentId,ids){
 if(!ids.length)return;
 const assets=await tx.q('SELECT * FROM media_assets WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[ids]);
 if(assets.length!==ids.length)fail(404,'Attachment not found.');
 if(assets.some(a=>a.owner_id!==user.id||a.scope!==scope||a.target_id!==(target??null)))fail(403,'Attachments can only be used by their owner in the intended conversation.');
 if(assets.some(a=>a.status!=='ready'||new Date(a.expires_at)<new Date()))fail(409,'Wait for uploads to finish, or choose expired files again.');
 const videos=assets.filter(a=>a.kind==='video').length;
 if(videos&&(videos!==1||assets.length!==1))fail(400,'Share 1 video at a time, or up to 4 photos.');
 const column=parents[scope];
 for(let i=0;i<ids.length;i++)await tx.q(`UPDATE media_assets SET status='attached',${column}=$2,position=$3 WHERE id=$1`,[ids[i],parentId,i]);
}
export async function readableMedia(db,user,id){
 uuid(id);const [a]=await db.q('SELECT * FROM media_assets WHERE id=$1',[id]);
 if(!a||!['ready','attached'].includes(a.status))fail(404,'Attachment not found.');
 if(a.status==='ready'){if(!user||a.owner_id!==user.id)fail(404,'Attachment not found.');return a;}
 if(a.post_id||a.comment_id)return a;
 if(!user?.x_id)fail(401,'Sign in with X to view this attachment.');
 if(a.room_message_id){
  const rows=await db.q(`SELECT 1 FROM room_messages m JOIN rooms r ON r.id=m.room_id JOIN room_members rm ON rm.room_id=r.id
   WHERE m.id=$1 AND m.deleted_at IS NULL AND r.archived_at IS NULL AND rm.user_id=$2`,[a.room_message_id,user.id]);
  if(!rows.length)fail(404,'Attachment not found.');return a;
 }
 const rows=await db.q('SELECT 1 FROM messages WHERE id=$1 AND (sender_id=$2 OR recipient_id=$2)',[a.message_id,user.id]);
 if(!rows.length)fail(404,'Attachment not found.');return a;
}
export function mediaRange(value,size){
 if(!value)return {start:0,end:size-1,status:200};
 const m=String(value).match(/^bytes=(\d*)-(\d*)$/);if(!m||!m[1]&&!m[2])fail(416,'Invalid file range.');
 const start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2]));
 let end=m[1]?(m[2]?Number(m[2]):Math.min(size-1,start+4*1024*1024-1)):size-1;
 end=Math.min(end,size-1);if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)fail(416,'Invalid file range.');
 return {start,end,status:206};
}
export async function cleanupMedia(db,storage){
 const stale=await db.tx(async tx=>{
  const rows=await tx.q("SELECT id,pathname,byte_size FROM media_assets WHERE status IN('pending','ready','deleting') AND expires_at<clock_timestamp() ORDER BY expires_at LIMIT 20 FOR UPDATE SKIP LOCKED");
  for(const a of rows)await tx.q("UPDATE media_assets SET status='deleting' WHERE id=$1",[a.id]);return rows;
 });
 let removed=0;
 for(const a of stale){try{const parts=await db.q('SELECT pathname FROM media_upload_parts WHERE asset_id=$1',[a.id]);await storage.del([a.pathname,...Array.from({length:Math.ceil(a.byte_size/mediaLimits.chunkBytes)},(_,i)=>'vyx-parts/'+a.id+'/'+(i+1)+'.bin')]);await db.q('DELETE FROM media_upload_parts WHERE asset_id=$1',[a.id]);await db.q("UPDATE media_assets SET status='deleted' WHERE id=$1 AND status='deleting'",[a.id]);removed++;}catch{}}
 return {removed};
}
export async function checkMediaRetry(tx,scope,parentId,ids){
 const rows=await tx.q(`SELECT id FROM media_assets WHERE ${parents[scope]}=$1 AND status='attached' ORDER BY position`,[parentId]);
 if(JSON.stringify(rows.map(r=>r.id))!==JSON.stringify(ids))fail(409,'Please start a new message request.');
}

export async function uploadMediaPart(db,user,id,partNumber,bytes,storage){
 uuid(id);if(!Number.isInteger(partNumber)||partNumber<1||partNumber>25)fail(400,'Invalid file part.');
 await limit(db,'media-part:'+user.id,80);
 return db.tx(async tx=>{
  const [asset]=await tx.q('SELECT * FROM media_assets WHERE id=$1 AND owner_id=$2 FOR UPDATE',[id,user.id]);
  if(!asset)fail(404,'Attachment not found.');
  if(asset.status!=='pending'||new Date(asset.expires_at)<new Date())fail(409,'This upload is no longer open.');
  await authorizeUpload(tx,user,asset.scope,asset.target_id);
  const total=Math.ceil(asset.byte_size/mediaLimits.chunkBytes),expected=Math.min(mediaLimits.chunkBytes,asset.byte_size-(partNumber-1)*mediaLimits.chunkBytes);
  if(partNumber>total||bytes.length!==expected)fail(400,'This file part has an unexpected size.');
  const digest=createHash('sha256').update(bytes).digest('hex'),[old]=await tx.q('SELECT sha256 FROM media_upload_parts WHERE asset_id=$1 AND part_number=$2',[id,partNumber]);
  if(old){if(old.sha256!==digest)fail(409,'This file part was already uploaded with different contents.');return {ok:true,part:partNumber};}
  const pathname='vyx-parts/'+id+'/'+partNumber+'.bin',stored=await storage.putPart(pathname,bytes);
  await tx.q('INSERT INTO media_upload_parts(asset_id,part_number,byte_size,pathname,storage_url,sha256) VALUES($1,$2,$3,$4,$5,$6)',[id,partNumber,bytes.length,pathname,stored.url,digest]);
  return {ok:true,part:partNumber};
 });
}
export async function readMediaPart(req){
 const max=mediaLimits.chunkBytes;
 if(Number(req.headers['content-length'])>max)fail(413,'This upload part is too large.');
 if(Buffer.isBuffer(req.body)||req.body instanceof Uint8Array){if(req.body.length>max)fail(413,'This upload part is too large.');return Buffer.from(req.body);}
 const chunks=[];let size=0;for await(const part of req){size+=part.length;if(size>max)fail(413,'This upload part is too large.');chunks.push(part);}
 return Buffer.concat(chunks);
}
