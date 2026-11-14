import {mkdir,stat,rename,unlink,open} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {resolve,dirname,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const allowed=new RegExp(`^(vyx/${uuid}\\.(jpg|png|webp|gif|avif|mp4|webm|mov)|vyx-parts/${uuid}/([1-9]|1[0-9]|2[0-5])\\.bin)$`,'i');
const mime={'.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif','.avif':'image/avif','.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime','.bin':'application/octet-stream'};
export function createLocalMediaStorage(directory){
 const root=resolve(directory);
 const path=name=>{if(typeof name!=='string'||!allowed.test(name))throw Error('Invalid private media pathname');return resolve(root,name);};
 const fromURL=value=>{const u=new URL(value);if(u.protocol!=='local-media:'||u.host||u.search||u.hash)throw Error('Invalid private media URL');return decodeURIComponent(u.pathname).replace(/^\//,'');};
 async function atomic(name,source){const file=path(name);await mkdir(dirname(file),{recursive:true,mode:0o700});const temporary=file+'.'+randomUUID()+'.tmp';
  try{await pipeline(source,createWriteStream(temporary,{flags:'wx',mode:0o600}));await rename(temporary,file);}finally{await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 }
 return {
  async head(name){const info=await stat(path(name));if(!info.isFile())throw Error('Invalid private media file');return {pathname:name,size:info.size,contentType:mime[extname(name).toLowerCase()],url:'local-media:///'+name};},
  async del(names){for(const name of [names].flat())await unlink(path(name)).catch(e=>{if(e.code!=='ENOENT')throw e;});},
  async putPart(name,bytes){await atomic(name,Readable.from([bytes]));return {url:'local-media:///'+name};},
  async assemble(asset,parts){
   try{const info=await stat(path(asset.pathname));if(info.size===asset.byte_size)return;}catch(e){if(e.code!=='ENOENT')throw e;}
   async function* chunks(){for(const part of parts)for await(const bytes of createReadStream(path(part.pathname)))yield bytes;}
   await atomic(asset.pathname,Readable.from(chunks()));
  },
  async sample(url,length){const file=await open(path(fromURL(url)),'r');try{const buffer=Buffer.alloc(length);const result=await file.read(buffer,0,length,0);return buffer.subarray(0,result.bytesRead);}finally{await file.close();}},
  async open(asset,range){return Readable.toWeb(createReadStream(path(asset.pathname),{start:range.start,end:range.end}));}
 };
}
