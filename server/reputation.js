import {uuid} from './http.js';

// Global profile status: only aggregate totals, never content or reactor identities.
// A room contribution remains recognizable after leaving, while its room stays open.
const eligible=actor=>`${actor}<>$1 AND NOT EXISTS(SELECT 1 FROM member_controls mc WHERE mc.blocked
 AND ((mc.user_id=$1 AND mc.target_id=${actor}) OR (mc.user_id=${actor} AND mc.target_id=$1)))`;
export const reputationSQL=`WITH contributions AS (
 SELECT 'room' AS kind,m.id AS contribution_id,
 ARRAY(SELECT mr.user_id FROM message_reactions mr WHERE mr.room_message_id=m.id AND ${eligible('mr.user_id')}) AS reactors
 FROM room_messages m JOIN rooms r ON r.id=m.room_id AND r.archived_at IS NULL
 WHERE m.sender_id=$1 AND m.deleted_at IS NULL
 UNION ALL
 SELECT 'post' AS kind,p.id AS contribution_id,
 ARRAY(SELECT pr.user_id FROM reactions pr WHERE pr.post_id=p.id AND ${eligible('pr.user_id')}) AS reactors
 FROM posts p WHERE p.user_id=$1
)
SELECT count(DISTINCT (kind,contribution_id))::int AS recognized,
 count(DISTINCT reactor_id)::int AS people
FROM contributions c CROSS JOIN LATERAL unnest(c.reactors) AS reactor_id`;

export async function memberReputation(db,id){
 uuid(id);return (await db.q(reputationSQL,[id]))[0];
}
