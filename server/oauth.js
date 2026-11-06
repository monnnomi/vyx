import {createHash} from 'node:crypto';
import {hash,token,fail,appURL} from './http.js';

export const challenge=verifier=>createHash('sha256').update(verifier).digest('base64url');
export async function startOAuth(db,binding,now=new Date(),returnTo='/',ref=null){
 const [inviter]=/^[0-9a-f-]{36}$/i.test(ref||'')?await db.q('SELECT id FROM users WHERE id::text=$1 AND NOT is_system AND x_id IS NOT NULL',[ref.toLowerCase()]):[];
 const state=token(),verifier=token();
 await db.q('INSERT INTO oauth_attempts(state_hash,cookie_hash,verifier,expires_at,return_to,inviter_id) VALUES($1,$2,$3,$4,$5,$6)',[hash(state),hash(binding),verifier,new Date(now.getTime()+600000),returnTo==='/admin'?'/admin':'/',inviter?.id||null]);
 const url=new URL('https://x.com/i/oauth2/authorize');
 url.search=new URLSearchParams({response_type:'code',client_id:process.env.X_CLIENT_ID,redirect_uri:appURL()+'/api/auth/callback/x',scope:'tweet.read users.read',state,code_challenge:challenge(verifier),code_challenge_method:'S256'});
 return url.toString();
}
export async function consumeAttempt(db,state,binding){
 if(!/^[\w-]{43}$/.test(state||'')||!/^[\w-]{43}$/.test(binding||''))fail(400,'Your sign-in expired. Please start again.');
 const [attempt]=await db.q('DELETE FROM oauth_attempts WHERE state_hash=$1 AND cookie_hash=$2 AND expires_at>now() RETURNING verifier,return_to,inviter_id',[hash(state),hash(binding)]);
 if(!attempt)fail(400,'Your sign-in expired. Please start again.');return attempt;
}
export async function xIdentity(code,verifier,fetcher=fetch){
 const response=await fetcher('https://api.x.com/2/oauth2/token',{
  method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Authorization:'Basic '+Buffer.from(process.env.X_CLIENT_ID+':'+process.env.X_CLIENT_SECRET).toString('base64')},
  body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:appURL()+'/api/auth/callback/x',code_verifier:verifier}),signal:AbortSignal.timeout(10000)
 });
 if(!response.ok)fail(502,'X could not complete sign-in. Please try again.');
 const access=await response.json();if(typeof access.access_token!=='string')fail(502,'X did not return a sign-in token.');
 const profile=await fetcher('https://api.x.com/2/users/me?user.fields=profile_image_url,description',{
  headers:{Authorization:'Bearer '+access.access_token},signal:AbortSignal.timeout(10000)
 });
 if(!profile.ok)fail(502,'X could not load your profile. Please try again later.');
 const {data}=await profile.json();
 if(!data||!/^\d{1,20}$/.test(data.id)||typeof data.username!=='string')fail(502,'X returned an incomplete profile.');
 let avatar='';try{const u=new URL(data.profile_image_url);if(u.protocol==='https:'&&u.hostname==='pbs.twimg.com')avatar=u.href;}catch{}
 return {id:data.id,username:data.username.slice(0,32),name:String(data.name||data.username).slice(0,32),avatar};
}
export async function login(db,identity,inviterId=null){
 const [existing]=await db.q('SELECT id FROM users WHERE x_id=$1',[identity.id]);
 const [user]=await db.q(`INSERT INTO users(x_id,x_username,handle,name,avatar_url,last_login_at,login_count) VALUES($1,$2,$3,$4,$5,clock_timestamp(),1)
 ON CONFLICT(x_id) DO UPDATE SET x_username=EXCLUDED.x_username,avatar_url=EXCLUDED.avatar_url,last_login_at=clock_timestamp(),login_count=users.login_count+1 RETURNING *`,[identity.id,identity.username,'x_'+identity.id,identity.name,identity.avatar]);
 if(!existing&&user.login_count===1&&inviterId&&inviterId!==user.id)await db.q('INSERT INTO referrals(invitee_id,inviter_id) SELECT $1,id FROM users WHERE id=$2 AND NOT is_system AND x_id IS NOT NULL ON CONFLICT(invitee_id) DO NOTHING',[user.id,inviterId]);
 const sessionToken=token();
 await db.q("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 days')",[hash(sessionToken),user.id]);
 return {user,sessionToken};
}
