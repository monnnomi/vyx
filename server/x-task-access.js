import {createCipheriv,createDecipheriv,randomBytes,createHash} from 'node:crypto';
import {fail} from './http.js';
export const taskScopes=['tweet.read','users.read','follows.read','like.read'];
export const taskAutomationStart=()=>process.env.X_TASK_AUTOMATION_START_AT||'2026-11-14T00:00:00Z';
function key(){if(!process.env.VYX_APP_SECRET)fail(503,'X verification is being configured.');return createHash('sha256').update('VYX X task token v1\0'+process.env.VYX_APP_SECRET).digest();}
export function sealTaskToken(value,xId){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key(),iv);c.setAAD(Buffer.from(xId));const data=Buffer.concat([c.update(value,'utf8'),c.final()]);return [iv,c.getAuthTag(),data].map(x=>x.toString('base64url')).join('.');}
export function openTaskToken(value,xId){const [iv,tag,data]=value.split('.').map(x=>Buffer.from(x,'base64url'));const d=createDecipheriv('aes-256-gcm',key(),iv);d.setAAD(Buffer.from(xId));d.setAuthTag(tag);return Buffer.concat([d.update(data),d.final()]).toString('utf8');}

function lifetime(access) {
 return Math.min(7200, Math.floor(Number(access?.expires_in)) || 0);
}

function hasTaskScopes(scope) {
 const granted = scope.split(' ');
 return taskScopes.every(required => granted.includes(required));
}

export async function saveTaskAccess(db, user, access) {
 const scope = String(access?.scope || '');
 const seconds = lifetime(access);
 if (!hasTaskScopes(scope) || !access?.access_token || seconds <= 0) return false;
 const refresh = scope.split(' ').includes('offline.access') && access.refresh_token;
 await db.q(`INSERT INTO x_task_access(user_id,x_id,sealed_token,sealed_refresh_token,scopes,expires_at)
  VALUES($1,$2,$3,$4,$5,clock_timestamp()+$6*interval '1 second')
  ON CONFLICT(user_id) DO UPDATE SET x_id=EXCLUDED.x_id, sealed_token=EXCLUDED.sealed_token,
  sealed_refresh_token=EXCLUDED.sealed_refresh_token,scopes=EXCLUDED.scopes,
  expires_at=EXCLUDED.expires_at,connected_at=clock_timestamp()`, [
  user.id, user.x_id, sealTaskToken(access.access_token, user.x_id),
  refresh ? sealTaskToken(refresh, 'refresh:' + user.x_id) : null, scope, seconds
 ]);
 return true;
}

const reconnect = 'Reconnect X to enable automatic task verification.';
const retry = 'X could not renew verification access. Please try again later.';

async function exchangeRefreshToken(token, fetcher) {
 const credentials = Buffer.from(process.env.X_CLIENT_ID + ':' + process.env.X_CLIENT_SECRET).toString('base64');
 let response;
 try {
  response = await fetcher('https://api.x.com/2/oauth2/token', {
   method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
   headers: {Authorization: 'Basic ' + credentials, 'Content-Type': 'application/x-www-form-urlencoded'},
   body: new URLSearchParams({grant_type: 'refresh_token', refresh_token: token})
  });
 } catch { fail(503, retry); }
 const result = await response.json().catch(() => ({}));
 if (response.status === 400 && result.error === 'invalid_grant') return null;
 if (!response.ok || typeof result.access_token !== 'string' || !result.access_token || lifetime(result) <= 0) fail(503, retry);
 return result;
}

export async function getTaskAccess(db, user, fetcher = fetch, rejectedToken = null) {
 // Serialize rotation with other checks, reconnects and disconnects for this member.
 const access = await db.tx(async tx => {
  const [row] = await tx.q(`SELECT sealed_token,sealed_refresh_token,scopes,
     expires_at>clock_timestamp() AS valid, expires_at>clock_timestamp()+interval '45 seconds' AS fresh
     FROM x_task_access WHERE user_id=$1 AND x_id=$2 FOR UPDATE`, [user.id, user.x_id]);
  if (!row || !hasTaskScopes(row.scopes)) return null;
  let token;
  try {
   if (row.sealed_token !== rejectedToken && (row.fresh || (row.valid && !row.sealed_refresh_token))) {
    return {token: openTaskToken(row.sealed_token, user.x_id), sealed: row.sealed_token, renewable: Boolean(row.sealed_refresh_token)};
   }
   if (!row.sealed_refresh_token) return null;
   token = openTaskToken(row.sealed_refresh_token, 'refresh:' + user.x_id);
  } catch { fail(409, reconnect); }
  const result = await exchangeRefreshToken(token, fetcher);
  const scope = result?.scope ?? row.scopes;
  if (!result || !hasTaskScopes(scope)) {
   // Commit removal before reporting that the participant must reconnect.
   await tx.q('DELETE FROM x_task_access WHERE user_id=$1', [user.id]);
   return null;
  }
  const sealed = sealTaskToken(result.access_token, user.x_id);
  const refresh = result.refresh_token ? sealTaskToken(result.refresh_token, 'refresh:' + user.x_id) : row.sealed_refresh_token;
  await tx.q(`UPDATE x_task_access SET sealed_token=$2, sealed_refresh_token=$3, scopes=$4,
    expires_at=clock_timestamp()+$5*interval '1 second' WHERE user_id=$1`,
   [user.id, sealed, scope.split(' ').includes('offline.access') ? refresh : null, scope, lifetime(result)]);
  return {token: result.access_token, sealed, renewable: scope.split(' ').includes('offline.access')};
 });
 if (!access) fail(409, reconnect);
 return access;
}
