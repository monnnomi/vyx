import {randomInt} from 'node:crypto';
import {isAdmin,requireAdmin} from './admin.js';
import {fail,uuid} from './http.js';
import {curatedFeedEnabled} from './blog-curation.js';

export const giveawayTag = /^\[giveaway:(members|bloggers)\]\s*/;
export const giveawayAuthorIds = () => (process.env.VYX_ADMIN_X_IDS||'').split(',').map(id=>id.trim()).filter(Boolean);

export async function migrateForumGiveaways(db) {
 await db.q(`CREATE TABLE IF NOT EXISTS forum_giveaway_draws (
   post_id uuid PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
   winner_id uuid REFERENCES users(id) ON DELETE SET NULL,
   winner_name text NOT NULL, eligible_count integer NOT NULL,
   drawn_at timestamptz NOT NULL DEFAULT now()
 )`);
}

export async function giveawayResults(db,posts) {
 if (!posts.length) return [];
 const ids=posts.map(post=>post.id);
 return db.q(`SELECT post_id,winner_name,eligible_count,drawn_at FROM forum_giveaway_draws
   WHERE post_id::text IN (SELECT jsonb_array_elements_text($1::text::jsonb))`,[JSON.stringify(ids)]);
}

export async function drawGiveaway(db,user,postId) {
 requireAdmin(user);
 const id=uuid(postId);
 return db.tx(async tx=>{
  const [post]=await tx.q(`SELECT p.user_id,p.body,u.x_id,u.is_system FROM posts p
    JOIN users u ON u.id=p.user_id WHERE p.id=$1 FOR UPDATE OF p`,[id]);
  const audience=post?.body.match(giveawayTag)?.[1];
  if(!audience||!isAdmin(post))fail(404,'Giveaway not found.');
  const [prior]=await tx.q('SELECT winner_name,eligible_count FROM forum_giveaway_draws WHERE post_id=$1',[id]);
  if(prior)return prior;
  const blogContribution=await curatedFeedEnabled(tx)?`OR EXISTS(SELECT 1 FROM forum_topic_messages m JOIN forum_topics t ON t.id=m.topic_id
   WHERE t.owner_id=u.id AND m.author_id=u.id AND m.kind='update' AND m.created_at<c.created_at)`:'';
  const entrants=await tx.q(`SELECT DISTINCT u.id,u.name FROM comments c JOIN users u ON u.id=c.user_id
    WHERE c.post_id=$1 AND u.id<>$2 AND u.x_id IS NOT NULL AND NOT u.is_system
    AND ($3<>'bloggers' OR EXISTS (
      SELECT 1 FROM posts b WHERE b.user_id=u.id AND b.created_at<c.created_at AND b.body NOT LIKE '[giveaway:%'
    ) ${blogContribution}) ORDER BY u.id`,[id,post.user_id,audience]);
  if(!entrants.length)fail(409,'No eligible replies yet.');
  const winner=entrants[randomInt(entrants.length)];
  const [result]=await tx.q(`INSERT INTO forum_giveaway_draws(post_id,winner_id,winner_name,eligible_count)
    VALUES($1,$2,$3,$4) RETURNING winner_name,eligible_count`,[id,winner.id,winner.name,entrants.length]);
  return result;
 });
}
