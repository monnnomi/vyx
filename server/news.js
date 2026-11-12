import {fail,uuid} from './http.js';
import {requireAdmin} from './admin.js';
import {newsAIStatus} from './news-ai.js';
import {newsPublisher} from './news-policy.js';
export const newsCategories=['updates','ecosystem','events','security','markets'];
export function newsHandle(value){
 const handle=String(value||'').trim().replace(/^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//i,'').replace(/^@/,'').replace(/\/$/,'');
 if(!/^[A-Za-z0-9_]{1,15}$/.test(handle))fail(400,'Enter an X username or a profile link.');
 return handle.toLowerCase();
}
export function publicNewsItem(row,full=false){
 const list=value=>Array.isArray(value)?value:[];
 return {id:row.id,language:'en',publisher:newsPublisher,kind:row.presentation?.kind||'news',highlights:list(row.presentation?.highlights_en),headings:list(row.presentation?.headings_en),title:row.title_en,summary:row.summary_en,
 ...(full?{paragraphs:list(row.body_en)}:{}),category:row.category,source:{username:row.username,url:row.source_url,publishedAt:row.source_published_at},publishedAt:row.published_at};
}
export async function listNews(db,{category='all',before=null,id=null}={}){
 if(!['all',...newsCategories].includes(category))fail(400,'Invalid news filter.');
 if(id){const [row]=await db.q("SELECT n.*,s.username FROM news_items n JOIN news_sources s ON s.id=n.source_id WHERE n.id=$1 AND n.status='published'",[uuid(id)]);if(!row)fail(404,'This story is not available.');return {article:publicNewsItem(row,true)};}
 const cursor=before?uuid(before):null;
 const rows=await db.q(`SELECT n.*,s.username FROM news_items n JOIN news_sources s ON s.id=n.source_id
 WHERE n.status='published' AND ($1='all' OR n.category=$1)
 AND ($2::uuid IS NULL OR (n.published_at,n.id)<(SELECT published_at,id FROM news_items WHERE id=$2 AND status='published'))
 ORDER BY n.published_at DESC,n.id DESC LIMIT 13`,[category,cursor]);
 return {articles:rows.slice(0,12).map(r=>publicNewsItem(r)),next:rows.length>12?rows[11].id:null};
}
export async function newsAdminState(db,user){
 requireAdmin(user);
 const [settings]=await db.q('SELECT * FROM news_settings WHERE id=1');
 const sources=await db.q('SELECT * FROM news_sources WHERE NOT archived ORDER BY created_at');
 const items=await db.q(`SELECT n.*,s.username FROM news_items n JOIN news_sources s ON s.id=n.source_id ORDER BY n.created_at DESC LIMIT 40`);
 const [usage]=await db.q("SELECT * FROM news_budget WHERE day=(clock_timestamp() AT TIME ZONE 'UTC')::date");
 const counts=await db.q('SELECT status,count(*)::int AS total FROM news_items GROUP BY status');
 const {lease_token,lease_until,scan_lease_token,scan_lease_until,...safeSettings}=settings;
 const ai=newsAIStatus();
 return {settings:safeSettings,sources,items,counts,usage:usage||{reserved_cents:0,x_cents:0,ai_cents:0},
 readiness:{x:Boolean(process.env.X_NEWS_BEARER_TOKEN),ai:ai.ready,sources:sources.some(s=>s.enabled),model:ai.model,provider:ai.provider},budgetNote:'Conservative request reservations in USD cents, not an invoice. Failed or uncertain requests keep their reservation. UTC daily reset.'};
}
export async function newsAdminWrite(db,user,input){
 requireAdmin(user);
 if(input.action==='settings'){
  if(typeof input.enabled!=='boolean'||typeof input.autoPublish!=='boolean'||!Number.isInteger(input.budgetCents)||input.budgetCents<0||input.budgetCents>100)fail(400,'Choose a daily allowance from $0 to $1.');
  if(input.enabled){const [n]=await db.q('SELECT count(*)::int AS n FROM news_sources WHERE enabled AND NOT archived');if(!n.n||!process.env.X_NEWS_BEARER_TOKEN||!newsAIStatus().ready)fail(409,'Add sources and connect X and the AI service before starting the newsroom.');}
  await db.q('UPDATE news_settings SET enabled=$1,auto_publish=$2,daily_budget_cents=$3,updated_at=clock_timestamp() WHERE id=1',[input.enabled,input.autoPublish,input.budgetCents]);
 }else if(['source-add','source-add-many'].includes(input.action)){
  const raw=input.action==='source-add'?[input.username]:String(input.usernames||'').split(/[,\s]+/).filter(Boolean);
  if(!raw.length||raw.length>100)fail(400,'Add between 1 and 100 accounts.');
  const names=[...new Set(raw.map(newsHandle))];
  await db.tx(async tx=>{
   await tx.q('SELECT id FROM news_settings WHERE id=1 FOR UPDATE');
   const active=await tx.q('SELECT username FROM news_sources WHERE NOT archived');
   if(new Set([...active.map(s=>s.username),...names]).size>100)fail(400,'Up to 100 sources can be monitored.');
   for(const username of names)await tx.q("INSERT INTO news_sources(username) VALUES($1) ON CONFLICT(username) DO UPDATE SET archived=false,enabled=true,next_fetch_at=clock_timestamp()",[username]);
  });
 }else if(input.action==='source-toggle'||input.action==='source-remove'){
  if(typeof input.enabled!=='boolean'&&input.action==='source-toggle')fail(400,'Invalid source setting.');
  await db.q('UPDATE news_sources SET enabled=$2,archived=$3 WHERE id=$1',[uuid(input.id),input.action==='source-toggle'?input.enabled:false,input.action==='source-remove']);
 }else if(['publish','reject','withdraw','retry'].includes(input.action)){
  await db.tx(async tx=>{
   const [item]=await tx.q('SELECT * FROM news_items WHERE id=$1 FOR UPDATE',[uuid(input.id)]);if(!item)fail(404,'Story not found.');
   let status;
   if(input.action==='publish'){
    if(item.status!=='review'||!item.title_en||(!Array.isArray(item.body_en)||!item.body_en.length)||item.verification?.supported!==true||item.verification?.english!==true)fail(409,'Only a complete, source-checked English draft can be published.');
    status='published';
   }else if(input.action==='withdraw'){if(item.status!=='published')fail(409,'This story is not published.');status='withdrawn';}
   else if(input.action==='retry'){if(!['review','rejected'].includes(item.status))fail(409,'This story cannot be retried.');status='pending';}
   else {if(item.status==='published')fail(409,'Withdraw a published story first.');status='rejected';}
   await tx.q("UPDATE news_items SET status=$2,published_at=CASE WHEN $2='published' THEN clock_timestamp() ELSE published_at END,reviewed_by=$3,reviewed_at=clock_timestamp(),next_attempt_at=clock_timestamp(),attempts=CASE WHEN $2='pending' THEN 0 ELSE attempts END,updated_at=clock_timestamp() WHERE id=$1",[item.id,status,user.id]);
   await tx.q('INSERT INTO news_audit(actor_id,action,item_id) VALUES($1,$2,$3)',[user.id,input.action,item.id]);
  });
 }else fail(400,'Unknown newsroom action.');
 if(['source-add','source-add-many','source-toggle','source-remove'].includes(input.action))await db.q('UPDATE news_settings SET scan_dirty=true WHERE id=1');
 if(!['publish','reject','withdraw','retry'].includes(input.action))await db.q('INSERT INTO news_audit(actor_id,action) VALUES($1,$2)',[user.id,input.action]);
 return {ok:true};
}
export async function reserveNewsCost(db,kind,cents){
 if(!['x','ai'].includes(kind)||!Number.isInteger(cents)||cents<=0)throw Error('Invalid reservation');
 const [r]=await db.q(`INSERT INTO news_budget(day,reserved_cents,x_cents,ai_cents)
 SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date,$1,CASE WHEN $2='x' THEN $1 ELSE 0 END,CASE WHEN $2='ai' THEN $1 ELSE 0 END
 FROM news_settings WHERE id=1 AND enabled AND daily_budget_cents>=$1
 ON CONFLICT(day) DO UPDATE SET reserved_cents=news_budget.reserved_cents+EXCLUDED.reserved_cents,x_cents=news_budget.x_cents+EXCLUDED.x_cents,ai_cents=news_budget.ai_cents+EXCLUDED.ai_cents
 WHERE news_budget.reserved_cents+EXCLUDED.reserved_cents<=(SELECT daily_budget_cents FROM news_settings WHERE id=1 AND enabled) RETURNING day::text AS day`,[cents,kind]);
 if(!r)fail(503,'Newsroom allowance reached or automation paused.');
 return r.day;
}
