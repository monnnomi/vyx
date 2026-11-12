import {randomUUID} from 'node:crypto';
import {newsMediaFields,extractNewsPhotos} from './news-media.js';
import {reserveBatchRead,settleBatchRead,newsWriterReserve} from './news-batch.js';
// Backfill existing published articles through the same bounded news allowance.
export async function syncNewsPhotos(db,fetcher=fetch,startedAt=Date.now()){
 const [settings]=await db.q('SELECT enabled,daily_budget_cents FROM news_settings WHERE id=1');
 if(!settings.enabled||!process.env.X_NEWS_BEARER_TOKEN||Date.now()-startedAt>30000)return {updated:0};
 const lease=randomUUID(),[locked]=await db.q("UPDATE news_settings SET scan_lease_token=$1,scan_lease_until=clock_timestamp()+interval '3 minutes' WHERE id=1 AND (scan_lease_until IS NULL OR scan_lease_until<clock_timestamp()) RETURNING id",[lease]);
 if(!locked)return {updated:0};
 let items=[];
 try{
  items=await db.q(`SELECT n.id,n.x_post_id,s.x_user_id FROM news_items n JOIN news_sources s ON s.id=n.source_id
   WHERE n.status='published' AND n.media_checked_at IS NULL AND n.media_next_attempt_at<=clock_timestamp() AND s.enabled AND NOT s.archived AND s.x_user_id IS NOT NULL ORDER BY n.published_at DESC,n.id DESC LIMIT 10`);
  if(!items.length)return {updated:0};
  const reservation=await reserveBatchRead(db,Math.ceil(items.length/2),newsWriterReserve(settings.daily_budget_cents));
  const url=new URL('https://api.x.com/2/tweets');url.searchParams.set('ids',items.map(i=>i.x_post_id).join(','));url.searchParams.set('tweet.fields','author_id');newsMediaFields(url);
  const r=await fetcher(url.href,{redirect:'error',signal:AbortSignal.timeout(8000),headers:{Authorization:'Bearer '+process.env.X_NEWS_BEARER_TOKEN,Accept:'application/json'}});
  if(!r.ok)throw Error('media-lookup-failed');const raw=await r.text();if(Buffer.byteLength(raw)>300000)throw Error('oversized-media-response');
  const result=JSON.parse(raw),posts=result.data||[];
  if(!Array.isArray(posts)||posts.length>items.length||(!posts.length&&!result.errors?.length)||new Set(posts.map(p=>p.id)).size!==posts.length||posts.some(p=>!items.some(i=>i.x_post_id===p.id&&i.x_user_id===p.author_id)))throw Error('incomplete-media-response');
  await db.tx(async tx=>{for(const item of items){const post=posts.find(p=>p.id===item.x_post_id);
   if(post)await tx.q("UPDATE news_items SET source_media=$2::text::jsonb,media_checked_at=clock_timestamp() WHERE id=$1 AND status='published' AND media_checked_at IS NULL",[item.id,JSON.stringify(extractNewsPhotos(post,result.includes))]);
   else await tx.q("UPDATE news_items SET media_next_attempt_at=clock_timestamp()+interval '1 day' WHERE id=$1 AND media_checked_at IS NULL",[item.id]);
  }});
  if(!result.errors?.length&&posts.length===items.length)await settleBatchRead(db,reservation,posts.length);
  return {updated:posts.length};
 }catch(error){
  // Failed reads keep their reservation; do not keep retrying a missing/deleted post.
  if(items.length&&error.status!==503)await db.q("UPDATE news_items SET media_next_attempt_at=clock_timestamp()+interval '1 day' WHERE id=ANY($1::uuid[]) AND media_checked_at IS NULL",[items.map(i=>i.id)]);
  return {updated:0};
 }finally{await db.q('UPDATE news_settings SET scan_lease_token=NULL,scan_lease_until=NULL WHERE id=1 AND scan_lease_token=$1',[lease]);}
}
