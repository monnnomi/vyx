import {serveOwnerPage} from './owner-interface.js';
import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {resolve,extname} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';
import vyx from '../api/vyx.js';
import auth from '../api/auth/x.js';
import callback from '../api/auth/callback/x.js';
import admin from '../api/admin.js';
import presence from '../api/presence.js';
import media from '../api/media.js';
import farm from '../api/farm.js';
import farmCron from '../api/farm-cron.js';
import news from '../api/news.js';
import newsCron from '../api/news-cron.js';
const root=resolve(new URL('../public/',import.meta.url).pathname);
const routes={'/api/vyx':vyx,'/api/auth/x':auth,'/api/auth/callback/x':callback,'/api/admin':admin,'/api/presence':presence,'/api/media':media,'/api/farm':farm,'/api/farm-cron':farmCron,'/api/news':news,'/api/news-cron':newsCron};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.webmanifest':'application/manifest+json','.mp3':'audio/mpeg','.wav':'audio/wav','.woff2':'font/woff2','.ttf':'font/ttf'};
// Pages reference local styles and scripts as plain paths. When serving a page,
// each local .css/.js reference gains ?v=<content hash>; a request carrying ?v=
// can then be cached for a year, because a changed file gets a new URL.
const assetHashes=new Map();
async function assetHash(staticRoot,name){
 const file=resolve(staticRoot,'.'+(name.startsWith('/')?name:'/'+name));
 if(!file.startsWith(staticRoot+'/'))return null;
 const info=await stat(file).catch(()=>null);if(!info?.isFile())return null;
 const known=assetHashes.get(file);
 if(known&&known.mtimeMs===info.mtimeMs&&known.size===info.size)return known.hash;
 const hash=createHash('sha256').update(await readFile(file)).digest('hex').slice(0,12);
 assetHashes.set(file,{mtimeMs:info.mtimeMs,size:info.size,hash});return hash;
}
export async function versionAssetLinks(html,staticRoot){
 const pattern=/\b(href|src)="(\/?[\w./-]+\.(?:css|js))"/g,names=new Set();
 for(const m of html.matchAll(pattern))if(!m[2].startsWith('//'))names.add(m[2]);
 const hashes=new Map();for(const name of names)hashes.set(name,await assetHash(staticRoot,name));
 return html.replace(pattern,(whole,attr,name)=>hashes.get(name)?`${attr}="${name}?v=${hashes.get(name)}"`:whole);
}
const versionedTypes=new Set(['.css','.js','.woff2','.png','.webp','.svg','.jpg','.mp3','.wav']);
const versionedPages=new Set(['/index.html','/admin.html']);
const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
const security=config.headers.find(h=>h.source==='/(.*)').headers;
export function createStandaloneServer({handlers=routes,publicDirectory=root}={}){
 const staticRoot=resolve(publicDirectory);
 const server=http.createServer(async(req,res)=>{
  for(const h of security)res.setHeader(h.key,h.value);
  try{
   const url=new URL(req.url,'http://localhost'),path=url.pathname;
   if(path==='/healthz'){res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');return res.end('{"ok":true}');}
   const route=handlers[path]||(/^\/api\/(farm|news)-cron\/(00|04|08|12|16|20)$/.test(path)?handlers[path.replace(/\/\d+$/,'')]:null);
   if(route){await route(req,res);return;}
   if(path.startsWith('/api/')){res.statusCode=404;return res.end('Not found');}
   if(!['GET','HEAD'].includes(req.method)){res.statusCode=405;return res.end('Method not allowed');}
   if(await serveOwnerPage(path,req,res))return;
   const decoded=decodeURIComponent(path==='/'?'/index.html':path==='/admin'?'/admin.html':path);
   const file=resolve(staticRoot,'.'+decoded);
   if(!file.startsWith(staticRoot+'/')||decoded.includes('\0')||decoded.split('/').some(p=>p.startsWith('.'))){res.statusCode=403;return res.end('Forbidden');}
   const info=await stat(file);if(!info.isFile()){res.statusCode=404;return res.end('Not found');}
   if(versionedPages.has(decoded)){
    const html=Buffer.from(await versionAssetLinks(await readFile(file,'utf8'),staticRoot));
    const pageTag='"'+createHash('sha256').update(html).digest('hex')+'"';
    res.setHeader('ETag',pageTag);res.setHeader('Cache-Control','public,max-age=0,must-revalidate');
    if(req.headers['if-none-match']===pageTag){res.statusCode=304;return res.end();}
    res.setHeader('Content-Type',types['.html']);res.setHeader('Content-Length',html.length);
    return res.end(req.method==='HEAD'?undefined:html);
   }
   const etag='"'+createHash('sha256').update(String(info.size)+':'+String(info.mtimeMs)).digest('hex')+'"';
   const immutable=url.searchParams.has('v')&&versionedTypes.has(extname(file));
   res.setHeader('ETag',etag);res.setHeader('Cache-Control',immutable?'public,max-age=31536000,immutable':'public,max-age=0,must-revalidate');
   if(req.headers['if-none-match']===etag){res.statusCode=304;return res.end();}
   res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.setHeader('Content-Length',info.size);
   if(req.method==='HEAD')return res.end();await pipeline(createReadStream(file),res);
  }catch(error){
   if(res.headersSent){res.destroy();return;}
   res.statusCode=error.code==='ENOENT'?404:error instanceof URIError?400:500;
   res.setHeader('Content-Type','text/plain');res.end(res.statusCode===404?'Not found':'Request failed');
  }
 });
 server.requestTimeout=70000;server.headersTimeout=15000;server.keepAliveTimeout=5000;return server;
}
