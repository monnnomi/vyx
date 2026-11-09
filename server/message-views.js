import {fail,uuid} from './http.js';
import {hiddenBy,assertInteraction} from './social.js';

// Column and viewer are internal SQL expressions, never request text.
export function messageViewProjection(column,viewer){return `(SELECT count(*)::int FROM message_views v WHERE v.${column}=m.id AND v.user_id<>m.sender_id) AS view_count,
 EXISTS(SELECT 1 FROM message_views v WHERE v.${column}=m.id AND v.user_id=${viewer}) AS viewed_by_me`;}

export async function recordMessageViews(tx,user,input){
 if(!user?.x_id||user.is_system)fail(401,'Sign in with X to view messages.');
 const kind=input.kind,id=uuid(input.id);
 if(!['room','dm'].includes(kind)||!Array.isArray(input.messageIds)||input.messageIds.length<1||input.messageIds.length>60)fail(400,'Choose up to 60 messages.');
 const ids=[...new Set(input.messageIds.map(uuid))];
 // Match the user-before-room lock order used by room mutations.
 const [viewer]=await tx.q('SELECT id FROM users WHERE id=$1 AND x_id IS NOT NULL AND NOT is_system FOR KEY SHARE',[user.id]);
 if(!viewer)fail(401,'Please sign in again.');
 let rows;
 if(kind==='room'){
  const [member]=await tx.q('SELECT r.id FROM rooms r JOIN room_members rm ON rm.room_id=r.id WHERE r.id=$1 AND rm.user_id=$2 AND r.archived_at IS NULL FOR SHARE OF r,rm',[id,user.id]);
  if(!member)fail(403,'Join an available room to view its messages.');
  rows=await tx.q(`SELECT m.id FROM room_messages m WHERE m.room_id=$1 AND m.id=ANY($3::uuid[]) AND m.deleted_at IS NULL AND NOT ${hiddenBy('$2','m.sender_id')} FOR SHARE OF m`,[id,user.id,ids]);
 }else{
  await assertInteraction(tx,user.id,id);
  rows=await tx.q('SELECT m.id FROM messages m WHERE m.id=ANY($3::uuid[]) AND ((m.sender_id=$1 AND m.recipient_id=$2) OR (m.sender_id=$2 AND m.recipient_id=$1)) FOR SHARE OF m',[user.id,id,ids]);
 }
 if(rows.length!==ids.length)fail(404,'Some messages are no longer available.');
 const table=kind==='room'?'room_messages':'messages',column=kind==='room'?'room_message_id':'message_id';
 await tx.q(`INSERT INTO message_views(user_id,${column}) SELECT $1,m.id FROM ${table} m WHERE m.id=ANY($2::uuid[]) AND m.sender_id<>$1 ON CONFLICT(user_id,${column}) DO NOTHING`,[user.id,ids]);
 const views=await tx.q(`SELECT m.id,${messageViewProjection(column,'$1')} FROM ${table} m WHERE m.id=ANY($2::uuid[])`,[user.id,ids]);
 return {views};
}
