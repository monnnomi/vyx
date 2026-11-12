import {appURL} from './http.js';
import {newsAIStatus,newsAIConfig} from './news-ai.js';
import {runNewsPipeline} from './news-pipeline.js';
import {collectNewsBatches,newsWriterReserve} from './news-batch.js';
export async function runNewsJobs(db,fetcher=fetch){
 const startedAt=Date.now(),[settings]=await db.q('SELECT collection_mode FROM news_settings WHERE id=1');
 const scan=settings.collection_mode==='batch'?await collectNewsBatches(db,fetcher,startedAt):null;
 const result=await runNewsPipeline(db,fetcher,{startedAt,collectPosts:settings.collection_mode!=='batch'});
 return {...result,...(scan?{scan}: {})};
}
export async function newsQueueHasWork(db){
 if(!newsAIStatus().ready||!process.env.CRON_SECRET)return false;
 const [r]=await db.q(`SELECT EXISTS(SELECT 1 FROM news_items n JOIN news_sources s ON s.id=n.source_id
 WHERE n.status='pending' AND s.enabled AND NOT s.archived AND n.next_attempt_at<=clock_timestamp()
 AND n.source_published_at>clock_timestamp()-interval '48 hours' AND (n.processing_until IS NULL OR n.processing_until<clock_timestamp())) AS pending,
 EXISTS(SELECT 1 FROM news_sources WHERE enabled AND NOT archived AND x_user_id IS NULL AND next_fetch_at<=clock_timestamp()) AS unknown,
 EXISTS(SELECT 1 FROM news_scan_batches WHERE active AND next_fetch_at<=clock_timestamp()) AS scan_due,
 enabled,collection_mode,scan_dirty,daily_budget_cents,daily_budget_cents-COALESCE((SELECT reserved_cents FROM news_budget WHERE day=(clock_timestamp() AT TIME ZONE 'UTC')::date),0) AS remaining,
 (SELECT count(*) FROM news_items WHERE published_at>=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS published
 FROM news_settings WHERE id=1`);
 return r.enabled&&r.collection_mode==='batch'&&((r.remaining>=5+newsWriterReserve(r.daily_budget_cents)&&(r.scan_dirty||r.unknown||r.scan_due))||(r.pending&&r.remaining>=newsAIConfig().reservationCents*2&&Number(r.published)<6));
}
export async function dispatchNewsQueue(db,fetcher=fetch){
 if(!await newsQueueHasWork(db))return;
 const r=await fetcher(new URL('/api/news-cron',appURL()).href,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{Authorization:'Bearer '+process.env.CRON_SECRET}});
 if(!r.ok)throw Error('News worker dispatch failed');
}
