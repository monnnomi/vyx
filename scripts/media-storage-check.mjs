import {put,del} from '@vercel/blob';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {blobStorage} from '../server/media-storage.js';
import {validMediaBytes} from '../server/media.js';
const paths=[];
try{
 for(const [name,file,type] of [['photo','public/assets/app-icon-192.png','image/png'],['video','/tmp/vyx-media-qa-large.mp4','video/mp4']]){
  const pathname='vyx-storage-check/'+randomUUID()+(name==='photo'?'.png':'.mp4'),bytes=await readFile(file);paths.push(pathname);
  if(name==='video'){
   const parts=[];for(let offset=0,part=1;offset<bytes.length;offset+=2097152,part++){const chunk=bytes.subarray(offset,offset+2097152),partPath='vyx-storage-check/'+randomUUID()+'.bin';paths.push(partPath);const stored=await blobStorage.putPart(partPath,chunk);parts.push({pathname:partPath,storage_url:stored.url});}
   await blobStorage.assemble({pathname,content_type:type},parts);
  }else await put(pathname,bytes,{access:'private',contentType:type,addRandomSuffix:false});
  const h=await blobStorage.head(pathname);assert.equal(h.size,bytes.length);assert.equal(h.contentType,type);
  const sample=await blobStorage.sample(h.url,Math.min(512,bytes.length));assert.ok(validMediaBytes(sample,type));
  const stream=await blobStorage.open({storage_url:h.url},{start:0,end:15,status:206});const range=Buffer.from(await new Response(stream).arrayBuffer());assert.deepEqual(range,bytes.subarray(0,16));
  const anonymous=await fetch(h.url);assert.notEqual(anonymous.status,200);await anonymous.body?.cancel();
  console.log('PASS: private '+name+' upload, verified bytes, HTTP range, anonymous origin denied.');
 }
}finally{for(const path of paths)await del(path);console.log('Only temporary storage-check files removed.');}
