import {appURL} from './http.js';
import {newsAIStatus,newsAIConfig} from './news-ai.js';
import {runNewsPipeline} from './news-pipeline.js';
import {collectNewsBatches,newsWriterReserve,newsWriterWindowReserve} from './news-batch.js';
import {syncNewsPhotos} from './news-media-sync.js';
import {newsSpendState,newsPublicationState} from './news-budget.js';
import {runAutomaticTaskChecks,taskQueueHasWork} from './x-task-queue.js';
export async function runNewsJobs(db,fetcher=fetch){
 const tasks=await runAutomaticTaskChecks(db,fetcher);
 if(tasks.status!=='idle'){
  if(tasks.status!=='already-running')await db.q("UPDATE news_settings SET last_status='quest-priority' WHERE id=1");
  return {status:tasks.status==='already-running'?'already-running':'quest-priority',tasks,collected:0,processed:0};
 }
 const startedAt=Date.now(),[settings]=await db.q('SELECT collection_mode FROM news_settings WHERE id=1');
 const scan=settings.collection_mode==='batch'?await collectNewsBatches(db,fetcher,startedAt):null;
 const media=settings.collection_mode==='batch'?await syncNewsPhotos(db,fetcher,startedAt):null;
 const result=await runNewsPipeline(db,fetcher,{startedAt,collectPosts:settings.collection_mode!=='batch'});
 return {...result,...(scan?{scan,media}: {})};
}
export async function newsQueueHasWork(db){
 if(await taskQueueHasWork(db,{includeRunning:true}))return false;
 if(!process.env.X_NEWS_BEARER_TOKEN||!newsAIStatus().ready||!process.env.CRON_SECRET)return false;
 const [r]=await db.q(`SELECT EXISTS(SELECT 1 FROM news_items n JOIN news_sources s ON s.id=n.source_id
 WHERE n.status='pending' AND s.enabled AND NOT s.archived AND n.next_attempt_at<=clock_timestamp()
 AND (NOT pacing_enabled OR n.selection_status='selected' OR n.selection_next_at<=clock_timestamp())
 AND n.source_published_at>clock_timestamp()-interval '48 hours' AND (n.processing_until IS NULL OR n.processing_until<clock_timestamp())) AS pending,
 EXISTS(SELECT 1 FROM news_sources WHERE enabled AND NOT archived AND x_user_id IS NULL AND next_fetch_at<=clock_timestamp()) AS unknown,
 EXISTS(SELECT 1 FROM news_scan_batches WHERE active AND next_fetch_at<=clock_timestamp()) AS scan_due,
 enabled,auto_publish,pacing_enabled,collection_mode,scan_dirty,daily_budget_cents,daily_budget_cents-COALESCE((SELECT reserved_cents FROM news_budget WHERE day=(clock_timestamp() AT TIME ZONE 'UTC')::date),0) AS remaining,
 (SELECT count(*) FROM news_items WHERE published_at>=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS published
 FROM news_settings WHERE id=1`);
 if(!r.enabled||r.collection_mode!=='batch')return false;
 const funds=await newsSpendState(db,r),publication=await newsPublicationState(db,r);
 const scan=r.remaining>=5+newsWriterReserve(r.daily_budget_cents)&&(!r.pacing_enabled||funds.remainingCents>=5+newsWriterWindowReserve())&&(r.scan_dirty||r.unknown||r.scan_due);
 const ai=r.pending&&funds.remainingCents>=newsAIConfig().reservationCents*(r.pacing_enabled?3:2)&&Number(r.published)<6&&(!r.pacing_enabled||!r.auto_publish||publication.allowed);
 return Boolean(scan||ai);
}
export async function dispatchNewsQueue(db,fetcher=fetch){
 if(!await taskQueueHasWork(db)&&!await newsQueueHasWork(db))return;
 const r=await fetcher(new URL('/api/news-cron',appURL()).href,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{Authorization:'Bearer '+process.env.CRON_SECRET}});
 if(!r.ok)throw Error('News worker dispatch failed');
}
