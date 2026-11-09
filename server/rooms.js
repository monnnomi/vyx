import {reactionProjection} from './message-reactions.js';
import {messageViewProjection} from './message-views.js';
import {hiddenBy} from './social.js';
import {fail,text,uuid} from './http.js';
import {mediaProjection,mediaIds,attachMedia,checkMediaRetry} from './media.js';
import {recordContribution,voidContribution} from './farming.js';
import {roomActivitySQL} from './room-activity.js';

const pageNumber=value=>{
 if(value==null)return 0;
 if(!/^\d{1,3}$/.test(String(value)))fail(400,'Invalid page.');
 return Number(value);
};
const requireX=user=>{if(!user?.x_id||user.is_system)fail(401,'Sign in with X to use rooms.');};
const roomColumns=`r.id,r.name,r.description,r.language,r.topic,r.featured,r.created_at,r.owner_id,
 u.name AS owner_name,u.handle AS owner_handle,
 (SELECT count(*)::int FROM room_members WHERE room_id=r.id) AS member_count,
 own.user_id IS NOT NULL AS joined,
 CASE WHEN own.user_id IS NOT NULL THEN (SELECT count(*)::int FROM room_messages m
  WHERE m.room_id=r.id AND m.deleted_at IS NULL AND m.sender_id<>$1 AND m.seq>own.last_read_seq AND NOT ${hiddenBy('$1','m.sender_id')}) ELSE 0 END AS unread_count,
 CASE WHEN own.user_id IS NOT NULL THEN (SELECT count(*)::int FROM room_mentions n JOIN room_messages m ON m.id=n.message_id
  WHERE n.user_id=$1 AND m.room_id=r.id AND m.deleted_at IS NULL AND m.seq>own.last_read_seq AND NOT ${hiddenBy('$1','m.sender_id')}) ELSE 0 END AS mention_count,
 (SELECT jsonb_build_object('id',m.id,'seq',m.seq::text,'body',CASE WHEN m.body='' THEN 'Attachment' ELSE left(m.body,180) END,'created_at',m.created_at,'sender_id',m.sender_id,'name',sender.name)
  FROM room_messages m JOIN users sender ON sender.id=m.sender_id
  WHERE own.user_id IS NOT NULL AND m.room_id=r.id AND m.deleted_at IS NULL AND NOT ${hiddenBy('$1','m.sender_id')} ORDER BY m.seq DESC LIMIT 1) AS last_message`;
const roomJoins=`JOIN users u ON u.id=r.owner_id LEFT JOIN room_members own ON own.room_id=r.id AND own.user_id=$1`;
const messageColumns=`${reactionProjection('room_message_id','$3')},${messageViewProjection('room_message_id','$3')},m.id,m.seq::text,m.body,m.created_at,m.sender_id,u.name,u.handle,u.avatar_url,parent.sender_id AS reply_sender_id,${mediaProjection('m','room_message_id')},
 CASE WHEN m.reply_to IS NOT NULL THEN jsonb_build_object('id',m.reply_to,'removed',parent.id IS NULL,
  'name',pu.name,'body',CASE WHEN parent.body='' THEN 'Attachment' ELSE left(parent.body,180) END) ELSE NULL END AS reply,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',mu.id,'name',mu.name,'handle',mu.handle))
  FROM room_mentions n JOIN users mu ON mu.id=n.user_id WHERE n.message_id=m.id),'[]'::jsonb) AS mentions`;
const messageJoins=`JOIN users u ON u.id=m.sender_id
 LEFT JOIN room_messages parent ON parent.id=m.reply_to AND parent.room_id=m.room_id AND parent.deleted_at IS NULL
 LEFT JOIN users pu ON pu.id=parent.sender_id`;
