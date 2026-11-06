import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import handler from '../api/vyx.js';
import start from '../api/auth/x.js';
import callback from '../api/auth/callback/x.js';
import admin from '../api/admin.js';
import presence from '../api/presence.js';
import media from '../api/media.js';
import farm from '../api/farm.js';
import farmCron from '../api/farm-cron.js';
const port=Number(process.env.PORT||4173),root=resolve('public');
process.env.PUBLIC_APP_URL=`http://127.0.0.1:${port}`;
const routes={'/api/vyx':handler,'/api/media':media,'/api/admin':admin,'/api/presence':presence,'/api/farm':farm,'/api/farm-cron':farmCron,'/api/auth/x':start,'/api/auth/callback/x':callback};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webp':'image/webp','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
http.createServer(async(req,res)=>{
 const path=new URL(req.url,process.env.PUBLIC_APP_URL).pathname;
 if(routes[path])return routes[path](req,res);
 try{
  const file=resolve(root,'.'+decodeURIComponent(path==='/'?'/index.html':path==='/admin'?'/admin.html':path));
  if(!file.startsWith(root+'/')){res.writeHead(403).end();return;}
  const bytes=await readFile(file);res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(bytes);
 }catch{res.writeHead(404).end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log(`VYX development: http://127.0.0.1:${port}`));
