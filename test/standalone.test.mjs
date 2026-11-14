import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStandaloneServer} from '../server/standalone.js';
import {createLocalMediaStorage} from '../server/local-media-storage.js';
import {waitUntil,drainBackground} from '../server/background.js';
import {mediaAvailable} from '../server/media.js';
const folder=await mkdtemp(join(tmpdir(),'vyx-standalone-'));
const image='vyx/12345678-1234-4234-8234-123456789abc.gif',part=n=>'vyx-parts/12345678-1234-4234-8234-123456789abc/'+n+'.bin';
after(()=>rm(folder,{recursive:true,force:true}));
test('private filesystem storage assembles complete uploads, verifies bytes and serves exact ranges',async()=>{
 const storage=createLocalMediaStorage(join(folder,'private')),a=Buffer.from('GIF89a'),b=Buffer.from('private image payload');
 await storage.putPart(part(1),a);await storage.putPart(part(2),b);
 await storage.assemble({pathname:image,byte_size:a.length+b.length},[{pathname:part(1)},{pathname:part(2)}]);
 const info=await storage.head(image);assert.equal(info.contentType,'image/gif');assert.equal(info.size,a.length+b.length);assert.match(info.url,/^local-media:/);
 assert.equal((await storage.sample(info.url,6)).toString(),'GIF89a');
 assert.equal(await new Response(await storage.open({pathname:image},{start:6,end:12})).text(),b.subarray(0,7).toString());
 await storage.del([part(1),part(2)]);await storage.del(part(1));await assert.rejects(storage.head(part(1)),e=>e.code==='ENOENT');
});
test('private storage rejects traversal, arbitrary URLs and paths outside attachment namespaces',async()=>{
 const storage=createLocalMediaStorage(join(folder,'private'));
 for(const path of ['../secret','/etc/passwd','vyx/../../secret','vyx/name.svg','vyx-parts/12345678-1234-4234-8234-123456789abc/26.bin'])await assert.rejects(storage.head(path),/Invalid private media pathname/);
 await assert.rejects(storage.sample('https://example.com/private',4),/Invalid private media URL/);
 await assert.rejects(storage.sample('local-media:///../secret',4),/Invalid private media pathname/);
});
test('standalone runtime serves security headers, health, API streams and revalidated static files',async()=>{
 const directory=join(folder,'public');await import('node:fs/promises').then(fs=>fs.mkdir(directory));await writeFile(join(directory,'index.html'),'VYX standalone');
 const server=createStandaloneServer({publicDirectory:directory,handlers:{'/api/vyx':async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;res.setHeader('Cache-Control','no-store');res.end(body||'API');}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 try{
  const page=await fetch(base);assert.equal(await page.text(),'VYX standalone');assert.equal(page.headers.get('x-frame-options'),'DENY');assert.ok(page.headers.get('content-security-policy'));
  const cached=await fetch(base,{headers:{'if-none-match':page.headers.get('etag')}});assert.equal(cached.status,304);
  const posted=await fetch(base+'/api/vyx',{method:'POST',body:'unchanged request stream'});assert.equal(await posted.text(),'unchanged request stream');assert.equal(posted.headers.get('cache-control'),'no-store');
  assert.equal((await fetch(base+'/api/not-found')).status,404);assert.equal((await fetch(base+'/.env')).status,403);assert.equal((await fetch(base+'/%2e%2e%2fsecret')).status,403);
  assert.deepEqual(await (await fetch(base+'/healthz')).json(),{ok:true});
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('Node background work is tracked after the response and local media needs no Vercel token',async()=>{
 process.env.VYX_RUNTIME='node';let finish,done=false;waitUntil(new Promise(resolve=>{finish=()=>{done=true;resolve();};}));assert.equal(done,false);finish();await drainBackground();assert.equal(done,true);
 const previous=process.env.MEDIA_STORAGE_DIR;process.env.MEDIA_STORAGE_DIR=folder;assert.equal(mediaAvailable(),true);if(previous===undefined)delete process.env.MEDIA_STORAGE_DIR;else process.env.MEDIA_STORAGE_DIR=previous;
 delete process.env.VYX_RUNTIME;
});