function cursor(value){
 if(!/^[1-9]\d{0,18}$/.test(String(value))||BigInt(value)>9223372036854775807n)fail(400,'Invalid message cursor.');
 return String(value);
}
function handlesIn(body){
 return [...new Set([...body.matchAll(/(?:^|[^\p{L}\p{N}_@.])@([a-zA-Z0-9_][a-zA-Z0-9_.]{2,23})(?![a-zA-Z0-9_.])/gu)]
  .flatMap(m=>[m[1].toLowerCase(),m[1].replace(/\.+$/,'').toLowerCase()]))].slice(0,20);
}
export async function listRooms(db,user,{filter='all',search='',page=0}={}){
 if(!['all','mine'].includes(filter))fail(400,'Choose a room filter.');
 if(filter==='mine')requireX(user);
 search=text(search,0,80);page=pageNumber(page);
 const rows=await db.q(`WITH ${roomActivitySQL}
 SELECT ${roomColumns} FROM rooms r ${roomJoins}
 LEFT JOIN room_activity activity ON activity.room_id=r.id
 WHERE r.archived_at IS NULL AND ($2='all' OR EXISTS(SELECT 1 FROM room_members WHERE room_id=r.id AND user_id=$1))
 AND ($3='' OR strpos(lower(r.name||' '||r.description||' '||r.topic||' '||r.language),lower($3))>0)
 ORDER BY COALESCE(activity.score,0) DESC,r.id ASC LIMIT 25 OFFSET $4`,[user?.id||null,filter,search,page*24]);
 return {rooms:rows.slice(0,24),nextPage:rows.length>24?page+1:null};
}
export async function roomSummary(db,user,id){
 uuid(id);
 const [room]=await db.q(`SELECT ${roomColumns} FROM rooms r ${roomJoins} WHERE r.id=$2 AND r.archived_at IS NULL`,[user?.id||null,id]);
 if(!room)fail(404,'This room is no longer available.');
 return {room};
}
async function getRoom(db,user,id,lock=false){
 requireX(user);uuid(id);
 const [room]=await db.q(`SELECT * FROM rooms WHERE id=$1 AND archived_at IS NULL${lock==='share'?' FOR SHARE':lock?' FOR UPDATE':''}`,[id]);
 if(!room)fail(404,'This room is no longer available.');
 return room;
}
async function requireMember(db,user,id){
 const [member]=await db.q('SELECT 1 FROM room_members WHERE room_id=$1 AND user_id=$2',[id,user.id]);
 if(!member)fail(403,'Join this room to read and send messages.');
}
export async function roomThread(db,user,id,before=null){
 // One snapshot prevents a concurrent leave/close from exposing a partial thread.
 return db.tx(async tx=>{
  const room=await getRoom(tx,user,id,'share');
  await requireMember(tx,user,id);
  if(before!=null)before=cursor(before);
  const rows=await tx.q(`SELECT ${messageColumns}
   FROM room_messages m ${messageJoins}
   WHERE m.room_id=$1 AND m.deleted_at IS NULL AND ($2::bigint IS NULL OR m.seq<$2) AND NOT ${hiddenBy('$3','m.sender_id')}
   ORDER BY m.seq DESC LIMIT 61`,[id,before,user.id]);
  const [count]=await tx.q('SELECT count(*)::int AS n FROM room_members WHERE room_id=$1',[id]);
  const [read]=await tx.q('SELECT last_read_seq::text FROM room_members WHERE room_id=$1 AND user_id=$2',[id,user.id]);
  const [pinned]=room.pinned_message_id?await tx.q(`SELECT ${messageColumns} FROM room_messages m ${messageJoins} WHERE m.id=$1 AND m.room_id=$2 AND m.deleted_at IS NULL AND NOT ${hiddenBy('$3','m.sender_id')}`,[room.pinned_message_id,id,user.id]):[];
  return {lastReadSeq:read.last_read_seq,pinned:pinned?(await maskQuotes(tx,user,[pinned]))[0]:null,room:{id:room.id,name:room.name,description:room.description,language:room.language,topic:room.topic,owner_id:room.owner_id,member_count:count.n,joined:true},
   messages:await maskQuotes(tx,user,rows.slice(0,60).reverse()),nextBefore:rows.length>60?rows[59].seq:null};
 });
}
export async function roomMessage(db,user,id,messageId){
 return db.tx(async tx=>{
  await getRoom(tx,user,id,'share');await requireMember(tx,user,id);uuid(messageId);
  const [message]=await tx.q(`SELECT ${messageColumns} FROM room_messages m ${messageJoins}
   WHERE m.id=$1 AND m.room_id=$2 AND m.deleted_at IS NULL AND NOT ${hiddenBy('$3','m.sender_id')}`,[messageId,id,user.id]);
  if(!message)fail(404,'This message is no longer available.');return {message:(await maskQuotes(tx,user,[message]))[0]};
 });
}
export async function roomMentionCandidates(db,user,id,search=''){
 return db.tx(async tx=>{
  await getRoom(tx,user,id,'share');await requireMember(tx,user,id);search=text(search,0,24).toLowerCase();
  const members=await tx.q(`SELECT u.id,u.name,u.handle FROM room_members m JOIN users u ON u.id=m.user_id
   WHERE m.room_id=$1 AND u.id<>$2 AND NOT ${hiddenBy('$2','u.id')} AND ($3='' OR strpos(lower(u.handle),$3)=1)
   ORDER BY u.handle LIMIT 6`,[id,user.id,search]);return {members};
 });
}
export async function roomMembers(db,user,id,page=0){
 return db.tx(async tx=>{
  await getRoom(tx,user,id,'share');await requireMember(tx,user,id);page=pageNumber(page);
  const rows=await tx.q(`SELECT u.id,u.name,u.handle,u.avatar_url,m.joined_at FROM room_members m
   JOIN users u ON u.id=m.user_id WHERE m.room_id=$1 ORDER BY m.joined_at,u.id LIMIT 51 OFFSET $2`,[id,page*50]);
  return {members:rows.slice(0,50),nextPage:rows.length>50?page+1:null};
 });
}
export async function mutateRoom(tx,user,action,input){
 requireX(user);
 if(action==='room-create'){
  const name=text(input.name,3,48),description=text(input.description??'',0,240),requestId=uuid(input.requestId);
  const [existing]=await tx.q('SELECT id,name,description,archived_at FROM rooms WHERE owner_id=$1 AND request_id=$2',[user.id,requestId]);
  if(existing){if(existing.name!==name||existing.description!==description||existing.archived_at)fail(409,'Please start a new room request.');return {id:existing.id};}
  const [recent]=await tx.q("SELECT count(*)::int AS n FROM rooms WHERE owner_id=$1 AND created_at>now()-interval '24 hours'",[user.id]);
  if(recent.n>=5)fail(429,'You can create up to 5 rooms in 24 hours.');
  await membershipLimit(tx,user);
  const [room]=await tx.q('INSERT INTO rooms(owner_id,name,description,request_id) VALUES($1,$2,$3,$4) RETURNING id',[user.id,name,description,requestId]);
  await tx.q('UPDATE rooms SET language=$2,topic=$3 WHERE id=$1',[room.id,text(input.language??'',0,40),text(input.topic??'',0,120)]);await tx.q('INSERT INTO room_members(room_id,user_id) VALUES($1,$2)',[room.id,user.id]);return room;
 }
 const id=uuid(input.id),room=await getRoom(tx,user,id,true);
 const [member]=await tx.q('SELECT 1 FROM room_members WHERE room_id=$1 AND user_id=$2',[id,user.id]);
 if(action==='room-join'){
  if(member)return {id,joined:true};
  await membershipLimit(tx,user);
  const [count]=await tx.q('SELECT count(*)::int AS n FROM room_members WHERE room_id=$1',[id]);
  if(count.n>=500)fail(409,'This room has reached 500 members.');
  await tx.q('INSERT INTO room_members(room_id,user_id,last_read_seq) SELECT $1,$2,COALESCE(max(seq),0) FROM room_messages WHERE room_id=$1 ON CONFLICT DO NOTHING',[id,user.id]);return {id,joined:true};
 }
 if(!member)fail(403,'Join this room to read and send messages.');
 if(action==='room-edit'){if(room.owner_id!==user.id)fail(403,'Only the host can edit this room.');await tx.q('UPDATE rooms SET name=$2,description=$3,language=$4,topic=$5 WHERE id=$1',[id,text(input.name,3,48),text(input.description??'',0,240),text(input.language??'',0,40),text(input.topic??'',0,120)]);return {ok:true};}
 if(action==='room-leave'){
  if(room.owner_id===user.id)fail(409,'As the owner, you can close this room instead of leaving.');
  await tx.q('DELETE FROM room_members WHERE room_id=$1 AND user_id=$2',[id,user.id]);return {id,joined:false};
 }
 if(action==='room-close'){
  if(room.owner_id!==user.id)fail(403,'Only the owner can close this room.');
  await tx.q('UPDATE rooms SET archived_at=clock_timestamp() WHERE id=$1',[id]);return {id,closed:true};
 }
 if(action==='room-read'){
  const through=cursor(input.through);
  const [message]=await tx.q('SELECT 1 FROM room_messages WHERE room_id=$1 AND seq=$2',[id,through]);
  if(!message)fail(400,'Choose a message in this room.');
  const [read]=await tx.q(`UPDATE room_members SET last_read_seq=GREATEST(last_read_seq,$3::bigint)
   WHERE room_id=$1 AND user_id=$2 RETURNING last_read_seq::text`,[id,user.id,through]);
  return {...read,...await roomSummary(tx,user,id)};
 }
 if(action==='room-pin'){
  if(room.owner_id!==user.id)fail(403,'Only the owner can pin a message.');
  const messageId=input.messageId==null?null:uuid(input.messageId);
  if(messageId){const [m]=await tx.q('SELECT 1 FROM room_messages WHERE id=$1 AND room_id=$2 AND deleted_at IS NULL',[messageId,id]);if(!m)fail(404,'This message is no longer available.');}
  await tx.q('UPDATE rooms SET pinned_message_id=$2 WHERE id=$1',[id,messageId]);return {ok:true};
 }
 if(action==='room-send'){
  const ids=mediaIds(input.mediaIds),content=text(input.body??'',ids.length?0:1,2000),requestId=uuid(input.requestId),replyTo=input.replyTo==null?null:uuid(input.replyTo);
  const [existing]=await tx.q('SELECT id,room_id,body,reply_to FROM room_messages WHERE sender_id=$1 AND request_id=$2',[user.id,requestId]);
  if(existing){if(existing.room_id!==id||existing.body!==content||existing.reply_to!==replyTo)fail(409,'Please start a new message request.');await checkMediaRetry(tx,'room',existing.id,ids);return {id:existing.id};}
  if(replyTo){const [parent]=await tx.q('SELECT 1 FROM room_messages WHERE id=$1 AND room_id=$2 AND deleted_at IS NULL',[replyTo,id]);if(!parent)fail(404,'The message you are replying to is no longer available.');}
  const [recent]=await tx.q("SELECT count(*)::int AS n FROM room_messages WHERE sender_id=$1 AND created_at>now()-interval '1 minute'",[user.id]);
  if(recent.n>=20)fail(429,'You can send up to 20 room messages per minute.');
  const [message]=await tx.q('INSERT INTO room_messages(room_id,sender_id,body,request_id,reply_to) VALUES($1,$2,$3,$4,$5) RETURNING id',[id,user.id,content,requestId,replyTo]);
  await attachMedia(tx,user,'room',id,message.id,ids);
  const handles=handlesIn(content);
  if(handles.length)await tx.q(`INSERT INTO room_mentions(message_id,user_id) SELECT $1,u.id FROM users u JOIN room_members rm ON rm.user_id=u.id
   WHERE rm.room_id=$2 AND u.id<>$3 AND lower(u.handle)=ANY($4::text[]) ON CONFLICT DO NOTHING`,[message.id,id,user.id,handles]);
  const farming=await recordContribution(tx,user,id,message.id,content);return {...message,farming};
 }
 if(action==='room-delete-message'){
  const messageId=uuid(input.messageId);
  const [message]=await tx.q('SELECT sender_id FROM room_messages WHERE id=$1 AND room_id=$2 AND deleted_at IS NULL',[messageId,id]);
  if(!message)fail(404,'Message not found.');
  if(message.sender_id!==user.id&&room.owner_id!==user.id)fail(403,'You can remove your own messages. The owner can moderate this room.');
  await tx.q('UPDATE rooms SET pinned_message_id=NULL WHERE id=$1 AND pinned_message_id=$2',[id,messageId]);
  await tx.q('UPDATE room_messages SET deleted_at=clock_timestamp() WHERE id=$1',[messageId]);await voidContribution(tx,messageId);return {ok:true};
 }
 fail(404,'Action not found.');
}
async function membershipLimit(tx,user){
 const [count]=await tx.q('SELECT count(*)::int AS n FROM room_members m JOIN rooms r ON r.id=m.room_id WHERE m.user_id=$1 AND r.archived_at IS NULL',[user.id]);
 if(count.n>=50)fail(409,'You can join up to 50 rooms. Leave a room to join another.');
}

async function maskQuotes(db,user,rows){
 const controls=await db.q('SELECT target_id AS id FROM member_controls WHERE user_id=$1 AND (blocked OR muted) UNION SELECT user_id AS id FROM member_controls WHERE target_id=$1 AND blocked',[user.id]);
 const hidden=new Set(controls.map(c=>c.id));return rows.map(({reply_sender_id,...m})=>({...m,reply:m.reply&&hidden.has(reply_sender_id)?{id:m.reply.id,removed:true}:m.reply}));
}
