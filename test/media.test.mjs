import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {Writable} from 'node:stream';
import {prepareMedia,finalizeMedia,readableMedia,mediaRange,mediaLimits,mediaIds,validMediaBytes,cleanupMedia,uploadMediaPart} from '../server/media.js';
import {mutate,feed,comments,messages,conversations} from '../server/service.js';
import {roomThread,roomMessage,listRooms} from '../server/rooms.js';
import {createMediaHandler} from '../api/media.js';
import {hash} from '../server/http.js';
const schema=await readFile(new URL('../db/schema.sql',import.meta.url),'utf8');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLXcAAAAASUVORK5CYII=','base64');
const video=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom0000mp42isom')]);
async function fixture(t){
 const pg=new PGlite();t.after(()=>pg.close());await pg.exec(schema);
 const wrap=p=>({q:async(s,v=[])=>(await p.query(s,v)).rows,tx:fn=>p.transaction(x=>fn(wrap(x)))}),db=wrap(pg);
 const make=async n=>(await db.q('INSERT INTO users(x_id,handle,name) VALUES($1,$2,$2) RETURNING *',[n,'media_'+n]))[0];
 const a=await make('2001'),b=await make('2002'),c=await make('2003');
 const room=(await mutate(db,a,'room-create',{name:'Media circle',requestId:randomUUID()})).id;
 await mutate(db,b,'room-join',{id:room});await db.q('INSERT INTO follows(follower_id,following_id) VALUES($1,$2),($2,$1)',[a.id,b.id]);
 const files=new Map();const store={
  head:async path=>{const f=files.get(path);if(!f)throw new Error('Missing file');return {pathname:path,size:f.bytes.length,contentType:f.type,url:'https://fixture.private.blob.vercel-storage.com/'+path};},
  sample:async(url,n)=>files.get(new URL(url).pathname.slice(1)).bytes.subarray(0,n),
  del:async paths=>{for(const path of [paths].flat())files.delete(path);},
  putPart:async(path,bytes)=>{files.set(path,{bytes,type:'application/octet-stream'});return {url:'https://fixture.private.blob.vercel-storage.com/'+path};},
  assemble:async(asset,parts)=>{files.set(asset.pathname,{bytes:Buffer.concat(parts.map(p=>files.get(p.pathname).bytes)),type:asset.content_type});},
  open:async(asset,r)=>new Response(files.get(asset.pathname).bytes.subarray(r.start,r.end+1)).body
 };
 const upload=async(user=a,scope='room',targetId=room,type='image/png',bytes=png)=>{
  const prepared=await prepareMedia(db,user,{scope,targetId,contentType:type,size:bytes.length});files.set(prepared.pathname,{bytes,type});await finalizeMedia(db,store,prepared.id,user.id);return prepared;
 };
 return {pg,db,a,b,c,room,store,files,upload};
}
const denied=(p,status)=>assert.rejects(p,e=>e.status===status);
test('prepare requires X and destination access; unsupported formats, oversized files and invalid lists are rejected',async t=>{
 const f=await fixture(t),input={scope:'room',targetId:f.room,contentType:'image/png',size:png.length};
 await denied(prepareMedia(f.db,null,input),401);await denied(prepareMedia(f.db,f.c,input),403);
 await denied(prepareMedia(f.db,f.a,{...input,scope:'message',targetId:f.c.id}),403);
 await denied(prepareMedia(f.db,f.a,{...input,contentType:'image/svg+xml'}),415);
 await denied(prepareMedia(f.db,f.a,{...input,size:mediaLimits.imageBytes+1}),413);
 await denied(prepareMedia(f.db,f.a,{...input,contentType:'video/mp4',size:mediaLimits.videoBytes+1}),413);
 assert.throws(()=>mediaIds([randomUUID(),randomUUID(),randomUUID(),randomUUID(),randomUUID()]),e=>e.status===400);
 const id=randomUUID();assert.throws(()=>mediaIds([id,id]),e=>e.status===400);
});
test('actual bytes and storage metadata are verified before a file can become ready',async t=>{
 const f=await fixture(t),p=await prepareMedia(f.db,f.a,{scope:'post',contentType:'image/png',size:png.length});
 f.files.set(p.pathname,{bytes:Buffer.alloc(png.length,65),type:'image/png'});
 await denied(finalizeMedia(f.db,f.store,p.id,f.a.id),415);
 assert.equal((await f.db.q('SELECT status FROM media_assets WHERE id=$1',[p.id]))[0].status,'pending');
 f.files.set(p.pathname,{bytes:png,type:'image/png'});await denied(finalizeMedia(f.db,f.store,p.id,f.b.id),404);
 assert.equal((await finalizeMedia(f.db,f.store,p.id,f.a.id)).status,'ready');
 assert.equal((await finalizeMedia(f.db,f.store,p.id,f.a.id)).status,'ready');
 assert.ok(validMediaBytes(png,'image/png'));assert.ok(!validMediaBytes(Buffer.from('<script>alert(1)</script>'),'image/png'));
 assert.ok(validMediaBytes(video,'video/mp4'));assert.ok(!validMediaBytes(Buffer.from('0000ftypavif0000avif'),'video/mp4'));
});
test('room media-only messages are idempotent, member-only and hidden after leaving, deletion or closing',async t=>{
 const f=await fixture(t),p=await f.upload(),requestId=randomUUID(),input={id:f.room,body:'',mediaIds:[p.id],requestId};
 const m=await mutate(f.db,f.a,'room-send',input);assert.equal((await mutate(f.db,f.a,'room-send',input)).id,m.id);
 const thread=await roomThread(f.db,f.b,f.room);assert.equal(thread.messages[0].body,'');assert.equal(thread.messages[0].media[0].id,p.id);assert.ok(!JSON.stringify(thread).includes('.blob.vercel-storage.com'));
 await denied(readableMedia(f.db,f.c,p.id),404);await denied(readableMedia(f.db,null,p.id),401);
 assert.equal((await readableMedia(f.db,f.b,p.id)).id,p.id);
 await mutate(f.db,f.b,'room-leave',{id:f.room});await denied(readableMedia(f.db,f.b,p.id),404);
 assert.equal((await listRooms(f.db,f.c)).rooms[0].last_message,null);
 assert.equal((await f.db.q('SELECT count(*)::int AS n FROM farm_contributions WHERE message_id=$1',[m.id]))[0].n,0);
 await mutate(f.db,f.a,'room-delete-message',{id:f.room,messageId:m.id});await denied(readableMedia(f.db,f.a,p.id),404);
 const v=await f.upload(f.a,'room',f.room,'video/mp4',video);await mutate(f.db,f.a,'room-send',{id:f.room,body:'A short video',mediaIds:[v.id],requestId:randomUUID()});
 await mutate(f.db,f.a,'room-close',{id:f.room});await denied(readableMedia(f.db,f.a,v.id),404);
});
test('an animated GIF keeps its original bytes and MIME type through room upload, send and private delivery',async t=>{
 const f=await fixture(t),bytes=await readFile(new URL('fixtures/room-hello.gif',import.meta.url));
 assert.ok(validMediaBytes(bytes,'image/gif'));assert.ok(bytes.includes(Buffer.from('NETSCAPE2.0')));
 const p=await prepareMedia(f.db,f.a,{scope:'room',targetId:f.room,contentType:'image/gif',size:bytes.length});
 await uploadMediaPart(f.db,f.a,p.id,1,bytes,f.store);await finalizeMedia(f.db,f.store,p.id,f.a.id);
 const request={id:f.room,body:'',mediaIds:[p.id],requestId:randomUUID()},m=await mutate(f.db,f.a,'room-send',request);
 assert.equal((await mutate(f.db,f.a,'room-send',request)).id,m.id);
 const thread=await roomThread(f.db,f.b,f.room),attachment=thread.messages[0].media[0];
 assert.equal(attachment.content_type,'image/gif');assert.equal(attachment.kind,'image');
 const a=await readableMedia(f.db,f.b,p.id);assert.equal(a.content_type,'image/gif');
 assert.deepEqual(Buffer.from(await new Response(await f.store.open(a,mediaRange(null,a.byte_size))).arrayBuffer()),bytes);
 assert.equal((await f.db.q('SELECT count(*)::int AS n FROM farm_contributions WHERE message_id=$1',[m.id]))[0].n,0);
 await denied(readableMedia(f.db,f.c,p.id),404);
 const fake=await prepareMedia(f.db,f.a,{scope:'room',targetId:f.room,contentType:'image/gif',size:png.length});
 f.files.set(fake.pathname,{bytes:png,type:'image/gif'});await denied(finalizeMedia(f.db,f.store,fake.id,f.a.id),415);
});
test('private attachments stay with their two participants, including after unfollowing',async t=>{
 const f=await fixture(t),p=await f.upload(f.a,'message',f.b.id),requestId=randomUUID(),input={id:f.b.id,body:'',mediaIds:[p.id],requestId};
 const m=await mutate(f.db,f.a,'message',input);assert.equal((await mutate(f.db,f.a,'message',input)).id,m.id);
 assert.equal((await messages(f.db,f.b,f.a.id))[0].media[0].id,p.id);assert.equal((await conversations(f.db,f.b))[0].body,'Attachment');
 assert.equal((await messages(f.db,f.c,f.a.id)).length,0);await denied(readableMedia(f.db,f.c,p.id),404);
 await f.db.q('DELETE FROM follows WHERE follower_id=$1',[f.a.id]);assert.equal((await readableMedia(f.db,f.b,p.id)).id,p.id);
 await denied(mutate(f.db,f.a,'message',{id:f.c.id,body:'',mediaIds:[p.id],requestId}),409);
});
test('post and comment attachments are public after publication, private while drafts and cannot be stolen or reused',async t=>{
 const f=await fixture(t),p=await f.upload(f.a,'post',null);await denied(readableMedia(f.db,null,p.id),404);
 await denied(mutate(f.db,f.b,'post',{body:'',mediaIds:[p.id]}),403);
 const requestId=randomUUID(),input={body:'',mediaIds:[p.id],requestId},post=await mutate(f.db,f.a,'post',input);
 assert.equal((await mutate(f.db,f.a,'post',input)).id,post.id);assert.equal((await feed(f.db,null))[0].media[0].id,p.id);assert.equal((await readableMedia(f.db,null,p.id)).post_id,post.id);
 await denied(mutate(f.db,f.a,'post',{body:'',mediaIds:[p.id],requestId:randomUUID()}),409);
 const c=await f.upload(f.b,'comment',post.id),key=randomUUID();
 await mutate(f.db,f.b,'comment',{id:post.id,body:'',mediaIds:[c.id],requestId:key});await mutate(f.db,f.b,'comment',{id:post.id,body:'',mediaIds:[c.id],requestId:key});
 assert.equal((await comments(f.db,post.id)).length,1);assert.equal((await comments(f.db,post.id))[0].media[0].id,c.id);assert.equal((await readableMedia(f.db,null,c.id)).id,c.id);
});
test('scope, attachment counts, ready status and upload quotas are enforced on the server',async t=>{
 const f=await fixture(t),p=await f.upload(),v=await f.upload(f.a,'room',f.room,'video/mp4',video);
 await denied(mutate(f.db,f.a,'room-send',{id:f.room,body:'',mediaIds:[p.id,v.id],requestId:randomUUID()}),400);
 await denied(mutate(f.db,f.a,'post',{body:'',mediaIds:[p.id]}),403);
 const pending=await prepareMedia(f.db,f.a,{scope:'post',contentType:'image/png',size:png.length});await denied(mutate(f.db,f.a,'post',{body:'',mediaIds:[pending.id]}),409);
 await f.db.q('UPDATE media_assets SET byte_size=$1 WHERE id=$2',[mediaLimits.videoBytes,p.id]);await f.db.q('UPDATE media_assets SET byte_size=$1 WHERE id=$2',[mediaLimits.videoBytes,v.id]);
 await denied(prepareMedia(f.db,f.a,{scope:'post',contentType:'image/png',size:png.length}),429);
});
test('cleanup removes abandoned uploads and never removes attached media',async t=>{
 const f=await fixture(t),draft=await f.upload(),sent=await f.upload();
 await mutate(f.db,f.a,'room-send',{id:f.room,body:'',mediaIds:[sent.id],requestId:randomUUID()});
 await f.db.q("UPDATE media_assets SET expires_at=clock_timestamp()-interval '1 day'");
 assert.equal((await cleanupMedia(f.db,f.store)).removed,1);assert.ok(!f.files.has(draft.pathname));assert.ok(f.files.has(sent.pathname));
 assert.equal((await readableMedia(f.db,f.a,sent.id)).id,sent.id);
});
test('HTTP media delivery enforces sessions, supports video ranges and rejects forged callbacks and cross-origin writes',async t=>{
 const f=await fixture(t);process.env.BLOB_READ_WRITE_TOKEN='vercel_blob_rw_fixture_private';process.env.PUBLIC_APP_URL='https://vyx-social.vercel.app';
 const key='m'.repeat(43);await f.db.q("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",[hash(key),f.b.id]);
 const p=await f.upload(f.a,'room',f.room,'video/mp4',video);await mutate(f.db,f.a,'room-send',{id:f.room,body:'',mediaIds:[p.id],requestId:randomUUID()});
 const h=createMediaHandler(fn=>fn(f.db),f.store);
 const call=async(action,{method='GET',auth=false,origin,range,body}={})=>{
  const chunks=[],res=new Writable({write(chunk,encoding,done){chunks.push(Buffer.from(chunk));done();}});res.headers={};res.setHeader=(k,v)=>{res.headers[k]=v;};
  await h({method,url:'/api/media?action='+action,headers:{...(auth?{cookie:'vyx_session='+key}:{}),...(origin?{origin}:{}),...(range?{range}:{}),'content-type':'application/json'},body},res);
  return {status:res.statusCode,headers:res.headers,bytes:Buffer.concat(chunks)};
 };
 assert.equal((await call('file&id='+p.id)).status,401);
 const r=await call('file&id='+p.id,{auth:true,range:'bytes=0-3'});assert.equal(r.status,206);assert.equal(r.headers['Content-Range'],`bytes 0-3/${video.length}`);assert.deepEqual(r.bytes,video.subarray(0,4));assert.match(r.headers['Cache-Control'],/no-store/);
 assert.equal((await call('prepare',{method:'POST',auth:true,body:{}})).status,403);
 assert.equal((await call('prepare',{method:'POST',origin:process.env.PUBLIC_APP_URL,body:{}})).status,401);
 const forged=await call('upload',{method:'POST',body:{type:'blob.upload-completed',payload:{blob:{pathname:p.pathname},tokenPayload:JSON.stringify({id:p.id})}}});assert.notEqual(forged.status,200);
 assert.equal(mediaRange('bytes=-3',10).start,7);assert.throws(()=>mediaRange('bytes=11-',10),e=>e.status===416);assert.throws(()=>mediaRange('bytes=1-2,4-5',10),e=>e.status===416);
});

