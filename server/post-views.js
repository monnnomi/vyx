import {fail,uuid} from './http.js';
import {hiddenBy} from './social.js';

// The viewer is an internal SQL expression, never request text. Posts use alias p.
export function postViewProjection(viewer){return `(SELECT count(*)::int FROM post_views v WHERE v.post_id=p.id AND v.user_id<>p.user_id) AS view_count,
 EXISTS(SELECT 1 FROM post_views v WHERE v.post_id=p.id AND v.user_id=${viewer}) AS viewed_by_me`;}

export async function recordPostViews(tx,user,input){
 if(!user?.x_id||user.is_system)fail(401,'Sign in with X to view posts.');
 if(!Array.isArray(input?.postIds)||input.postIds.length<1||input.postIds.length>60)fail(400,'Choose up to 60 posts.');
 const ids=[...new Set(input.postIds.map(uuid))];
 const [viewer]=await tx.q('SELECT id FROM users WHERE id=$1 AND x_id IS NOT NULL AND NOT is_system FOR KEY SHARE',[user.id]);
 if(!viewer)fail(401,'Please sign in again.');
 const rows=await tx.q(`SELECT p.id FROM posts p WHERE p.id=ANY($2::uuid[]) AND NOT ${hiddenBy('$1','p.user_id')} FOR SHARE OF p`,[user.id,ids]);
 if(rows.length!==ids.length)fail(404,'Some posts are no longer available.');
 await tx.q('INSERT INTO post_views(user_id,post_id) SELECT $1,p.id FROM posts p WHERE p.id=ANY($2::uuid[]) AND p.user_id<>$1 ON CONFLICT(user_id,post_id) DO NOTHING',[user.id,ids]);
 return {views:await tx.q(`SELECT p.id,${postViewProjection('$1')} FROM posts p WHERE p.id=ANY($2::uuid[])`,[user.id,ids])};
}
