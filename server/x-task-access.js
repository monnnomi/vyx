import {createCipheriv,createDecipheriv,randomBytes,createHash} from 'node:crypto';
import {fail} from './http.js';
export const taskScopes=['tweet.read','users.read','follows.read','like.read'];
function key(){if(!process.env.VYX_APP_SECRET)fail(503,'X verification is being configured.');return createHash('sha256').update('VYX X task token v1\0'+process.env.VYX_APP_SECRET).digest();}
export function sealTaskToken(value,xId){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key(),iv);c.setAAD(Buffer.from(xId));const data=Buffer.concat([c.update(value,'utf8'),c.final()]);return [iv,c.getAuthTag(),data].map(x=>x.toString('base64url')).join('.');}
export function openTaskToken(value,xId){const [iv,tag,data]=value.split('.').map(x=>Buffer.from(x,'base64url'));const d=createDecipheriv('aes-256-gcm',key(),iv);d.setAAD(Buffer.from(xId));d.setAuthTag(tag);return Buffer.concat([d.update(data),d.final()]).toString('utf8');}
export async function saveTaskAccess(db,user,access){
 const scopes=String(access?.scope||'').split(' ');
 if(!taskScopes.every(s=>scopes.includes(s))||typeof access?.access_token!=='string')return false;
 const seconds=Math.min(7200,Number(access.expires_in)||0);if(seconds<=0)return false;
 await db.q('INSERT INTO x_task_access(user_id,x_id,sealed_token,scopes,expires_at) VALUES($1,$2,$3,$4,clock_timestamp()+$5*interval \'1 second\') ON CONFLICT(user_id) DO UPDATE SET x_id=EXCLUDED.x_id,sealed_token=EXCLUDED.sealed_token,scopes=EXCLUDED.scopes,expires_at=EXCLUDED.expires_at,connected_at=clock_timestamp()',[user.id,user.x_id,sealTaskToken(access.access_token,user.x_id),scopes.join(' '),seconds]);return true;
}
export async function getTaskAccess(db,user){
 const [r]=await db.q('SELECT sealed_token,scopes FROM x_task_access WHERE user_id=$1 AND x_id=$2 AND expires_at>clock_timestamp()',[user.id,user.x_id]);
 if(!r||!taskScopes.every(s=>r.scopes.split(' ').includes(s)))fail(409,'Reconnect X to enable automatic task verification.');
 try{return {token:openTaskToken(r.sealed_token,user.x_id),sealed:r.sealed_token};}catch{fail(409,'Reconnect X to enable automatic task verification.');}
}