test('same-origin parts are size-bound, owned, idempotent and assembled into one verified attachment',async t=>{
 const f=await fixture(t),bytes=Buffer.concat([png,Buffer.alloc(mediaLimits.chunkBytes+16-png.length)]),p=await prepareMedia(f.db,f.a,{scope:'post',contentType:'image/png',size:bytes.length});
 const first=bytes.subarray(0,mediaLimits.chunkBytes),last=bytes.subarray(mediaLimits.chunkBytes);
 await denied(uploadMediaPart(f.db,f.b,p.id,1,first,f.store),404);
 await denied(uploadMediaPart(f.db,f.a,p.id,1,first.subarray(1),f.store),400);
 assert.equal((await uploadMediaPart(f.db,f.a,p.id,1,first,f.store)).ok,true);
 await uploadMediaPart(f.db,f.a,p.id,1,first,f.store);
 const changed=Buffer.from(first);changed[20]=1;await denied(uploadMediaPart(f.db,f.a,p.id,1,changed,f.store),409);
 await denied(finalizeMedia(f.db,f.store,p.id,f.a.id),409);
 await uploadMediaPart(f.db,f.a,p.id,2,last,f.store);
 assert.equal((await finalizeMedia(f.db,f.store,p.id,f.a.id)).status,'ready');
 assert.deepEqual(f.files.get(p.pathname).bytes,bytes);
 assert.equal((await f.db.q('SELECT count(*)::int AS n FROM media_upload_parts'))[0].n,0);
 assert.ok(![...f.files.keys()].some(k=>k.startsWith('vyx-parts/')));
 await denied(uploadMediaPart(f.db,f.a,p.id,1,first,f.store),409);
 const post=await mutate(f.db,f.a,'post',{body:'',mediaIds:[p.id]});assert.equal((await readableMedia(f.db,null,p.id)).post_id,post.id);
});
test('binary upload HTTP authenticates each part and accepts no oversized or foreign bytes',async t=>{
 const f=await fixture(t);process.env.BLOB_READ_WRITE_TOKEN='qa-private-media';process.env.PUBLIC_APP_URL='https://vyx-social.vercel.app';
 const p=await prepareMedia(f.db,f.a,{scope:'post',contentType:'image/png',size:png.length}),key='p'.repeat(43);
 await f.db.q("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",[hash(key),f.a.id]);
 const h=createMediaHandler(fn=>fn(f.db),f.store);
 const call=async({origin=process.env.PUBLIC_APP_URL,auth=true,bytes=png}={})=>{let result;const res={setHeader(){},end(s){result=JSON.parse(s);}};await h({method:'POST',url:'/api/media?action=part&id='+p.id+'&part=1',headers:{origin,...(auth?{cookie:'vyx_session='+key}:{}),'content-type':'application/octet-stream','content-length':String(bytes.length)},body:bytes},res);return {status:res.statusCode,result};};
 assert.equal((await call({auth:false})).status,401);assert.equal((await call({origin:'https://example.com'})).status,403);
 assert.equal((await call({bytes:Buffer.alloc(mediaLimits.chunkBytes+1)})).status,413);
 assert.equal((await call()).status,200);assert.equal((await finalizeMedia(f.db,f.store,p.id,f.a.id)).status,'ready');
});
