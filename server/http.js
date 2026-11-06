import {createHash,createHmac,randomBytes} from 'node:crypto';
export const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export const hash=s=>createHash('sha256').update(s).digest('hex');
export const token=()=>randomBytes(32).toString('base64url');
export const appURL=()=>new URL(process.env.PUBLIC_APP_URL||'https://joinvyx.com').origin;
export function cookie(req,name){const raw=(req.headers.cookie||'').split(';').find(s=>s.trim().startsWith(name+'='));return raw?raw.trim().slice(name.length+1):'';}
export function setCookie(res,name,value,maxAge){res.setHeader('Set-Cookie',`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);}
export function json(res,status,body){res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');res.statusCode=status;res.end(JSON.stringify(body));}
export function redirect(res,path){res.setHeader('Cache-Control','no-store');res.statusCode=302;res.setHeader('Location',path);res.end();}
export async function body(req){
 if(!String(req.headers['content-type']||'').startsWith('application/json'))fail(415,'Send a JSON request.');
 if(req.body && typeof req.body==='object')return req.body;
 let raw='';for await(const part of req){raw+=part;if(Buffer.byteLength(raw)>12000)fail(413,'This request is too large.');}
 try{return JSON.parse(raw);}catch{fail(400,'This request could not be read.');}
}
export function sameOrigin(req){
 const origin=req.headers.origin;
 if(origin!==appURL())fail(403,'Please use the VYX website to make this request.');
}
export function ipKey(req){
 if(!process.env.VYX_APP_SECRET)fail(503,'Sign-in is being set up. Please try again later.');
 return createHmac('sha256',process.env.VYX_APP_SECRET).update(String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].trim()).digest('hex');
}
export async function limit(db,key,max,seconds=60,now=new Date()){
 const window=Math.floor(now.getTime()/1000/seconds)*seconds;
 const [row]=await db.q('INSERT INTO rate_limits(bucket,window_start,count) VALUES($1,$2,1) ON CONFLICT(bucket,window_start) DO UPDATE SET count=rate_limits.count+1 RETURNING count',[key,window]);
 if(row.count>max)fail(429,'A little too fast. Please try again shortly.');
}
export async function session(db,req){
 const t=cookie(req,'vyx_session');if(!/^[\w-]{43}$/.test(t))return null;
 const [u]=await db.q('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND NOT u.is_system',[hash(t)]);
 return u||null;
}
export const uuid=s=>{if(typeof s!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s))fail(400,'Invalid item.');return s;};
export function text(value,min,max){if(typeof value!=='string')fail(400,'Please enter text.');const v=value.trim();if(v.length<min||v.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))fail(400,`Please use ${min}–${max} characters.`);return v;}
export function handleError(res,error){if(!error.status)console.error('VYX request failed',error.code||error.name);json(res,error.status||500,{error:error.status?error.message:'Something went wrong. Please try again.'});}
