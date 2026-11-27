import {fail} from './http.js';

// All arguments here are internal SQL expressions, never request strings.
export function hiddenBy(viewer,target){return `EXISTS(SELECT 1 FROM member_controls mc WHERE (mc.user_id=${viewer} AND mc.target_id=${target} AND (mc.blocked OR mc.muted)) OR (mc.user_id=${target} AND mc.target_id=${viewer} AND mc.blocked))`;}
export async function assertInteraction(db,viewer,target){
 const [blocked]=await db.q('SELECT 1 FROM member_controls WHERE blocked AND ((user_id=$1 AND target_id=$2) OR (user_id=$2 AND target_id=$1))',[viewer,target]);
 if(blocked)fail(403,'This interaction is unavailable while either account has blocked the other.');
}
