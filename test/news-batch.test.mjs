import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {buildNewsBatches,collectNewsBatches,reserveBatchRead,settleBatchRead} from '../server/news-batch.js';
import {newsAdminWrite,newsAdminState,reserveNewsCost} from '../server/news.js';
import {runNewsJobs,newsQueueHasWork,dispatchNewsQueue} from '../server/news-jobs.js';
import {createNewsCronHandler} from '../api/news-cron.js';
import {login} from '../server/oauth.js';
const pg=new PGlite();await pg.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
const wrap=p=>({q:async(s,a=[])=>(await p.query(s,a)).rows,tx:fn=>p.transaction(t=>fn(wrap(t)))}),db=wrap(pg);
process.env.VYX_APP_SECRET='fixture-secret';process.env.VYX_ADMIN_X_IDS='9001';process.env.X_NEWS_BEARER_TOKEN='fixture-x';process.env.OPENAI_API_KEY='fixture-ai';process.env.CRON_SECRET='fixture-cron';process.env.PUBLIC_APP_URL='https://joinvyx.com';
const owner=await db.tx(tx=>login(tx,{id:'9001',username:'owner',name:'Owner',avatar:''}));
after(()=>pg.close());
async function reset(n=0){
 await db.q('DELETE FROM news_audit');await db.q('DELETE FROM news_read_reservations');await db.q('DELETE FROM news_scan_batches');await db.q('DELETE FROM news_items');await db.q('DELETE FROM news_sources');await db.q('DELETE FROM news_budget');
 await db.q("UPDATE news_settings SET enabled=true,collection_mode='batch',daily_budget_cents=100,scan_dirty=true,lease_until=NULL,scan_lease_until=NULL");
 for(let i=0;i<n;i++)await db.q('INSERT INTO news_sources(username,x_user_id) VALUES($1,$2)',['account_'+String(i).padStart(3,'0'),String(1000+i)]);
 return db.q('SELECT * FROM news_sources ORDER BY username');
}
function mockSearch(sources,{count=0,next=null,status=200,wrongAuthor=false}={}){
 const calls=[];
 const fetcher=async(raw,opts)=>{
  const u=new URL(raw);calls.push({u,opts});assert.equal(opts.redirect,'error');assert.equal(opts.headers.Authorization,'Bearer fixture-x');
  assert.equal(u.pathname,'/2/tweets/search/recent');assert.equal(u.searchParams.get('max_results'),'10');assert.equal(u.searchParams.get('sort_order'),'recency');
  const source=sources.find(s=>u.searchParams.get('query').includes('from:'+s.username));
  const data=Array.from({length:count},(_,i)=>({id:String(BigInt(source.x_user_id)*100n+BigInt(i)),author_id:wrongAuthor?'999999':source.x_user_id,created_at:new Date().toISOString(),text:source.username+' announced a new developer release with clearer transaction details and an improved search interface. Version '+i}));
  return new Response(JSON.stringify({data,meta:next?{next_token:next}:{}}),{status});
 };return {fetcher,calls};
}
test('100 accounts form five bounded queries and every batch is checked in the same collection pass',async()=>{
 const sources=await reset(100),batches=buildNewsBatches(sources);assert.equal(batches.length,5);assert.ok(batches.every(b=>b.query.length<=512));assert.equal(new Set(batches.flatMap(b=>b.members.map(s=>s.id))).size,100);
 const p=mockSearch(sources);assert.equal((await collectNewsBatches(db,p.fetcher)).collected,5);assert.equal(p.calls.length,5);assert.equal((await db.q("SELECT count(*)::int AS n FROM news_sources WHERE last_status='ok'"))[0].n,100);
 assert.equal((await db.q('SELECT reserved_cents FROM news_budget'))[0].reserved_cents,0);assert.equal(await newsQueueHasWork(db),false);
 await collectNewsBatches(db,p.fetcher);assert.equal(p.calls.length,5,'no duplicate scan before the interval');
});
test('successful reads reconcile actual returned posts, and duplicate settlements cannot refund twice',async()=>{
 await reset();const op=await reserveBatchRead(db,5);await settleBatchRead(db,op,3);await settleBatchRead(db,op,0);
 assert.equal((await db.q('SELECT reserved_cents FROM news_budget'))[0].reserved_cents,2);
});
test('failed or incomplete requests retain reservations, never advance cursors, and back off',async()=>{
 const sources=await reset(2),p=mockSearch(sources,{status:503});await collectNewsBatches(db,p.fetcher);
 assert.equal((await db.q('SELECT reserved_cents FROM news_budget'))[0].reserved_cents,5);const [batch]=await db.q('SELECT * FROM news_scan_batches');assert.equal(batch.since_id,null);assert.equal(batch.last_status,'x-http-503');assert.ok(new Date(batch.next_fetch_at)>new Date());
 await collectNewsBatches(db,p.fetcher);assert.equal(p.calls.length,1);
});
test('batch pagination holds the high-water mark until all pages are imported and queues each post once',async()=>{
 const sources=await reset(2),first=mockSearch(sources,{count:2,next:'page2'});await collectNewsBatches(db,first.fetcher);
 let [batch]=await db.q('SELECT * FROM news_scan_batches');assert.equal(batch.since_id,null);assert.ok(batch.pending_since_id);assert.equal(batch.pagination_token,'page2');assert.equal(await newsQueueHasWork(db),true);
 const second=mockSearch(sources,{count:2});await collectNewsBatches(db,second.fetcher);assert.equal(second.calls[0].u.searchParams.get('next_token'),'page2');[batch]=await db.q('SELECT * FROM news_scan_batches');assert.equal(batch.since_id,batch.pending_since_id||'100001');assert.equal(batch.pagination_token,null);assert.equal((await db.q('SELECT count(*)::int AS n FROM news_items'))[0].n,2);
});
test('a foreign author cannot enter the queue or advance a batch cursor',async()=>{
 const sources=await reset(1);await collectNewsBatches(db,mockSearch(sources,{count:1,wrongAuthor:true}).fetcher);assert.equal((await db.q('SELECT count(*)::int AS n FROM news_items'))[0].n,0);assert.equal((await db.q('SELECT since_id FROM news_scan_batches'))[0].since_id,null);
});
test('collection reserves funds before requests and keeps part of the budget for the writer',async()=>{
 const sources=await reset(100);await reserveNewsCost(db,'ai',76);const p=mockSearch(sources,{count:10});await collectNewsBatches(db,p.fetcher);assert.equal(p.calls.length,0);assert.equal((await db.q('SELECT reserved_cents FROM news_budget'))[0].reserved_cents,76);
});
test('unknown account identities are cached, verified and paid once; lookup failure does not spin a worker chain',async()=>{
 await reset();await db.q("INSERT INTO news_sources(username) VALUES('newaccount')");let calls=0;
 await collectNewsBatches(db,async(raw)=>{calls++;if(raw.includes('/users/by?'))return new Response(JSON.stringify({data:[{username:'newaccount',id:'1009'}]}));return new Response(JSON.stringify({data:[]}));});
 assert.equal(calls,2);assert.equal((await db.q('SELECT x_user_id FROM news_sources'))[0].x_user_id,'1009');assert.equal((await db.q('SELECT reserved_cents FROM news_budget'))[0].reserved_cents,1);
 await reset();await db.q("INSERT INTO news_sources(username) VALUES('badaccount')");await collectNewsBatches(db,async()=>new Response('{}',{status:404}));assert.equal(await newsQueueHasWork(db),false);
});
test('bulk source updates are atomic, deduplicate names, and enforce 100 active sources including restored accounts',async()=>{
 await reset();await newsAdminWrite(db,owner.user,{action:'source-add-many',usernames:Array.from({length:100},(_,i)=>'@account_'+String(i).padStart(3,'0')).join('\n')});
 assert.equal((await db.q('SELECT count(*)::int AS n FROM news_sources'))[0].n,100);await assert.rejects(()=>newsAdminWrite(db,owner.user,{action:'source-add-many',usernames:'@another @bad-name'}));assert.equal((await db.q('SELECT count(*)::int AS n FROM news_sources'))[0].n,100);
 await assert.rejects(()=>newsAdminWrite(db,owner.user,{action:'source-add',username:'another'}),/100 sources/);await newsAdminWrite(db,owner.user,{action:'source-add',username:'account_000'});
 const [old]=await db.q("SELECT id FROM news_sources WHERE username='account_000'");await newsAdminWrite(db,owner.user,{action:'source-remove',id:old.id});await newsAdminWrite(db,owner.user,{action:'source-add',username:'another'});await assert.rejects(()=>newsAdminWrite(db,owner.user,{action:'source-add',username:'account_000'}),/100 sources/);
 const state=await newsAdminState(db,owner.user);assert.ok(!('scan_lease_token' in state.settings));
});
test('worker endpoint rejects outsiders and acknowledges authorized work before the background completes',async()=>{
 const tasks=[],api=createNewsCronHandler(fn=>fn(db),async()=>{throw Error('unexpected network')},p=>tasks.push(p));
 const call=async headers=>{const res={setHeader(){},end(s){this.body=JSON.parse(s);}};await api({method:'POST',headers},res);return res;};
 assert.equal((await call({})).statusCode,401);assert.equal(tasks.length,0);await reset();await db.q('UPDATE news_settings SET enabled=false');assert.equal((await call({authorization:'Bearer fixture-cron'})).statusCode,202);await Promise.all(tasks);
});
test('batch migration is repeatable and preserves existing news and VP',async()=>{
 const before=await db.q('SELECT count(*)::int AS n FROM users'),sql=await readFile(new URL('../db/news-batch.sql',import.meta.url),'utf8');await pg.exec(sql);await pg.exec(sql);assert.deepEqual(await db.q('SELECT count(*)::int AS n FROM users'),before);
});

