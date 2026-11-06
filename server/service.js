import {reactionProjection,reactToMessage} from './message-reactions.js';
import {mutateSocial,assertInteraction,hiddenBy} from './social.js';
import {randomInt} from 'node:crypto';
import {calendar,tiers,publicUser} from './config.js';
import {fail,text,uuid} from './http.js';
import {mediaProjection,mediaIds,attachMedia,checkMediaRetry,mediaAvailable,mediaLimits} from './media.js';
import {isAdmin} from './admin.js';
import {halloweenState,claimHalloween} from './events.js';
import {mutateRoom} from './rooms.js';
import {settleDueWindows,reserveLegacyReward,farmingOverview} from './farming.js';

export async function questState(){return [];}
export async function members(db,viewer,season) {
 const rows=await db.q(`SELECT u.*, COALESCE(p.points,0)::int AS points,
 EXISTS(SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=u.id) AS following,
 EXISTS(SELECT 1 FROM follows WHERE following_id=$1 AND follower_id=u.id) AS follows_you
 FROM users u LEFT JOIN (SELECT user_id,sum(amount) AS points FROM reward_ledger WHERE season=$2 GROUP BY user_id) p ON p.user_id=u.id
 WHERE NOT u.is_system AND NOT ${hiddenBy('$1','u.id')} ORDER BY points DESC,u.created_at ASC LIMIT 200`,[viewer?.id||null,season]);
 return rows.map(u=>({...publicUser(u),points:u.points,following:u.following,follows_you:u.follows_you}));
}
export async function feed(db,viewer,{filter='all',author=null,cursor=null,query='',postId=null}={}) {
 if(!['all','following','saved'].includes(filter))fail(400,'Choose a feed filter.');
 if(cursor&&(typeof cursor!=='string'||cursor.length>40||Number.isNaN(Date.parse(cursor))))fail(400,'Invalid page cursor.');
 const rows=await db.q(`SELECT p.*,u.name,u.handle,u.avatar_url,u.is_system,${mediaProjection('p','post_id')},
 (SELECT count(*)::int FROM reactions WHERE post_id=p.id) AS likes,
 (SELECT count(*)::int FROM comments WHERE post_id=p.id) AS comments,
 EXISTS(SELECT 1 FROM reactions WHERE post_id=p.id AND user_id=$1) AS liked,
 EXISTS(SELECT 1 FROM saved_posts WHERE post_id=p.id AND user_id=$1) AS saved
 FROM posts p JOIN users u ON u.id=p.user_id
 WHERE ($2::uuid IS NULL OR p.user_id=$2)
 AND ($3<>'following' OR EXISTS(SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=p.user_id))
 AND ($3<>'saved' OR EXISTS(SELECT 1 FROM saved_posts WHERE user_id=$1 AND post_id=p.id))
 AND NOT ${hiddenBy('$1','p.user_id')}
 AND ($4::timestamptz IS NULL OR p.created_at<$4)
 AND ($5='' OR strpos(lower(p.body),lower($5))>0) AND ($6::uuid IS NULL OR p.id=$6)
 ORDER BY p.created_at DESC LIMIT 30`,[viewer?.id||null,author,filter,cursor,query,postId]);
 return rows.map(p=>({id:p.id,user_id:p.user_id,body:p.body,media:p.media,created_at:p.created_at,likes:p.likes,comments:p.comments,liked:p.liked,saved:p.saved,author:{id:p.user_id,name:p.name,handle:p.handle,avatar_url:p.avatar_url,is_system:p.is_system}}));
}
export async function state(db,user,now=null) {
 await settleDueWindows(db);
 if(!now)now=new Date((await db.q('SELECT clock_timestamp() AS now'))[0].now);
 const c=calendar(now),[people,posts,tasks,event]=await Promise.all([members(db,user,c.season),feed(db,user),questState(db,user,now),halloweenState(db,user)]);
 let account=null;
 if(user){
  const [balance,inventory,history,counts]=await Promise.all([
   db.q('SELECT COALESCE(sum(amount) FILTER(WHERE season=$2),0)::int AS points,COALESCE(sum(amount),0)::int AS all_points FROM reward_ledger WHERE user_id=$1',[user.id,c.season]),
   db.q('SELECT tier,count(*)::int AS n FROM chests WHERE user_id=$1 AND opened_at IS NULL AND campaign_id IS NULL GROUP BY tier',[user.id]),
   db.q('SELECT l.amount,l.season,l.created_at,c.tier,c.campaign_id,l.source,r.name AS room_name FROM reward_ledger l LEFT JOIN chests c ON c.id=l.chest_id LEFT JOIN rooms r ON r.id=l.room_id WHERE l.user_id=$1 ORDER BY l.created_at DESC LIMIT 30',[user.id]),
   db.q('SELECT (SELECT count(*)::int FROM posts WHERE user_id=$1) AS posts,(SELECT count(*)::int FROM follows WHERE follower_id=$1) AS following,(SELECT count(*)::int FROM follows WHERE following_id=$1) AS followers',[user.id])
  ]);
  account={...publicUser(user),is_admin:isAdmin(user),...balance[0],inventory:[0,1,2,3].map(t=>inventory.find(i=>i.tier===t)?.n||0),history,...counts[0]};
 }
 return {calendar:c,mediaReady:mediaAvailable(),mediaLimits,user:account,members:people,posts,quests:tasks,event,farming:await farmingOverview(db,user),authReady:Boolean(process.env.X_CLIENT_ID&&process.env.X_CLIENT_SECRET&&process.env.VYX_APP_SECRET)};
}
export async function comments(db,post,viewer=null){
 uuid(post);return db.q(`SELECT c.id,c.body,c.created_at,u.id AS user_id,u.name,u.handle,${mediaProjection('c','comment_id')} FROM comments c JOIN users u ON u.id=c.user_id WHERE c.post_id=$1 AND NOT ${hiddenBy('$2','c.user_id')} ORDER BY c.created_at ASC LIMIT 100`,[post,viewer?.id||null]);
}
export async function conversations(db,user) {
 return db.q(`SELECT u.id,u.name,u.handle,u.avatar_url,CASE WHEN m.body='' THEN 'Attachment' ELSE m.body END AS body,m.created_at,
 EXISTS(SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=u.id) AS following,
 EXISTS(SELECT 1 FROM follows WHERE following_id=$1 AND follower_id=u.id) AS follows_you FROM users u
 JOIN LATERAL (SELECT body,created_at FROM messages WHERE (sender_id=$1 AND recipient_id=u.id) OR (recipient_id=$1 AND sender_id=u.id) ORDER BY created_at DESC LIMIT 1) m ON true
 WHERE u.id<>$1 AND NOT ${hiddenBy('$1','u.id')} ORDER BY m.created_at DESC LIMIT 50`,[user.id]);
}
export async function messages(db,user,peer) {
 uuid(peer);await assertInteraction(db,user.id,peer);
 return db.q(`SELECT m.id,m.sender_id,m.recipient_id,m.body,m.created_at,${reactionProjection('message_id','$1')},${mediaProjection('m','message_id')} FROM (SELECT * FROM messages WHERE (sender_id=$1 AND recipient_id=$2) OR (sender_id=$2 AND recipient_id=$1) ORDER BY created_at DESC LIMIT 100) m ORDER BY created_at ASC`,[user.id,peer]);
}
async function activity(db,user,c,kind,target){
 await db.q('INSERT INTO activity_events(user_id,season,day,kind,target) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[user.id,c.season,c.day,kind,target]);
}
export async function mutate(db,user,action,input,now=new Date()) {
 if(action==='claim')fail(410,'Quests are coming soon.');
 return db.tx(async tx=>{
  const [fresh]=await tx.q('SELECT * FROM users WHERE id=$1 AND NOT is_system FOR UPDATE',[user.id]);
  if(!fresh)fail(401,'Please sign in again.');user=fresh;
  if(['room-create','room-join','room-leave','room-close','room-send','room-delete-message','room-read','room-pin','room-edit'].includes(action))return mutateRoom(tx,user,action,input);
  if(action==='message-react')return reactToMessage(tx,user,input);
  const social=await mutateSocial(tx,user,action,input);if(social!==undefined)return social;
  const c=calendar(now);
  if(action==='mint-event'||action==='claim-event')return claimHalloween(tx,user);
  if(action==='open-event')fail(410,'The Halloween chest is a collectible and does not award points.');
  if(action==='profile'){
   const name=text(input.name,2,32),bio=text(input.bio??'',0,180),handle=text(input.handle,3,24).toLowerCase();
   if(!/^[a-z0-9_][a-z0-9_.]{2,23}$/.test(handle)||handle.startsWith('vyx.')||(/^x_\d+$/.test(handle)&&handle!==user.handle))fail(400,'Choose a username with 3–24 letters, numbers, dots or underscores.');
   const [taken]=await tx.q('SELECT id FROM users WHERE handle=$1 AND id<>$2',[handle,user.id]);if(taken)fail(409,'This username is already taken.');
   await tx.q('UPDATE users SET name=$2,bio=$3,handle=$4,profile_completed=true,interests=$5 WHERE id=$1',[user.id,name,bio,handle,text(input.interests??user.interests??'',0,120)]);return {ok:true};
  }
  if(action==='post'){
   const ids=mediaIds(input.mediaIds),content=text(input.body??'',ids.length?0:20,1500),requestId=input.requestId==null?null:uuid(input.requestId);
   if(requestId){const [old]=await tx.q('SELECT id,body FROM posts WHERE user_id=$1 AND request_id=$2',[user.id,requestId]);if(old){if(old.body!==content)fail(409,'Please start a new post request.');await checkMediaRetry(tx,'post',old.id,ids);return {id:old.id};}}
   const [recent]=await tx.q("SELECT count(*)::int AS n FROM posts WHERE user_id=$1 AND created_at>now()-interval '1 hour'",[user.id]);if(recent.n>=10)fail(429,'You can share up to 10 stories per hour.');
   const [post]=await tx.q('INSERT INTO posts(user_id,body,request_id) VALUES($1,$2,$3) RETURNING id',[user.id,content,requestId]);
   await attachMedia(tx,user,'post',null,post.id,ids);
   await activity(tx,user,c,'publish',post.id);if(/#vyx\b/i.test(content))await activity(tx,user,c,'seasonal',post.id);
   return post;
  }
  if(action==='react'||action==='save'||action==='comment'){
   const id=uuid(input.id),[post]=await tx.q('SELECT p.user_id,u.is_system FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=$1',[id]);if(!post)fail(404,'This story could not be found.');await assertInteraction(tx,user.id,post.user_id);
   if(action==='comment'){
    const ids=mediaIds(input.mediaIds),content=text(input.body??'',ids.length?0:1,500),requestId=input.requestId==null?null:uuid(input.requestId);
    if(requestId){const [old]=await tx.q('SELECT id,post_id,body FROM comments WHERE user_id=$1 AND request_id=$2',[user.id,requestId]);if(old){if(old.post_id!==id||old.body!==content)fail(409,'Please start a new comment request.');await checkMediaRetry(tx,'comment',old.id,ids);return {ok:true,id:old.id};}}
    const [comment]=await tx.q('INSERT INTO comments(user_id,post_id,body,request_id) VALUES($1,$2,$3,$4) RETURNING id',[user.id,id,content,requestId]);
    await attachMedia(tx,user,'comment',id,comment.id,ids);return {ok:true,id:comment.id};
   }
   // Fixed query strings keep table names and all user input out of SQL source.
   if(action==='save'){
    const existing=await tx.q('DELETE FROM saved_posts WHERE user_id=$1 AND post_id=$2 RETURNING post_id',[user.id,id]);
    if(!existing.length)await tx.q('INSERT INTO saved_posts(user_id,post_id) VALUES($1,$2)',[user.id,id]);
    return {saved:!existing.length};
   }
   const existing=await tx.q('DELETE FROM reactions WHERE user_id=$1 AND post_id=$2 RETURNING post_id',[user.id,id]);
   if(!existing.length){
    await tx.q('INSERT INTO reactions(user_id,post_id) VALUES($1,$2)',[user.id,id]);
    if(post.user_id!==user.id&&!post.is_system)await activity(tx,user,c,'react',id);
   }return {liked:!existing.length};
  }
  if(action==='follow'){
   const id=uuid(input.id);await assertInteraction(tx,user.id,id);if(id===user.id)fail(400,'Choose another member.');
   const [person]=await tx.q('SELECT id FROM users WHERE id=$1 AND NOT is_system',[id]);if(!person)fail(404,'Member not found.');
   const existing=await tx.q('DELETE FROM follows WHERE follower_id=$1 AND following_id=$2 RETURNING following_id',[user.id,id]);
   if(!existing.length)await tx.q('INSERT INTO follows(follower_id,following_id) VALUES($1,$2)',[user.id,id]);return {following:!existing.length};
  }
  if(action==='open'){
   const requestId=uuid(input.requestId);
   const [receipt]=await tx.q('SELECT r.amount,c.tier,c.season,c.campaign_id FROM open_receipts r JOIN chests c ON c.id=r.chest_id WHERE r.user_id=$1 AND r.request_id=$2',[user.id,requestId]);if(receipt)return receipt;
   const campaign=null;
   const tier=input.tier;if(!Number.isInteger(tier)||tier<0||tier>3)fail(400,'Choose a chest.');
   const [chest]=await tx.q('SELECT * FROM chests WHERE user_id=$1 AND tier=$2 AND opened_at IS NULL AND (($3::text IS NULL AND campaign_id IS NULL) OR campaign_id=$3) ORDER BY created_at ASC LIMIT 1 FOR UPDATE',[user.id,tier,campaign]);if(!chest)fail(409,campaign?'Claim your Halloween chest first.':'Earn a chest through quests first.');
   const t=tiers[tier],amount=randomInt(t.min,t.max+1);
   await reserveLegacyReward(tx,chest.season,amount);
   await tx.q('UPDATE chests SET opened_at=now() WHERE id=$1',[chest.id]);
   await tx.q('INSERT INTO point_ledger(user_id,season,chest_id,amount) VALUES($1,$2,$3,$4)',[user.id,chest.season,chest.id,amount]);
   await tx.q('INSERT INTO open_receipts(user_id,request_id,chest_id,amount) VALUES($1,$2,$3,$4)',[user.id,requestId,chest.id,amount]);return {tier,amount,season:chest.season,campaign_id:chest.campaign_id};
  }
  if(action==='message'){
   const peer=uuid(input.id),requestId=uuid(input.requestId),ids=mediaIds(input.mediaIds),content=text(input.body??'',ids.length?0:1,2000);
   const [old]=await tx.q('SELECT id,recipient_id,body FROM messages WHERE sender_id=$1 AND request_id=$2',[user.id,requestId]);
   if(old){if(old.recipient_id!==peer||old.body!==content)fail(409,'Please start a new message request.');await checkMediaRetry(tx,'message',old.id,ids);return {id:old.id};}
   await assertInteraction(tx,user.id,peer);
   const [mutual]=await tx.q('SELECT 1 AS ok FROM follows a JOIN follows b ON a.follower_id=b.following_id AND a.following_id=b.follower_id WHERE a.follower_id=$1 AND a.following_id=$2',[user.id,peer]);
   if(!mutual)fail(403,'Direct messages are available when you follow each other.');
   const [m]=await tx.q('INSERT INTO messages(sender_id,recipient_id,body,request_id) VALUES($1,$2,$3,$4) ON CONFLICT(sender_id,request_id) DO UPDATE SET request_id=EXCLUDED.request_id RETURNING id',[user.id,peer,content,requestId]);await attachMedia(tx,user,'message',peer,m.id,ids);return m;
  }
  fail(404,'Action not found.');
 });
}
