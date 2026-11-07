// Isolated UI fixtures, bound to loopback only. This file is excluded from deployment.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {mutate} from '../server/service.js';
import {settleDueWindows} from '../server/farming.js';
import {PGlite} from '@electric-sql/pglite';
import {createHandler} from '../api/vyx.js';
import {createAdminHandler} from '../api/admin.js';
import {createPresenceHandler} from '../api/presence.js';
import {createMediaHandler} from '../api/media.js';
import {session} from '../server/http.js';
import {createFarmHandler} from '../api/farm.js';
import {login} from '../server/oauth.js';
const pg=new PGlite();
await pg.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
if(process.env.VYX_QA_RULES_V2==='1'){await pg.exec("UPDATE farm_rule_versions SET starts_at='2026-11-01T00:00:00Z' WHERE version=1; UPDATE farm_rule_versions SET starts_at='2026-11-01T00:00:01Z' WHERE version=2; UPDATE farm_windows SET rule_version=2");}
let qaClock=null;
const wrap=p=>({q:async(sql,params=[])=>{const values=[...params];if(qaClock&&sql.includes('clock_timestamp()')){values.push(qaClock);sql=sql.replaceAll('clock_timestamp()',`$${values.length}::timestamptz`);}return (await p.query(sql,values)).rows;},tx:fn=>p.transaction(tx=>fn(wrap(tx)))});
const db=wrap(pg);
const a=await db.tx(tx=>login(tx,{id:'1001',name:'QA Alice',username:'qa_alice',avatar:''}));
const b=await db.tx(tx=>login(tx,{id:'1002',name:'QA Bob',username:'qa_bob',avatar:''}));
await db.q('INSERT INTO follows(follower_id,following_id) VALUES($1,$2),($2,$1)',[a.user.id,b.user.id]);
await db.q('INSERT INTO posts(user_id,body) VALUES($1,$2)',[b.user.id,'A local QA story for checking the shared VYX interface.']);
if(process.env.VYX_QA_FARMING==='1'){
 qaClock='2026-11-01T04:00:00Z';
 const room=await mutate(db,a.user,'room-create',{name:'The Night Circle',description:'Autumn stories, late-night ideas and good company.',requestId:randomUUID()});
 await mutate(db,b.user,'room-join',{id:room.id});
 for(const [minute,user,topic] of [[1,a.user,'Creative ideas for this season'],[6,a.user,'Building a welcoming community'],[11,a.user,'Thoughtful discussions with friends'],[12,b.user,'Sharing our autumn inspirations']]){
  qaClock=`2026-11-01T04:${String(minute).padStart(2,'0')}:00Z`;
  await mutate(db,user,'room-send',{id:room.id,body:topic+' — let us make our circle a little brighter together.',requestId:randomUUID()});
 }
 qaClock='2026-11-01T08:00:00Z';await settleDueWindows(db);
 if(process.env.VYX_QA_NFT_STACKING==='1')await db.q("INSERT INTO farm_account_rounds(window_start,user_id,multiplier_ppm,snapshot_ref) VALUES('2026-11-01T12:00Z',$1,5000000,'isolated-hypothetical-fixture')",[a.user.id]);
 qaClock='2026-11-01T12:01:00Z';await mutate(db,a.user,'room-send',{id:room.id,body:'Today I would love to hear what everyone is creating for the new season.',requestId:randomUUID()});
 qaClock='2026-11-01T12:03:00Z';await mutate(db,b.user,'room-send',{id:room.id,body:'I am exploring new community projects and sharing ideas with our circle.',requestId:randomUUID()});
 await mutate(db,b.user,'room-create',{name:'The Design Table',description:'A space for sharing work, exchanging feedback and noticing the small details.',requestId:randomUUID()});
 await mutate(db,a.user,'room-create',{name:'Off the Clock',description:'Books, music, good finds and conversations that go somewhere.',requestId:randomUUID()});
 qaClock='2026-11-01T12:20:00Z';
 await db.q("UPDATE follows SET created_at='2026-11-01T03:00:00Z'");
}
if(process.env.VYX_QA_PROFILE==='1'){
 await db.q("UPDATE users SET name='QA Alice',bio='A place for ideas, conversations and good company.',avatar_url='/assets/app-icon-192.png' WHERE id=$1",[a.user.id]);
 await db.q("INSERT INTO event_mints(campaign_id,user_id,x_id,minted_at) VALUES('halloween-2026',$1,'1001','2026-10-31T12:00:00Z') ON CONFLICT DO NOTHING",[a.user.id]);
}
let nftQaMember=null;
if(process.env.VYX_QA_NFT_SELECTION==='1'){
 nftQaMember=await db.tx(tx=>login(tx,{id:'1003',name:'QA Carol',username:'qa_carol',avatar:''}));
 const room=await mutate(db,a.user,'room-create',{name:'NFT selection QA',description:'Isolated eligibility fixtures.',requestId:randomUUID()});
 for(const [user,amount] of [[a.user,50000],[b.user,50000],[nftQaMember.user,49999]])await db.q("INSERT INTO farm_awards(user_id,room_id,window_start,season,amount,activity,units) VALUES($1,$2,'2026-11-01T00:00Z','season-1',$3,1,1)",[user.id,room.id,amount]);
 for(let i=0;i<3;i++){
  const member=await db.tx(tx=>login(tx,{id:String(1100+i),name:'QA Invite '+i,username:'qa_invite_'+i,avatar:''}));
  await db.q('INSERT INTO referrals(invitee_id,inviter_id) VALUES($1,$2)',[member.user.id,a.user.id]);
 }
}
const qaMediaFiles=new Map();
if(process.env.VYX_QA_MEDIA==='1')process.env.BLOB_READ_WRITE_TOKEN='qa-private-media';
const qaMediaStorage={
 head:async pathname=>{const f=qaMediaFiles.get(pathname);if(!f)throw new Error('QA file not found');return {pathname,size:f.bytes.length,contentType:f.type,url:'https://qa.private.blob.vercel-storage.com/'+pathname};},
 sample:async(url,n)=>qaMediaFiles.get(new URL(url).pathname.slice(1)).bytes.subarray(0,n),
 del:async paths=>{for(const path of [paths].flat())qaMediaFiles.delete(path);},
 putPart:async(path,bytes)=>{qaMediaFiles.set(path,{bytes,type:'application/octet-stream'});return {url:'https://qa.private.blob.vercel-storage.com/'+path};},
 assemble:async(asset,parts)=>qaMediaFiles.set(asset.pathname,{bytes:Buffer.concat(parts.map(p=>qaMediaFiles.get(p.pathname).bytes)),type:asset.content_type}),
 open:async(a,r)=>new Response(qaMediaFiles.get(a.pathname).bytes.subarray(r.start,r.end+1)).body
};
const qaMedia=createMediaHandler(fn=>fn(db),qaMediaStorage);
const qaPort=Number(process.env.VYX_QA_PORT||4174);process.env.PUBLIC_APP_URL='http://127.0.0.1:'+qaPort;process.env.VYX_ADMIN_X_IDS='1001';process.env.VYX_APP_SECRET=randomBytes(32).toString('base64url');
const api=createHandler(fn=>fn(db)),admin=createAdminHandler(fn=>fn(db)),presence=createPresenceHandler(fn=>fn(db)),farm=createFarmHandler(fn=>fn(db)),root=resolve('public');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webp':'image/webp','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
http.createServer(async(req,res)=>{
 const path=new URL(req.url,process.env.PUBLIC_APP_URL).pathname;
 if(path==='/test-login-carol'&&nftQaMember){res.setHeader('Set-Cookie',`vyx_session=${nftQaMember.sessionToken}; HttpOnly; SameSite=Lax; Path=/`);res.writeHead(302,{Location:'/#profile'});res.end();return;}
 if(path==='/test-login'||path==='/test-login-bob'){
  res.setHeader('Set-Cookie',`vyx_session=${path==='/test-login-bob'?b.sessionToken:a.sessionToken}; HttpOnly; SameSite=Lax; Path=/`);res.writeHead(302,{Location:'/'});res.end();return;
 }
 if(process.env.VYX_QA_MEDIA==='1'&&path==='/api/media')return qaMedia(req,res);
 if(process.env.VYX_QA_MEDIA==='1'&&path==='/media-upload-sdk.js'){
  res.setHeader('Content-Type','text/javascript');res.end(`export async function upload(path,file,options){options.onUploadProgress?.({percentage:30});const id=JSON.parse(options.clientPayload).id;const r=await fetch('/test-media-upload?id='+id,{method:'POST',body:file,headers:{'Content-Type':file.type},signal:options.abortSignal});const result=await r.json();if(!r.ok)throw new Error(result.error);options.onUploadProgress?.({percentage:100});return result;}`);return;
 }
 if(process.env.VYX_QA_MEDIA==='1'&&path==='/test-media-upload'){
  const user=await session(db,req),id=new URL(req.url,process.env.PUBLIC_APP_URL).searchParams.get('id');
  const [asset]=await db.q('SELECT * FROM media_assets WHERE id=$1 AND owner_id=$2',[id,user?.id||null]);
  if(!asset){res.writeHead(403).end(JSON.stringify({error:'Not your QA upload'}));return;}
  const parts=[];let size=0;for await(const part of req){size+=part.length;if(size>52428800){res.writeHead(413).end(JSON.stringify({error:'Too large'}));return;}parts.push(part);}
  qaMediaFiles.set(asset.pathname,{bytes:Buffer.concat(parts),type:req.headers['content-type']});res.setHeader('Content-Type','application/json');res.end(JSON.stringify({pathname:asset.pathname}));return;
 }
 if(path==='/api/vyx')return api(req,res);
 if(path==='/api/admin')return admin(req,res);
 if(path==='/api/presence')return presence(req,res);
 if(path==='/api/farm')return farm(req,res);
 try{const f=resolve(root,'.'+(path==='/'?'/index.html':path==='/admin'?'/admin.html':path));if(!f.startsWith(root+'/'))throw new Error();res.setHeader('Content-Type',types[extname(f)]||'application/octet-stream');res.end(await readFile(f));}catch{res.writeHead(404).end();}
}).listen(qaPort,'127.0.0.1',()=>console.log('Isolated UI test: http://127.0.0.1:'+qaPort+'/test-login'));