test('batch collection feeds the writer immediately and dispatches remaining work only to the authenticated app worker',async()=>{
 const sources=await reset(2),p=mockSearch(sources,{count:2}),dispatches=[];
 const draft={newsworthy:true,selection_reason:'Product release.',kind:'news',highlights_en:['A clearer transaction search interface is available.'],headings_en:['What changed'],category:'updates',risk:'low',title_en:'A clearer transaction search interface is available',summary_en:'The account announced a developer release with clearer transaction details and improved search.',body_en:['The account announced a new developer release with clearer transaction details and an improved search interface.'],evidence:['clearer transaction details'],duplicate_of:null};
 const verdict={supported:true,english:true,newsworthy:true,low_risk:true,confidence:98,reason:'The source supports the article.'};
 const fetcher=async(raw,options)=>{
  if(raw==='https://joinvyx.com/api/news-cron'){dispatches.push(options);assert.equal(options.method,'POST');return new Response('{}',{status:202});}
  if(raw.startsWith('https://api.x.com/'))return p.fetcher(raw,options);
  const request=JSON.parse(options.body),result=request.text.format.name==='vyx_news_draft'?draft:verdict;
  return new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(result)}]}]}));
 };
 const first=await runNewsJobs(db,fetcher);assert.equal(first.scan.collected,1);assert.equal(first.processed,1);assert.equal((await db.q("SELECT count(*)::int AS n FROM news_items WHERE status='published'"))[0].n,1);
 await dispatchNewsQueue(db,fetcher);assert.equal(dispatches.length,1);assert.equal(dispatches[0].headers.Authorization,'Bearer fixture-cron');
 await db.q('UPDATE news_settings SET enabled=false');await dispatchNewsQueue(db,fetcher);assert.equal(dispatches.length,1);
});
test('concurrent reservations never cross the daily ceiling, including failed requests',async()=>{
 await reset();const results=await Promise.allSettled(Array.from({length:30},()=>reserveBatchRead(db,5)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,20);assert.equal((await db.q('SELECT reserved_cents FROM news_budget'))[0].reserved_cents,100);
});
