import {createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import {fail} from './http.js';
import {newsCategories,reserveNewsCost} from './news.js';
import {newsAIConfig,newsAIStatus} from './news-ai.js';
import {newsSourceContext,draftInstructions,verifyInstructions} from './news-policy.js';
import {enqueueNewsPost} from './news-queue.js';
import {newsMediaFields} from './news-media.js';
import {newsAIRequest as ai} from './news-ai-client.js';
import {newsSpendState,newsPublicationState} from './news-budget.js';
import {selectNewsCandidates} from './news-selection.js';
export {newsAITimeout} from './news-ai-client.js';
const hash=s=>createHash('sha256').update(s).digest('hex');
export function requireNewsCron(req){const secret=process.env.CRON_SECRET;if(!secret||!timingSafeEqual(Buffer.from(hash(String(req.headers.authorization||'')),'hex'),Buffer.from(hash('Bearer '+secret),'hex')))fail(401,'Unauthorized.');}
async function fetchJSON(fetcher,url,options={},timeoutMs=14000){
 const r=await fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
 if(!r.ok)throw Error('upstream-'+r.status);
 const raw=await r.text();if(Buffer.byteLength(raw)>250000)throw Error('oversized-response');
 return JSON.parse(raw);
}
export {normalizeNewsPost} from './news-queue.js';

async function collect(db,source,fetcher){
 const headers={Authorization:'Bearer '+process.env.X_NEWS_BEARER_TOKEN,Accept:'application/json'};
 try{
  if(!source.x_user_id){
   await reserveNewsCost(db,'x',1);
   const r=await fetchJSON(fetcher,'https://api.x.com/2/users/by/username/'+source.username,{headers});
   if(!r.data||r.errors?.length||String(r.data.username).toLowerCase()!==source.username||!/^[0-9]{1,20}$/.test(String(r.data.id)))throw Error('identity-mismatch');
   source.x_user_id=String(r.data.id);await db.q('UPDATE news_sources SET x_user_id=$2 WHERE id=$1',[source.id,source.x_user_id]);
  }
  const url=new URL(`https://api.x.com/2/users/${source.x_user_id}/tweets`);
  url.searchParams.set('max_results','5');url.searchParams.set('exclude','retweets,replies');url.searchParams.set('tweet.fields','created_at,author_id,referenced_tweets,note_tweet');
  newsMediaFields(url);
  if(source.since_id)url.searchParams.set('since_id',source.since_id);else url.searchParams.set('start_time',new Date(source.initial_start_at).toISOString());
  if(source.pagination_token)url.searchParams.set('pagination_token',source.pagination_token);
  // Five returned posts at $0.005 each, rounded up. No assumption of provider deduplication.
  await reserveNewsCost(db,'x',3);
  const result=await fetchJSON(fetcher,url.href,{headers});
  if(result.errors?.length||!Array.isArray(result.data||[]))throw Error('incomplete-timeline');
  let latest=source.pending_since_id||source.since_id||'0';
  for(const post of result.data||[]){
   if(/^[0-9]{1,20}$/.test(String(post.id))&&BigInt(post.id)>BigInt(latest))latest=String(post.id);
   await enqueueNewsPost(db,post,source,new Date(),result.includes);
  }
  const next=result.meta?.next_token||null;
  if(next&&(typeof next!=='string'||next.length>2000))throw Error('invalid-cursor');
  await db.q("UPDATE news_sources SET since_id=CASE WHEN $3::text IS NULL THEN COALESCE($2,since_id) ELSE since_id END,pending_since_id=CASE WHEN $3::text IS NULL THEN NULL ELSE $2 END,pagination_token=$3,last_fetched_at=clock_timestamp(),next_fetch_at=CASE WHEN $3::text IS NULL THEN clock_timestamp()+interval '1 hour' ELSE clock_timestamp() END,last_status='ok' WHERE id=$1",[source.id,latest==='0'?null:latest,next]);
 }catch(error){
  const code=/^upstream-(\d{3})$/.exec(error.message||'')?.[1];
  const status=error.status===503?'allowance-or-paused':code==='401'?'x-authentication-required':code==='402'?'x-credits-required':code==='403'?'x-access-denied':code==='429'?'x-rate-limited':'collection-error';
  await db.q("UPDATE news_sources SET next_fetch_at=clock_timestamp()+interval '1 hour',last_status=$2 WHERE id=$1",[source.id,status]);
 }
}
const str={type:'string'},bool={type:'boolean'};
const schema=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const draftSchema=schema({newsworthy:bool,selection_reason:str,kind:{type:'string',enum:['news','market-view']},highlights_en:{type:'array',items:str},headings_en:{type:'array',items:str},category:{type:'string',enum:newsCategories},risk:{type:'string',enum:['low','high']},title_en:str,summary_en:str,body_en:{type:'array',items:str},evidence:{type:'array',items:str},duplicate_of:{type:['string','null']}});
const verifySchema=schema({supported:bool,english:bool,newsworthy:bool,low_risk:bool,confidence:{type:'integer'},reason:str});
function clean(value,min,max){return typeof value==='string'&&value.trim().length>=min&&value.length<=max&&!/[<>]|https?:\/\//i.test(value);}
export function validNewsDraft(d,sourceText){
 return d&&typeof d.newsworthy==='boolean'&&newsCategories.includes(d.category)&&['low','high'].includes(d.risk)
 &&clean(d.title_en,8,160)&&clean(d.summary_en,20,420)&&Array.isArray(d.body_en)&&d.body_en.length>=1&&d.body_en.length<=4&&d.body_en.every(p=>clean(p,30,900))
 &&['news','market-view'].includes(d.kind)&&(d.category==='markets')===(d.kind==='market-view')
 &&Array.isArray(d.highlights_en)&&d.highlights_en.length>=1&&d.highlights_en.length<=3&&d.highlights_en.every(p=>clean(p,8,180))&&Array.isArray(d.headings_en)&&d.headings_en.length===d.body_en.length&&d.headings_en.every(p=>clean(p,3,70))
 &&Array.isArray(d.evidence)&&d.evidence.length>=1&&d.evidence.length<=4&&d.evidence.every(q=>typeof q==='string'&&q.length>=12&&q.length<=300&&sourceText.includes(q))
 &&(d.duplicate_of===null||/^[0-9a-f-]{36}$/i.test(d.duplicate_of));
}
export function canAutoPublish(d,v,sourceText){
 const risky=/\b(hack|exploit|breach|stolen|airdrop|claim|giveaway|guaranteed)\b|ignore.{0,30}instructions|system prompt|seed phrase|private key/i.test(sourceText);
 return !risky&&d.risk==='low'&&d.category!=='security'&&d.duplicate_of===null&&v.supported===true&&v.english===true&&v.newsworthy===true&&v.low_risk===true&&Number.isInteger(v.confidence)&&v.confidence>=90&&v.confidence<=100;
}
async function processItem(db,item,fetcher,lease,deadline){
 const recent=await db.q("SELECT id,title_en FROM news_items WHERE status IN ('published','review') AND created_at>clock_timestamp()-interval '7 days' AND id<>$1 ORDER BY created_at DESC LIMIT 12",[item.id]);
 try{
  const d=await ai(db,fetcher,'vyx_news_draft',draftSchema,{source:{...newsSourceContext(item.username),published_at:item.source_published_at,text:item.source_text},recent_stories:recent},
   draftInstructions,deadline);
  if(d.newsworthy===false){await db.q("UPDATE news_items SET status='rejected',reason=$2,processing_until=NULL,updated_at=clock_timestamp() WHERE id=$1 AND status='pending' AND processing_token=$3",[item.id,String(d.selection_reason||'Not a substantive news update').slice(0,400),lease]);return 'rejected';}
  if(!validNewsDraft(d,item.source_text))throw Error('invalid-draft');
  if(!d.newsworthy||d.duplicate_of){if(d.duplicate_of&&!recent.some(r=>r.id===d.duplicate_of))throw Error('invalid-duplicate');await db.q("UPDATE news_items SET status='rejected',reason=$2,processing_until=NULL,updated_at=clock_timestamp() WHERE id=$1 AND processing_token=$3",[item.id,d.duplicate_of?'Duplicate event':'Not a substantive news update',lease]);return 'rejected';}
  const v=await ai(db,fetcher,'vyx_news_verification',verifySchema,{source:item.source_text,draft:d},
   verifyInstructions,deadline);
  if(typeof v.supported!=='boolean'||typeof v.english!=='boolean'||typeof v.reason!=='string'||v.reason.length>1000)throw Error('invalid-verification');
  return await db.tx(async tx=>{
   const [settings]=await tx.q('SELECT * FROM news_settings WHERE id=1 FOR UPDATE');
   const [source]=await tx.q('SELECT enabled,archived FROM news_sources WHERE id=$1',[item.source_id]);
   const publication=await newsPublicationState(tx,settings);
   const publish=settings.enabled&&settings.lease_token===lease&&source.enabled&&!source.archived&&settings.auto_publish&&publication.allowed&&canAutoPublish(d,v,item.source_text);
   // Bind encoded JSON as text: postgres.js otherwise encodes the string a second time for jsonb parameters.
   await tx.q(`UPDATE news_items SET title_en=$2,summary_en=$3,body_en=$4::text::jsonb,presentation=$5::text::jsonb,category=$6,verification=$7::text::jsonb,reason=$8,status=$9,published_at=CASE WHEN $9='published' THEN clock_timestamp() ELSE NULL END,processing_until=NULL,updated_at=clock_timestamp()
    WHERE id=$1 AND status='pending' AND processing_token=$10`,[item.id,d.title_en,d.summary_en,JSON.stringify(d.body_en),JSON.stringify({kind:d.kind,headings_en:d.headings_en,highlights_en:d.highlights_en}),d.category,JSON.stringify(v),v.reason,publish?'published':'review',lease]);
   return publish?'published':'review';
  });
 }catch(error){
  const upstream=/^upstream-(\d{3})$/.exec(error.message||'')?.[1];
  const reason=error.status===503?'Daily allowance reached or paused; retry later.':['TimeoutError','AbortError'].includes(error.name)?'AI request timed out; retry scheduled.':error.message==='news-run-deadline'?'Run time limit reached; retry scheduled.':upstream?'AI service returned HTTP '+upstream+'; retry scheduled.':['invalid-draft','incomplete-ai-output','invalid-verification'].includes(error.message)?'AI returned an incomplete article or source check; retry scheduled.':'Draft processing failed; retry scheduled.';
  await db.q(`UPDATE news_items SET status=CASE WHEN attempts>=3 THEN 'review' ELSE 'pending' END,reason=$2,next_attempt_at=clock_timestamp()+interval '1 hour',processing_until=NULL,updated_at=clock_timestamp() WHERE id=$1 AND status='pending' AND processing_token=$3`,[item.id,reason,lease]);
  return 'retry';
 }
}
export async function runNewsPipeline(db,fetcher=fetch,{collectPosts=true,startedAt=Date.now()}={}){
 const [settings]=await db.q('SELECT * FROM news_settings WHERE id=1');
 const [count]=await db.q('SELECT count(*)::int AS n FROM news_sources WHERE enabled AND NOT archived');
 const idle=!count.n?'waiting-for-sources':!settings.enabled?'paused':!process.env.X_NEWS_BEARER_TOKEN||!newsAIStatus().ready?'waiting-for-credentials':null;
 if(idle){await db.q('UPDATE news_settings SET last_status=$1 WHERE id=1',[idle]);return {status:idle,collected:0,processed:0};}
 const started=startedAt,lease=randomUUID();
 const [lock]=await db.q("UPDATE news_settings SET lease_token=$1,lease_until=clock_timestamp()+interval '3 minutes',last_started_at=clock_timestamp(),last_status='running' WHERE id=1 AND (lease_until IS NULL OR lease_until<clock_timestamp()) RETURNING id",[lease]);
 if(!lock)return {status:'already-running'};
 try{
  // One source and one story per run keep execution inside the serverless time limit.
  const [source]=collectPosts&&settings.collection_mode!=='batch'?await db.q('SELECT * FROM news_sources WHERE enabled AND NOT archived AND next_fetch_at<=clock_timestamp() ORDER BY next_fetch_at,id LIMIT 1'):[];
  if(source)await collect(db,source,fetcher);
  const publication=await newsPublicationState(db,settings);
  let waitStatus=publication.today>=6?'daily-publication-limit':settings.pacing_enabled&&settings.auto_publish&&!publication.allowed?'publication-window-wait':null;
  let selection=null;
  if(settings.pacing_enabled){
   const funds=await newsSpendState(db,settings),cost=newsAIConfig().reservationCents;
   if(funds.dailyRemainingCents<cost*2)waitStatus='daily-allowance-wait';
   else if(funds.remainingCents<cost*2)waitStatus='budget-window-wait';
   if(!waitStatus){
    const [ready]=await db.q("SELECT EXISTS(SELECT 1 FROM news_items n JOIN news_sources s ON s.id=n.source_id WHERE n.status='pending' AND n.selection_status='selected' AND n.next_attempt_at<=clock_timestamp() AND n.source_published_at>clock_timestamp()-interval '48 hours' AND s.enabled AND NOT s.archived) AS present");
    if(!ready.present){
     if(funds.remainingCents<cost*3)waitStatus='budget-window-wait';
     else selection=await selectNewsCandidates(db,fetcher,lease,started+52000);
    }
   }
  }
  if(waitStatus){await db.q('UPDATE news_settings SET last_status=$2,last_completed_at=clock_timestamp() WHERE id=1 AND lease_token=$1',[lease,waitStatus]);return {status:waitStatus,collected:source?1:0,processed:0};}
  let processed=0;
  for(let candidate=0;candidate<2&&Date.now()-started<25000;candidate++){
  if(settings.pacing_enabled&&(await newsSpendState(db,settings)).remainingCents<newsAIConfig().reservationCents*2)break;
  const [item]=await db.q(`UPDATE news_items SET processing_token=$1,processing_until=clock_timestamp()+interval '3 minutes',attempts=attempts+1 WHERE id=(
   SELECT n.id FROM news_items n JOIN news_sources s ON s.id=n.source_id WHERE n.status='pending' AND s.enabled AND NOT s.archived
   AND (NOT $2::boolean OR n.selection_status='selected')
   AND n.source_published_at>clock_timestamp()-interval '48 hours' AND n.next_attempt_at<=clock_timestamp() AND (n.processing_until IS NULL OR n.processing_until<clock_timestamp())
   ORDER BY CASE WHEN $2::boolean THEN n.source_published_at END DESC,n.created_at LIMIT 1)
   RETURNING *`,[lease,settings.pacing_enabled]);
  if(!item)break;const [s]=await db.q('SELECT username FROM news_sources WHERE id=$1',[item.source_id]);processed++;const outcome=await processItem(db,{...item,username:s.username},fetcher,lease,started+52000);if(outcome!=='rejected')break;
  }
  await db.q("UPDATE news_items SET status='rejected',reason='Source update is older than 48 hours.' WHERE status='pending' AND source_published_at<=clock_timestamp()-interval '48 hours'");
  await db.q("UPDATE news_settings SET last_completed_at=clock_timestamp(),last_status='completed' WHERE id=1 AND lease_token=$1",[lease]);
  return {status:'completed',collected:source?1:0,processed,...(selection?{selection}: {})};
 }finally{await db.q('UPDATE news_settings SET lease_until=NULL,lease_token=NULL WHERE id=1 AND lease_token=$1',[lease]);}
}
