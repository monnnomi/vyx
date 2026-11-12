import {memberReputation} from './reputation.js';
import {fail,text,uuid} from './http.js';
import {publicUser,calendar} from './config.js';
import {feed} from './service.js';
import {listRooms} from './rooms.js';
import {requireAdmin} from './admin.js';
import {voidContribution} from './farming.js';

// All arguments here are internal SQL expressions, never request strings.
export function hiddenBy(viewer,target){return `EXISTS(SELECT 1 FROM member_controls mc WHERE (mc.user_id=${viewer} AND mc.target_id=${target} AND (mc.blocked OR mc.muted)) OR (mc.user_id=${target} AND mc.target_id=${viewer} AND mc.blocked))`;}
export async function assertInteraction(db,viewer,target){
 const [blocked]=await db.q('SELECT 1 FROM member_controls WHERE blocked AND ((user_id=$1 AND target_id=$2) OR (user_id=$2 AND target_id=$1))',[viewer,target]);
 if(blocked)fail(403,'This interaction is unavailable while either account has blocked the other.');
}
export async function searchCommunity(db,user,query){
 const q=text(query,0,80),id=user?.id||null;
 const [people,roomResult,posts]=await Promise.all([
 db.q(`SELECT u.*,EXISTS(SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=u.id) AS following,
 EXISTS(SELECT 1 FROM follows WHERE follower_id=u.id AND following_id=$1) AS follows_you,
 (SELECT left(body,180) FROM posts WHERE user_id=u.id ORDER BY created_at DESC LIMIT 1) AS latest_post
 FROM users u WHERE NOT u.is_system AND NOT ${hiddenBy('$1','u.id')}
 AND ($2='' OR strpos(lower(u.name||' '||u.handle||' '||u.bio||' '||u.interests),lower($2))>0)
 ORDER BY CASE WHEN u.id=$1 THEN 1 ELSE 0 END,CASE WHEN u.bio<>'' THEN 0 ELSE 1 END,u.created_at DESC LIMIT 24`,[id,q]),
 listRooms(db,user,{search:q}),feed(db,user,{query:q})]);
 return {query:q,people:people.map(u=>({...publicUser(u),following:u.following,follows_you:u.follows_you,latest_post:u.latest_post})),rooms:roomResult.rooms.sort((a,b)=>Number(b.featured)-Number(a.featured)),posts,limit:24,scope:'Public profiles, open rooms and public posts. Private messages and room conversations are not searched.'};
}
export async function memberProfile(db,user,id){
 uuid(id);const [u]=await db.q(`SELECT u.*,
 EXISTS(SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=u.id) AS following,
 EXISTS(SELECT 1 FROM follows WHERE following_id=$1 AND follower_id=u.id) AS follows_you,
 (SELECT count(*)::int FROM follows WHERE following_id=u.id) AS followers,
 (SELECT count(*)::int FROM follows WHERE follower_id=u.id) AS following_count,
 (SELECT count(*)::int FROM posts WHERE user_id=u.id) AS post_count,
 COALESCE((SELECT sum(amount)::bigint FROM reward_ledger WHERE user_id=u.id AND season=$3),0) AS points
 FROM users u WHERE u.id=$2`,[user?.id||null,id,calendar().season]);
 if(!u)fail(404,'This member could not be found.');
 const reputation=await memberReputation(db,id);
 const controls=user?(await db.q('SELECT blocked,muted FROM member_controls WHERE user_id=$1 AND target_id=$2',[user.id,id]))[0]||{}:{};
 const [hidden]=await db.q(`SELECT ${hiddenBy('$1','$2::uuid')} AS hidden`,[user?.id||null,id]);
 const rooms=hidden.hidden?[]:await db.q(`SELECT r.id,r.name,r.description,r.language,r.topic,r.owner_id,u.name AS owner_name,
 (SELECT count(*)::int FROM room_members WHERE room_id=r.id) AS member_count,
 EXISTS(SELECT 1 FROM room_members WHERE room_id=r.id AND user_id=$1) AS joined
 FROM rooms r JOIN users u ON u.id=r.owner_id WHERE r.archived_at IS NULL AND r.owner_id=$2 ORDER BY r.created_at DESC LIMIT 12`,[user?.id||null,id]);
 return {person:{...publicUser(u),following:u.following,follows_you:u.follows_you,followers:u.followers,following_count:u.following_count,post_count:u.post_count,points:Number(u.points),reputation},controls,posts:hidden.hidden?[]:await feed(db,user,{author:id}),rooms,hidden:hidden.hidden};
}
export async function postDetail(db,user,id){
 uuid(id);const posts=await feed(db,user,{postId:id});if(!posts.length)fail(404,'This post is unavailable.');return {post:posts[0]};
}
export async function handleAvailability(db,user,handle){
 const value=text(handle,0,24).toLowerCase();
 const valid=/^[a-z0-9_][a-z0-9_.]{2,23}$/.test(value)&&!value.startsWith('vyx.')&&!/^x_\d+$/.test(value);
 const [taken]=valid?await db.q('SELECT 1 FROM users WHERE handle=$1 AND ($2::uuid IS NULL OR id<>$2)',[value,user?.id||null]):[];
 return {handle:value,available:valid&&!taken,valid};
}
export async function memberPreferences(db,user){
 const [prefs,controls,rooms,deletion]=await Promise.all([
 db.q('SELECT follows,comments,mentions,drops FROM notification_preferences WHERE user_id=$1',[user.id]),
 db.q('SELECT c.target_id,c.blocked,c.muted,u.name FROM member_controls c JOIN users u ON u.id=c.target_id WHERE c.user_id=$1 AND (c.blocked OR c.muted)',[user.id]),
 db.q('SELECT m.room_id,r.name FROM room_mutes m JOIN rooms r ON r.id=m.room_id WHERE m.user_id=$1',[user.id]),
 db.q('SELECT created_at,status FROM deletion_requests WHERE user_id=$1',[user.id])]);
 return {notifications:prefs[0]||{follows:true,comments:true,mentions:true,drops:true},controls,mutedRooms:rooms,deletion:deletion[0]||null};
}
async function reportTarget(db,user,kind,id){
 const queries={user:'SELECT id FROM users WHERE id=$1',post:'SELECT id FROM posts WHERE id=$1',comment:'SELECT id FROM comments WHERE id=$1',room:'SELECT id FROM rooms WHERE id=$1 AND archived_at IS NULL',
 'room-message':'SELECT m.id FROM room_messages m JOIN room_members rm ON rm.room_id=m.room_id WHERE m.id=$1 AND rm.user_id=$2 AND m.deleted_at IS NULL',
 message:'SELECT id FROM messages WHERE id=$1 AND (sender_id=$2 OR recipient_id=$2)'};
 if(!queries[kind])fail(400,'Choose a report type.');
 const rows=await db.q(queries[kind],['room-message','message'].includes(kind)?[id,user.id]:[id]);
 if(!rows.length)fail(404,'This item is unavailable.');
}
async function removePost(tx,id){
    await tx.q("UPDATE media_assets SET status='deleting',post_id=NULL,comment_id=NULL,expires_at=clock_timestamp() WHERE post_id=$1 OR comment_id IN (SELECT id FROM comments WHERE post_id=$1)",[id]);
    await tx.q('DELETE FROM comments WHERE post_id=$1',[id]);
    await tx.q('DELETE FROM reactions WHERE post_id=$1',[id]);
    await tx.q('DELETE FROM saved_posts WHERE post_id=$1',[id]);
    await tx.q('DELETE FROM posts WHERE id=$1',[id]);
}
export async function mutateSocial(tx,user,action,input){
 if(action==='post-edit'||action==='post-delete'){
  const id=uuid(input.id);
  const [post]=await tx.q('SELECT id FROM posts WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]);
  if(!post)fail(404,'Post not found.');
  if(action==='post-delete')await removePost(tx,id);
  else{
   const media=await tx.q('SELECT 1 FROM media_assets WHERE post_id=$1 LIMIT 1',[id]);
   await tx.q('UPDATE posts SET body=$2 WHERE id=$1',[id,text(input.body,media.length?0:20,1500)]);
  }
  return {ok:true};
 }
 if(action==='member-control'){
  const id=uuid(input.id);if(id===user.id)fail(400,'Choose another member.');
  const field=input.control;if(!['blocked','muted'].includes(field)||typeof input.enabled!=='boolean')fail(400,'Choose a control.');
  const [person]=await tx.q('SELECT id FROM users WHERE id=$1',[id]);if(!person)fail(404,'Member not found.');
  await tx.q(`INSERT INTO member_controls(user_id,target_id,${field}) VALUES($1,$2,$3) ON CONFLICT(user_id,target_id) DO UPDATE SET ${field}=EXCLUDED.${field}`,[user.id,id,input.enabled]);
  if(field==='blocked'&&input.enabled)await tx.q('DELETE FROM follows WHERE (follower_id=$1 AND following_id=$2) OR (follower_id=$2 AND following_id=$1)',[user.id,id]);
  return {ok:true};
 }
 if(action==='room-mute'){
  const id=uuid(input.id);if(typeof input.enabled!=='boolean')fail(400,'Choose a notification preference.');
  await reportTarget(tx,user,'room',id);
  if(input.enabled)await tx.q('INSERT INTO room_mutes(user_id,room_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[user.id,id]);
  else await tx.q('DELETE FROM room_mutes WHERE user_id=$1 AND room_id=$2',[user.id,id]);return {ok:true};
 }
 if(action==='notification-preferences'){
  const keys=['follows','comments','mentions','drops'];if(keys.some(k=>typeof input[k]!=='boolean'))fail(400,'Choose notification categories.');
  await tx.q('INSERT INTO notification_preferences(user_id,follows,comments,mentions,drops) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id) DO UPDATE SET follows=EXCLUDED.follows,comments=EXCLUDED.comments,mentions=EXCLUDED.mentions,drops=EXCLUDED.drops',[user.id,...keys.map(k=>input[k])]);return {ok:true};
 }
 if(action==='report'){
  const id=uuid(input.id),kind=input.kind,reason=text(input.reason,3,60),detail=text(input.detail??'',0,500);await reportTarget(tx,user,kind,id);
  const [count]=await tx.q("SELECT count(*)::int AS n FROM community_reports WHERE reporter_id=$1 AND created_at>now()-interval '1 day'",[user.id]);if(count.n>=20)fail(429,'You can submit up to 20 reports a day.');
  const [report]=await tx.q('INSERT INTO community_reports(reporter_id,kind,target_id,reason,detail) VALUES($1,$2,$3,$4,$5) ON CONFLICT(reporter_id,kind,target_id) DO UPDATE SET detail=community_reports.detail RETURNING id,status',[user.id,kind,id,reason,detail]);return report;
 }
 if(action==='deletion-request'){
  if(input.confirm!==true)fail(400,'Confirm the deletion request.');
  return (await tx.q("INSERT INTO deletion_requests(user_id) VALUES($1) ON CONFLICT(user_id) DO UPDATE SET status=CASE WHEN deletion_requests.status='cancelled' THEN 'requested' ELSE deletion_requests.status END,updated_at=now() RETURNING status,created_at",[user.id]))[0];
 }
 if(action==='deletion-cancel'){await tx.q("UPDATE deletion_requests SET status='cancelled',updated_at=now() WHERE user_id=$1 AND status='requested'",[user.id]);return {ok:true};}
}
export async function moderationQueue(db,user){
 requireAdmin(user);
 const reports=await db.q(`SELECT r.*,u.name AS reporter,
 CASE r.kind WHEN 'post' THEN (SELECT body FROM posts WHERE id=r.target_id)
 WHEN 'comment' THEN (SELECT body FROM comments WHERE id=r.target_id)
 WHEN 'room-message' THEN (SELECT body FROM room_messages WHERE id=r.target_id)
 WHEN 'message' THEN (SELECT body FROM messages WHERE id=r.target_id)
 WHEN 'room' THEN (SELECT name||': '||description FROM rooms WHERE id=r.target_id)
 WHEN 'user' THEN (SELECT name||': '||bio FROM users WHERE id=r.target_id) END AS content
 FROM community_reports r JOIN users u ON u.id=r.reporter_id ORDER BY CASE WHEN r.status='open' THEN 0 ELSE 1 END,r.created_at DESC LIMIT 100`);
 const deletions=await db.q('SELECT d.*,u.name,u.handle FROM deletion_requests d JOIN users u ON u.id=d.user_id ORDER BY d.created_at DESC LIMIT 100');
 const metrics=await db.q("SELECT event,outcome,count(*)::int AS n FROM product_events WHERE created_at>now()-interval '14 days' GROUP BY event,outcome ORDER BY event");
 const [conversations]=await db.q(`SELECT count(DISTINCT a.sender_id)::int AS returning_participants FROM room_messages a
 JOIN room_messages b ON b.reply_to=a.id AND b.sender_id<>a.sender_id AND b.deleted_at IS NULL
 JOIN room_messages c ON c.reply_to=b.id AND c.sender_id=a.sender_id AND c.deleted_at IS NULL
 WHERE a.created_at>now()-interval '7 days' AND a.deleted_at IS NULL`);
 const featured=await db.q('SELECT id,name,featured FROM rooms WHERE archived_at IS NULL ORDER BY featured DESC,created_at DESC LIMIT 100');
 return {reports,deletions,metrics,conversations,rooms:featured};
}
export async function moderate(db,user,input){
 requireAdmin(user);
 return db.tx(async tx=>{
  if(input.action==='feature-room'){await tx.q('UPDATE rooms SET featured=$2 WHERE id=$1',[uuid(input.id),input.enabled===true]);return {ok:true};}
  if(input.action==='review-deletion'){
   if(!['reviewing','completed'].includes(input.status))fail(400,'Choose a request status.');
   if(input.status==='completed')fail(400,'Complete data removal before marking the request completed. This dashboard only starts review.');
   await tx.q('UPDATE deletion_requests SET status=$2,updated_at=now() WHERE user_id=$1',[uuid(input.id),input.status]);return {ok:true};
  }
  const [r]=await tx.q('SELECT * FROM community_reports WHERE id=$1 FOR UPDATE',[uuid(input.id)]);if(!r)fail(404,'Report not found.');
  if(!['resolved','dismissed'].includes(input.status))fail(400,'Choose a review outcome.');
  const resolution=text(input.resolution,3,500);
  if(input.remove===true){
   if(r.kind==='post'){
    // Delete the approved post atomically with its dependent records. Media become
    // unreadable immediately; the existing cleanup job removes their stored bytes.
    await tx.q('SELECT id FROM posts WHERE id=$1 FOR UPDATE',[r.target_id]);
    await removePost(tx,r.target_id);
   }
   else if(r.kind==='comment')await tx.q('DELETE FROM comments WHERE id=$1',[r.target_id]);
   else if(r.kind==='room-message'){await tx.q('UPDATE room_messages SET deleted_at=now() WHERE id=$1',[r.target_id]);await voidContribution(tx,r.target_id);}
   else if(r.kind==='room')await tx.q('UPDATE rooms SET archived_at=now() WHERE id=$1',[r.target_id]);
   else fail(400,'This type requires manual review; no account or private conversation is deleted here.');
  }
  await tx.q('UPDATE community_reports SET status=$2,resolution=$3,reviewed_by=$4,reviewed_at=now() WHERE id=$1',[r.id,input.status,resolution,user.id]);return {ok:true};
 });
}
const events=new Set(['search','search_result','profile_view','follow','post_started','post_published','comment_sent','room_open','room_join','message_sent','signin_started','signin_returned','onboarding_saved','onboarding_skipped','getting_started','visit_started','visit_from_x','signed_in_visit','first_room_join','first_room_message','first_vp_contribution','return_next_day','first_reward_seen']);
export async function recordProductEvent(db,input){
 if(input.consent!==true||!events.has(input.event))fail(400,'Invalid analytics event.');
 const section=['rooms','feed','explore','profile','messages','other'].includes(input.section)?input.section:'other';
 const outcome=['success','empty','error','cancelled','started'].includes(input.outcome)?input.outcome:'success';
 await db.q('INSERT INTO product_events(event,section,outcome) VALUES($1,$2,$3)',[input.event,section,outcome]);
 await db.q("DELETE FROM product_events WHERE created_at<now()-interval '30 days'");return {ok:true};
}
