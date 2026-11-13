import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {calculateNewsPacing,newsSpendState,reserveNewsCost,newsPublicationState} from '../server/news-budget.js';
import {reserveBatchRead,settleBatchRead,collectNewsBatches} from '../server/news-batch.js';
import {runNewsPipeline} from '../server/news-pipeline.js';
import {newsQueueHasWork,runNewsJobs} from '../server/news-jobs.js';
import {validNewsSelection} from '../server/news-selection.js';
const pg=new PGlite();await pg.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
let now=new Date();const today=now.toISOString().slice(0,10);
// Deterministic database clock in the isolated fixture, never production time overrides.
const wrap=p=>({q:async(s,a=[])=>(await p.query(s.replaceAll('clock_timestamp()',`TIMESTAMPTZ '${now.toISOString()}'`),a)).rows,tx:fn=>p.transaction(t=>fn(wrap(t)))}),db=wrap(pg);
const at=(hour,day=today)=>new Date(day+'T00:00:00Z').getTime()+hour*3600000;
process.env.X_NEWS_BEARER_TOKEN='fixture-x';process.env.VYX_NEWS_AI_BASE_URL='https://triklz27.ru/v1';process.env.VYX_NEWS_AI_MODEL='gpt-6-luna';process.env.VYX_NEWS_AI_API_KEY='fixture-ai';process.env.CRON_SECRET='fixture-cron';
after(()=>pg.close());
async function reset(hour=0.1){
 now=new Date(at(hour));
 for(const table of ['news_audit','news_comments','news_read_reservations','news_scan_batches','news_items','news_sources','news_budget'])await db.q('DELETE FROM '+table);
 await db.q("UPDATE news_settings SET pacing_enabled=true,enabled=true,auto_publish=true,collection_mode='batch',daily_budget_cents=100,lease_token=NULL,lease_until=NULL,scan_lease_token=NULL,scan_lease_until=NULL,scan_dirty=true");
 return (await db.q("INSERT INTO news_sources(username,x_user_id,next_fetch_at) VALUES('fixture','123',clock_timestamp()) RETURNING *"))[0];
}
const text='The project announced a new block explorer with clearer transaction details and a new search tool for developers.';
async function item(source,i,{noise=false,selected=false,age=0}={}){
 return (await db.q(`INSERT INTO news_items(source_id,x_post_id,source_url,source_text,source_published_at,content_hash,next_attempt_at,selection_next_at,selection_status)
  VALUES($1,$2,$3,$4,$5,$6,clock_timestamp(),clock_timestamp(),$7) RETURNING *`,[source.id,String(10000+i),'https://x.com/fixture/status/'+(10000+i),noise?'NOISE: A vague teaser with no identifiable product update or explained thesis.':text,new Date(now-age*60000),String(i),selected?'selected':'unchecked']))[0];
}
function provider({badSelection=false,failSelection=false,unsupported=false}={}){
 const calls=[];
 const fetcher=async(url,options)=>{
  assert.equal(url,'https://triklz27.ru/v1/responses');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer fixture-ai');
  const request=JSON.parse(options.body),payload=JSON.parse(request.input),name=request.text.format.name;calls.push({name,payload});
  let result;
  if(name==='vyx_news_selection'){
   if(failSelection)throw Object.assign(Error('private upstream detail'),{name:'TimeoutError'});
   result={decisions:payload.posts.map(p=>({id:badSelection?'foreign-id':p.id,newsworthy:!p.text.startsWith('NOISE'),score:90,reason:'Editorial selection based on the source.'}))};
   assert.equal(request.max_output_tokens,1800);
  }else if(name==='vyx_news_draft')result={newsworthy:true,selection_reason:'Concrete update',kind:'news',highlights_en:['An updated block explorer with clearer transaction details.'],headings_en:['What changed'],category:'updates',risk:'low',title_en:'The project announces an updated block explorer',summary_en:'The account announced clearer transaction details and a new explorer search tool.',body_en:['According to the account, the project announced a new block explorer with clearer transaction details and a new search tool for developers.'],evidence:['clearer transaction details'],duplicate_of:null};
  else result={supported:!unsupported,english:true,newsworthy:true,low_risk:true,confidence:98,reason:'The source supports the article.'};
  return new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(result)}]}]}));
 };return {fetcher,calls};
}
test('calendar release gives 12 cents per three hours, caps carry at 24, and leaves four cents unallocated',()=>{
 const state=(hour,windows=[])=>calculateNewsPacing({now:at(hour),limit:100,windows});
 assert.equal(state(0).remainingCents,12);assert.equal(state(2.99).remainingCents,12);
 assert.equal(state(3).remainingCents,24);assert.equal(state(21).remainingCents,24);
 assert.equal(state(3,[{slot:0,allowance_cents:12,reserved_cents:12}]).remainingCents,12);
 assert.equal(state(6,[{slot:0,allowance_cents:12,reserved_cents:0},{slot:1,allowance_cents:24,reserved_cents:0}]).remainingCents,24);
 assert.equal(state(21).safetyCents,4);assert.equal(state(21).endsAt,new Date(at(24)).toISOString());
});
test('concurrent X and AI reservations cannot consume a later window; every UTC day starts independently',async()=>{
 await reset();
 const result=await Promise.allSettled(Array.from({length:30},(_,i)=>reserveNewsCost(db,i%2?'ai':'x',1)));
 assert.equal(result.filter(r=>r.status==='fulfilled').length,12);assert.equal((await newsSpendState(db)).remainingCents,0);
 for(let hour=3;hour<24;hour+=3){now=new Date(at(hour));assert.equal((await newsSpendState(db)).remainingCents,12);await reserveNewsCost(db,'ai',12);}
 assert.equal((await db.q('SELECT reserved_cents FROM news_budget'))[0].reserved_cents,96);
 await assert.rejects(()=>reserveNewsCost(db,'x',1),/Three-hour/);
 now=new Date(at(24.1));assert.equal((await newsSpendState(db)).remainingCents,12);await reserveNewsCost(db,'ai',1);
 assert.deepEqual((await db.q('SELECT reserved_cents FROM news_budget ORDER BY day')).map(r=>r.reserved_cents),[96,1]);
});
test('a pre-existing exhausted day stays exhausted after the additive migration',async()=>{
 await reset();await db.q('INSERT INTO news_budget(day,reserved_cents,x_cents,ai_cents) VALUES($1,100,59,41)',[today]);
 const before=await db.q('SELECT * FROM news_budget');const sql=await readFile(new URL('../db/news-pacing.sql',import.meta.url),'utf8');await pg.exec(sql);await pg.exec(sql);
 assert.deepEqual(await db.q('SELECT * FROM news_budget'),before);await assert.rejects(()=>reserveNewsCost(db,'ai',1),/Daily/);
 let calls=0;const result=await runNewsJobs(db,()=>{calls++;throw Error('must not fetch');});assert.equal(calls,0);assert.equal(result.processed,0);assert.equal(await newsQueueHasWork(db),false);
});
test('read refunds belong to their original window and cannot retroactively enlarge an opened later window',async()=>{
 await reset();const id=await reserveBatchRead(db,5);now=new Date(at(3.1));await reserveNewsCost(db,'ai',1);
 let state=await newsSpendState(db);assert.equal(state.allowanceCents,19);assert.equal(state.remainingCents,18);
 await settleBatchRead(db,id,0);await settleBatchRead(db,id,0);state=await newsSpendState(db);assert.equal(state.allowanceCents,19);assert.equal(state.remainingCents,18);
 assert.equal((await db.q('SELECT reserved_cents FROM news_budget'))[0].reserved_cents,1);
 assert.equal((await db.q('SELECT reserved_cents FROM news_budget_windows WHERE slot=0'))[0].reserved_cents,0);
});
test('failed reads retain their window reservation and the writer hold stops a collection burst',async()=>{
 const source=await reset(new Date().getUTCHours()+0.01);let calls=0;
 await collectNewsBatches(db,()=>{calls++;return new Response('{}',{status:503});});
 assert.equal(calls,1);assert.equal((await db.q('SELECT x_cents FROM news_budget'))[0].x_cents,5);
 await reserveNewsCost(db,'ai',(await newsSpendState(db)).remainingCents-2);
 await db.q('UPDATE news_scan_batches SET next_fetch_at=clock_timestamp()');await collectNewsBatches(db,()=>{calls++;throw Error('must not fetch');});assert.equal(calls,1);
});
test('batch selection rejects eight noisy posts for one AI reservation without writing eight articles',async()=>{
 const s=await reset();for(let i=0;i<8;i++)await item(s,i,{noise:true,age:i});const p=provider();
 const result=await runNewsPipeline(db,p.fetcher,{collectPosts:false});assert.equal(result.processed,0);assert.equal(result.selection.rejected,8);assert.deepEqual(p.calls.map(c=>c.name),['vyx_news_selection']);
 assert.equal((await db.q('SELECT ai_cents FROM news_budget'))[0].ai_cents,1);assert.equal((await db.q("SELECT count(*)::int n FROM news_items WHERE status='rejected'"))[0].n,8);
 assert.equal((await db.q('SELECT sum(attempts)::int n FROM news_items'))[0].n,0);
});
test('fresh queued posts are considered first and only the chosen story receives drafting and verification',async()=>{
 const s=await reset();await item(s,0,{age:60});const fresh=await item(s,1,{age:1});const p=provider();
 const result=await runNewsPipeline(db,p.fetcher,{collectPosts:false});assert.equal(result.processed,1);
 assert.equal(p.calls[0].payload.posts[0].id,fresh.id);assert.deepEqual(p.calls.map(c=>c.name),['vyx_news_selection','vyx_news_draft','vyx_news_verification']);
 assert.equal((await db.q("SELECT id FROM news_items WHERE status='published'"))[0].id,fresh.id);
 const before=p.calls.length;assert.equal((await runNewsPipeline(db,p.fetcher,{collectPosts:false})).status,'publication-window-wait');assert.equal(p.calls.length,before);
});
test('malformed or failed batch selection neither invents decisions nor spins a worker chain',async()=>{
 for(const options of [{badSelection:true},{failSelection:true}]){
  const s=await reset();await item(s,1);const p=provider(options);await runNewsPipeline(db,p.fetcher,{collectPosts:false});
  const [row]=await db.q('SELECT status,selection_status,selection_attempts,attempts,selection_next_at FROM news_items');
  assert.equal(row.status,'pending');assert.equal(row.selection_status,'unchecked');assert.equal(row.selection_attempts,1);assert.equal(row.attempts,0);assert.ok(new Date(row.selection_next_at)>now);
  assert.equal(await newsQueueHasWork(db),true,'the as-yet-unscanned source can still need collection');
  await db.q("UPDATE news_settings SET scan_dirty=false");await db.q("UPDATE news_sources SET next_fetch_at=clock_timestamp()+interval '1 day'");
  assert.equal(await newsQueueHasWork(db),false);assert.equal((await db.q('SELECT ai_cents FROM news_budget'))[0].ai_cents,1);
 }
 assert.equal(validNewsSelection({decisions:[{id:'other',newsworthy:true,score:100,reason:'Injected ID'}]},[{id:'real'}]),false);
});
test('quarter-hour processing over a full day spreads six publications into six four-hour slots',async()=>{
 const s=await reset();for(let i=0;i<8;i++)await item(s,i,{age:i});const p=provider();
 for(let quarter=0;quarter<96;quarter++){
  now=new Date(at(quarter/4+0.01));await runNewsPipeline(db,p.fetcher,{collectPosts:false});
 }
 const rows=await db.q("SELECT published_at FROM news_items WHERE status='published' ORDER BY published_at");
 assert.equal(rows.length,6);assert.deepEqual(rows.map(r=>new Date(r.published_at).getUTCHours()),[0,4,8,12,16,20]);
 assert.equal(p.calls.filter(c=>c.name==='vyx_news_selection').length,1,'selection is durable across windows');
 assert.equal((await db.q('SELECT ai_cents FROM news_budget'))[0].ai_cents,13);
 assert.equal((await newsPublicationState(db)).allowed,false);
 assert.equal((await db.q('SELECT count(*)::int n FROM reward_ledger'))[0].n,0);
});
test('insufficient current funds do not consume draft attempts or make external requests',async()=>{
 const s=await reset();await item(s,1,{selected:true});await reserveNewsCost(db,'x',12);let calls=0;
 const result=await runNewsPipeline(db,()=>{calls++;},{collectPosts:false});assert.equal(result.status,'budget-window-wait');assert.equal(calls,0);
 assert.equal((await db.q('SELECT attempts FROM news_items'))[0].attempts,0);assert.equal(await newsQueueHasWork(db),false);
});
