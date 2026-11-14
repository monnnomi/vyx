import {head,del,put,BlobNotFoundError} from '@vercel/blob';
import {Readable} from 'node:stream';
import {fail} from './http.js';
import {createLocalMediaStorage} from './local-media-storage.js';
function privateURL(value){const u=new URL(value);if(u.protocol!=='https:'||!u.hostname.endsWith('.private.blob.vercel-storage.com')||u.port||u.username||u.password)throw new Error('Invalid media origin.');return u.href;}
const headers=()=>({Authorization:'Bearer '+process.env.BLOB_READ_WRITE_TOKEN});
const vercelBlobStorage={
 head:pathname=>head(pathname),del:pathname=>del(pathname),
 putPart:(pathname,bytes)=>put(pathname,bytes,{access:'private',contentType:'application/octet-stream',addRandomSuffix:false,allowOverwrite:true}),
 async assemble(asset,parts){
  try{await head(asset.pathname);return;}catch(e){if(!(e instanceof BlobNotFoundError))throw e;}
  async function* chunks(){for(const part of parts){const r=await fetch(privateURL(part.storage_url),{headers:headers(),redirect:'error'});if(!r.ok)throw new Error('Missing media part');for await(const bytes of r.body)yield bytes;}}
  await put(asset.pathname,Readable.toWeb(Readable.from(chunks(),{objectMode:false})),{access:'private',contentType:asset.content_type,addRandomSuffix:false,allowOverwrite:false,multipart:true});
 },
 async sample(url,bytes){
  const r=await fetch(privateURL(url),{headers:{...headers(),Range:`bytes=0-${bytes-1}`},redirect:'error'});
  if(!r.ok)fail(503,'The uploaded file is not ready. Please try again.');
  const reader=r.body.getReader();let parts=[],length=0;
  try{while(length<bytes){const next=await reader.read();if(next.done)break;parts.push(next.value.subarray(0,bytes-length));length+=parts.at(-1).length;}}finally{await reader.cancel();}
  return Buffer.concat(parts);
 },
 async open(asset,range){
  const r=await fetch(privateURL(asset.storage_url),{headers:{...headers(),...(range.status===206?{Range:`bytes=${range.start}-${range.end}`}:{})},redirect:'error'});
  if(!r.ok||range.status===206&&r.status!==206){await r.body?.cancel();fail(503,'This attachment could not be loaded.');}
  return r.body;
 }
};
export const blobStorage=process.env.MEDIA_STORAGE_DIR?createLocalMediaStorage(process.env.MEDIA_STORAGE_DIR):vercelBlobStorage;
