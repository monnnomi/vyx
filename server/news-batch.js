import {createHash,randomUUID} from 'node:crypto';
import {reserveNewsCost} from './news.js';
import {enqueueNewsPost} from './news-queue.js';
import {newsAIConfig} from './news-ai.js';
export function buildNewsBatches(sources){
 const active=sources.filter(s=>s.enabled&&!s.archived).sort((a,b)=>a.username.localeCompare(b.username));
 const batches=[];
 for(let i=0;i<active.length;i+=20){
  const members=active.slice(i,i+20),query='('+members.map(s=>'from:'+s.username).join(' OR ')+') -is:retweet -is:reply';
  if(query.length>512)throw Error('News query is too long');
  const ids=members.map(s=>s.since_id).filter(Boolean);
  const since=ids.length===members.length?ids.reduce((a,b)=>BigInt(a)<BigInt(b)?a:b):null;
  const start=Math.max(Date.now()-172800000,Math.min(...members.map(s=>new Date(s.initial_start_at).getTime())));
  batches.push({id:createHash('sha256').update(query).digest('hex'),query,members,since,start:new Date(start).toISOString()});
 }
 return batches;
}
async function xJSON(fetcher,url){
 const r=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+process.env.X_NEWS_BEARER_TOKEN,Accept:'application/json'}});
 if(!r.ok)throw Error('x-http-'+r.status);
 const raw=await r.text();if(Buffer.byteLength(raw)>300000)throw Error('oversized-response');return JSON.parse(raw);
}
export const newsWriterReserve=budget=>Math.min(Math.floor(budget/4),Math.max(20,newsAIConfig().reservationCents*12));
export async function reserveBatchRead(db,cents,keepForAI=0){
 return db.tx(async tx=>{
  const [settings]=await tx.q('SELECT daily_budget_cents FROM news_settings WHERE id=1 FOR UPDATE');
  const [usage]=await tx.q("SELECT reserved_cents FROM news_budget WHERE day=(clock_timestamp() AT TIME ZONE 'UTC')::date FOR UPDATE");
  if((usage?.reserved_cents||0)+cents>settings.daily_budget_cents-keepForAI)throw Object.assign(Error('Collection allowance reached.'),{status:503});
  const day=await reserveNewsCost(tx,'x',cents),id=randomUUID();await tx.q('INSERT INTO news_read_reservations(id,day,cents) VALUES($1,$2,$3)',[id,day,cents]);return id;
 });
}
export async function settleBatchRead(db,id,count){
 if(!Number.isInteger(count)||count<0||count>10)throw Error('Invalid read settlement');
 return db.tx(async tx=>{
  const [r]=await tx.q('UPDATE news_read_reservations SET settled=true,charged_cents=$2 WHERE id=$1 AND NOT settled RETURNING day,cents',[id,Math.ceil(count/2)]);
  if(!r)return;const refund=r.cents-Math.ceil(count/2);if(refund<0)throw Error('Read exceeded reservation');
  if(refund)await tx.q('UPDATE news_budget SET reserved_cents=reserved_cents-$2,x_cents=x_cents-$2 WHERE day=$1',[r.day,refund]);
 });
}
export async function collectNewsBatches(db,fetcher=fetch,startedAt=Date.now()){
 const [settings]=await db.q('SELECT * FROM news_settings WHERE id=1');
 if(!settings.enabled||settings.collection_mode!=='batch'||!process.env.X_NEWS_BEARER_TOKEN)return {collected:0,status:'paused'};
 const lease=randomUUID(),[lock]=await db.q("UPDATE news_settings SET scan_lease_token=$1,scan_lease_until=clock_timestamp()+interval '3 minutes' WHERE id=1 AND (scan_lease_until IS NULL OR scan_lease_until<clock_timestamp()) RETURNING id",[lease]);
 if(!lock)return {collected:0,status:'already-scanning'};
 let collected=0,status='completed';
 try{
  let sources=await db.q('SELECT * FROM news_sources WHERE enabled AND NOT archived ORDER BY username');
  const [{daily_budget_cents}]=await db.q('SELECT daily_budget_cents FROM news_settings WHERE id=1');
  const writerReserve=newsWriterReserve(daily_budget_cents);
  // Identity lookups are cached, charged before use, and never repeated for quiet known accounts.
  const unknown=sources.filter(s=>!s.x_user_id&&new Date(s.next_fetch_at)<=new Date()).slice(0,10);
  if(unknown.length){
   try{
    const reservation=await reserveBatchRead(db,unknown.length,writerReserve);
    const url='https://api.x.com/2/users/by?usernames='+unknown.map(s=>s.username).join(',');const result=await xJSON(fetcher,url);
    if(result.errors?.length||!Array.isArray(result.data)||result.data.length!==unknown.length)throw Error('incomplete-identities');
    for(const source of unknown){const user=result.data.find(u=>String(u.username).toLowerCase()===source.username);if(!user||!/^[0-9]{1,20}$/.test(String(user.id)))throw Error('identity-mismatch');source.x_user_id=String(user.id);}
    for(const source of unknown)await db.q('UPDATE news_sources SET x_user_id=$2 WHERE id=$1',[source.id,source.x_user_id]);
    // Profile reads are one cent each; retain their full reservation.
    await db.q('UPDATE news_read_reservations SET settled=true,charged_cents=cents WHERE id=$1',[reservation]);
   }catch(error){status=error.status===503?'daily-allowance-reached':'identity-check-failed';await db.q("UPDATE news_sources SET last_status=$2,next_fetch_at=clock_timestamp()+interval '15 minutes' WHERE id=ANY($1::uuid[])",[unknown.map(s=>s.id),status]);}
  }
  const batches=buildNewsBatches(sources.filter(s=>s.x_user_id));
  await db.tx(async tx=>{
   await tx.q('UPDATE news_scan_batches SET active=false');
   for(const b of batches)await tx.q('INSERT INTO news_scan_batches(id,query,since_id,initial_start_at) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET active=true',[b.id,b.query,b.since,b.start]);
   await tx.q('UPDATE news_settings SET scan_dirty=false WHERE id=1');
  });
  // A small page per batch bounds spending. Durable cursors resume busy batches immediately.
  const ordered=await db.q('SELECT * FROM news_scan_batches WHERE active ORDER BY next_fetch_at,id');
  for(const row of ordered){
   if(Date.now()-startedAt>35000)break;
   const b=batches.find(x=>x.id===row.id);if(!b||b.members.some(s=>!s.x_user_id)){status='waiting-for-identities';await db.q("UPDATE news_scan_batches SET last_status='waiting-for-identities',next_fetch_at=clock_timestamp()+interval '15 minutes' WHERE id=$1",[row.id]);continue;}
   if(new Date(row.next_fetch_at)>new Date()&&row.last_status!=='waiting-for-identities')continue;
   let reservation;
   try{
    reservation=await reserveBatchRead(db,5,writerReserve);
    const url=new URL('https://api.x.com/2/tweets/search/recent');url.searchParams.set('query',row.query);url.searchParams.set('max_results','10');url.searchParams.set('sort_order','recency');url.searchParams.set('tweet.fields','created_at,author_id,referenced_tweets,note_tweet');
    if(row.since_id)url.searchParams.set('since_id',row.since_id);else url.searchParams.set('start_time',new Date(row.initial_start_at).toISOString());
    if(row.pagination_token)url.searchParams.set('next_token',row.pagination_token);
    const result=await xJSON(fetcher,url.href),posts=result.data||[];
    if(result.errors?.length||!Array.isArray(posts)||posts.length>10||posts.some(p=>!b.members.some(s=>s.x_user_id===p.author_id)))throw Error('incomplete-search');
    const next=result.meta?.next_token||null;if(next&&(typeof next!=='string'||next.length>2000))throw Error('invalid-cursor');
    let latest=row.pending_since_id||row.since_id||'0';
    for(const post of posts){
     if(!/^[0-9]{1,20}$/.test(String(post.id)))throw Error('invalid-post-id');
     if(BigInt(post.id)>BigInt(latest))latest=String(post.id);
     await enqueueNewsPost(db,post,b.members.find(s=>s.x_user_id===post.author_id));
    }
    await settleBatchRead(db,reservation,posts.length);
    await db.q("UPDATE news_scan_batches SET since_id=CASE WHEN $3::text IS NULL THEN COALESCE($2,since_id) ELSE since_id END,pending_since_id=CASE WHEN $3::text IS NULL THEN NULL ELSE $2 END,pagination_token=$3,last_fetched_at=clock_timestamp(),next_fetch_at=CASE WHEN $3::text IS NULL THEN date_trunc('hour',clock_timestamp())+(floor(extract(minute from clock_timestamp())/15)+1)*interval '15 minutes' ELSE clock_timestamp() END,last_status='ok' WHERE id=$1",[row.id,latest==='0'?null:latest,next]);
    if(!next)await db.q("UPDATE news_sources SET since_id=COALESCE($2,since_id),last_fetched_at=clock_timestamp(),last_status='ok',next_fetch_at=clock_timestamp()+interval '15 minutes' WHERE id=ANY($1::uuid[])",[b.members.map(s=>s.id),latest==='0'?null:latest]);
    collected++;
   }catch(error){
    status=error.status===503?'daily-allowance-reached':/^x-http-/.test(error.message)?error.message:'search-failed';
    await db.q("UPDATE news_scan_batches SET last_status=$2,next_fetch_at=clock_timestamp()+interval '15 minutes' WHERE id=$1",[row.id,status]);
    if(error.status===503)break;
   }
  }
  const [{due}]=await db.q('SELECT EXISTS(SELECT 1 FROM news_scan_batches WHERE active AND next_fetch_at<=clock_timestamp()) AS due');
  if(status==='completed'&&(due||sources.some(s=>!s.x_user_id)))status=due?'continuing':'waiting-for-identities';
  await db.q("UPDATE news_settings SET last_scan_at=CASE WHEN $1='completed' THEN clock_timestamp() ELSE last_scan_at END,scan_status=$1 WHERE id=1",[status]);
  return {collected,status};
 }finally{await db.q('UPDATE news_settings SET scan_lease_token=NULL,scan_lease_until=NULL WHERE id=1 AND scan_lease_token=$1',[lease]);}
}
