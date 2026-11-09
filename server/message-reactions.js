import {fail,uuid} from './http.js';
import {assertInteraction} from './social.js';
export const messageReactionEmojis=Object.freeze(['❤️','👍','🔥','😂','👏','😮','🎉','🚀','💯','👀','🙏','🤝','😍','🤔','😎','🤣','😢','😭','😡','👎','💪','🥳','✅','⚡']);
export function reactionProjection(column,viewer){return `COALESCE((SELECT jsonb_agg(jsonb_build_object('emoji',r.emoji,'count',r.n,'mine',r.mine)) FROM (SELECT emoji,count(*)::int AS n,bool_or(user_id=${viewer}) AS mine FROM message_reactions WHERE ${column}=m.id GROUP BY emoji ORDER BY emoji) r),'[]'::jsonb) AS reactions`;}
export async function reactToMessage(tx,user,input){
 const id=uuid(input.id),kind=input.kind,emoji=input.emoji;
 if(!['room','dm'].includes(kind)||!messageReactionEmojis.includes(emoji)||typeof input.enabled!=='boolean')fail(400,'Choose a reaction.');
 const column=kind==='room'?'room_message_id':'message_id';
 const [m]=kind==='room'?await tx.q('SELECT m.sender_id FROM room_messages m JOIN rooms r ON r.id=m.room_id JOIN room_members rm ON rm.room_id=m.room_id AND rm.user_id=$2 WHERE m.id=$1 AND m.deleted_at IS NULL AND r.archived_at IS NULL FOR SHARE OF m,r,rm',[id,user.id]):await tx.q('SELECT sender_id,recipient_id FROM messages WHERE id=$1 AND (sender_id=$2 OR recipient_id=$2) FOR SHARE',[id,user.id]);
 if(!m)fail(404,'Message unavailable.');
 await assertInteraction(tx,user.id,kind==='dm'&&m.sender_id===user.id?m.recipient_id:m.sender_id);
 if(input.enabled)await tx.q(`INSERT INTO message_reactions(user_id,${column},emoji) VALUES($1,$2,$3) ON CONFLICT(user_id,${column}) DO UPDATE SET emoji=EXCLUDED.emoji`,[user.id,id,emoji]);
 else await tx.q(`DELETE FROM message_reactions WHERE user_id=$1 AND ${column}=$2 AND emoji=$3`,[user.id,id,emoji]);
 return {ok:true};
}
