import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {listNews,newsAdminState,newsAdminWrite,reserveNewsCost,newsHandle} from '../server/news.js';
import {normalizeNewsPost,canAutoPublish,runNewsPipeline} from '../server/news-pipeline.js';
import {createNewsHandler} from '../api/news.js';
import {createNewsCronHandler} from '../api/news-cron.js';
import {login} from '../server/oauth.js';
import {token} from '../server/http.js';
const pg=new PGlite();await pg.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
const wrap=p=>({q:async(s,a=[])=>(await p.query(s,a)).rows,tx:fn=>p.transaction(t=>fn(wrap(t)))}),db=wrap(pg);
process.env.VYX_APP_SECRET=token();process.env.VYX_ADMIN_X_IDS='1001';process.env.PUBLIC_APP_URL='https://joinvyx.com';process.env.CRON_SECRET=token();
const owner=await db.tx(tx=>login(tx,{id:'1001',username:'owner',name:'Owner',avatar:''})),member=await db.tx(tx=>login(tx,{id:'1002',username:'member',name:'Member',avatar:''}));
after(()=>pg.close());
const sourceText='The public test network now supports a faster block explorer. The updated interface includes clearer transaction details and a new search tool for developers.';
const draft={newsworthy:true,category:'updates',risk:'low',title_en:'A clearer block explorer is now available',title_ru:'В тестовой сети обновили обозреватель блоков',summary_en:'The account announced an updated explorer with improved transaction details and search.',summary_ru:'Аккаунт сообщил об обновлении обозревателя: улучшены данные транзакций и поиск.',body_en:['According to the account, the public test network has updated its block explorer with clearer transaction details and a new search tool.'],body_ru:['По сообщению аккаунта, в публичной тестовой сети обновили обозреватель блоков, добавив более понятные данные транзакций и новый поиск.'],evidence:['clearer transaction details and a new search tool'],duplicate_of:null};
const verdict={supported:true,translations_match:true,newsworthy:true,low_risk:true,confidence:97,reason:'Both versions stay within the source announcement.'};
async function reset(){await db.q('DELETE FROM news_audit');await db.q('DELETE FROM news_items');await db.q('DELETE FROM news_sources');await db.q('DELETE FROM news_budget');await db.q("UPDATE news_settings SET enabled=false,auto_publish=true,daily_budget_cents=100,lease_token=NULL,lease_until=NULL,last_status='waiting-for-sources'");process.env.X_NEWS_BEARER_TOKEN='fixture-x';process.env.OPENAI_API_KEY='fixture-ai';}
async function source(){await newsAdminWrite(db,owner.user,{action:'source-add',username:'@example'});return (await db.q('SELECT * FROM news_sources'))[0];}
async function enable(){await newsAdminWrite(db,owner.user,{action:'settings',enabled:true,autoPublish:true,budgetCents:100});}
const post=(id='10000')=>({id,author_id:'123',text:sourceText,created_at:new Date().toISOString()});
function provider({d=draft,v=verdict,posts=[post()],next=null,onAI=async()=>{}}={}){
 const calls=[];let ai=0;
 const fetcher=async(url,options)=>{
  calls.push({url,options});assert.equal(options.redirect,'error');
  if(url.includes('/by/username/'))return new Response(JSON.stringify({data:{id:'123',username:'example'}}));
  if(url.includes('/tweets'))return new Response(JSON.stringify({data:posts,meta:next?{next_token:next}:{}}));
  assert.equal(url,'https://api.openai.com/v1/responses');const payload=JSON.parse(options.body);assert.equal(payload.store,false);assert.equal(payload.text.format.strict,true);await onAI(++ai);
  return new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(ai%2?d:v)}]}]}));
 };return {calls,fetcher};
}
async function call(handler,{method='GET',url='/api/news',user=null,origin='https://joinvyx.com',input={}}={}){
 const req={method,url,headers:{origin,'content-type':'application/json',...(user?{cookie:'vyx_session='+user.sessionToken}:{})},body:input};
 const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(v){this.value=v;}};await handler(req,res);return {status:res.statusCode||200,data:JSON.parse(res.value)};
}
test('newsroom migration is repeatable and existing VP/accounts remain untouched',async()=>{
 const before=(await db.q('SELECT count(*)::int AS n FROM users'))[0];await pg.exec(await readFile(new URL('../db/news.sql',import.meta.url),'utf8'));assert.deepEqual((await db.q('SELECT count(*)::int AS n FROM users'))[0],before);assert.equal((await db.q('SELECT enabled FROM news_settings'))[0].enabled,false);
});
test('no sources or paused newsroom means no external requests',async()=>{
 await reset();let calls=0;assert.equal((await runNewsPipeline(db,()=>{calls++;})).status,'waiting-for-sources');await source();assert.equal((await runNewsPipeline(db,()=>{calls++;})).status,'paused');assert.equal(calls,0);
});
test('only allowlisted admins can manage sources, drafts or automation; POST requires same origin',async()=>{
 await reset();const api=createNewsHandler(fn=>fn(db));
 for(const [user,status] of [[null,401],[member,403]]){assert.equal((await call(api,{url:'/api/news?admin=1',user})).status,status);assert.equal((await call(api,{method:'POST',user,input:{action:'source-add',username:'example'}})).status,status);}
 assert.equal((await call(api,{method:'POST',origin:'https://evil.invalid',user:owner,input:{action:'source-add',username:'example'}})).status,403);
 assert.equal((await call(api)).status,200);assert.deepEqual((await call(api)).data.articles,[]);
 assert.equal(newsHandle('https://x.com/Example'),'example');for(const s of ['https://evil.invalid/a','example?secret=1','a/b','x'.repeat(16)])assert.throws(()=>newsHandle(s));
});
test('cron requires its secret and missing credentials cannot enable collection',async()=>{
 await reset();await source();delete process.env.OPENAI_API_KEY;await assert.rejects(()=>enable(),/connect X and OpenAI/);
 const cron=createNewsCronHandler(fn=>fn(db),()=>{throw Error('must not call');});assert.equal((await call(cron,{url:'/api/news-cron'})).status,401);
});
test('collection validates author, time, references and full source text',()=>{
 const s={x_user_id:'123',username:'example'};assert.ok(normalizeNewsPost(post(),s));assert.equal(normalizeNewsPost({...post(),author_id:'456'},s),null);assert.equal(normalizeNewsPost({...post(),created_at:'bad'},s),null);assert.equal(normalizeNewsPost({...post(),referenced_tweets:[{type:'retweeted'}]},s),null);assert.equal(normalizeNewsPost({...post(),text:sourceText+'…'},s),null);assert.equal(normalizeNewsPost({...post(),created_at:'2020-01-01'},s),null);
});
test('real-shaped pipeline publishes verified bilingual news once, with a public source and no private data',async()=>{
 await reset();await source();await enable();const p=provider();assert.equal((await runNewsPipeline(db,p.fetcher)).processed,1);assert.equal(p.calls.length,4);
 const feed=await listNews(db);assert.equal(feed.articles.length,1);assert.equal(feed.articles[0].source.username,'example');assert.equal(feed.articles[0].title,draft.title_en);assert.ok(!JSON.stringify(feed).includes('source_text'));assert.ok(!JSON.stringify(feed).includes('fixture-'));
 const story=await listNews(db,{language:'ru',id:feed.articles[0].id});assert.equal(story.article.title,draft.title_ru);assert.deepEqual(story.article.paragraphs,draft.body_ru);
 await db.q('UPDATE news_sources SET next_fetch_at=clock_timestamp()');await runNewsPipeline(db,p.fetcher);assert.equal((await db.q('SELECT count(*)::int AS n FROM news_items'))[0].n,1);
 const budget=(await db.q('SELECT * FROM news_budget'))[0];assert.equal(budget.ai_cents,12);assert.equal(budget.x_cents,7);
 const admin=await newsAdminState(db,owner.user);assert.ok(!('lease_token' in admin.settings));assert.equal((await db.q('SELECT count(*)::int AS n FROM reward_ledger'))[0].n,0);
});
test('risky content, unverifiable evidence and translation mismatches are never auto-published',async()=>{
 assert.equal(canAutoPublish(draft,verdict,'Claim your free token airdrop now'),false);assert.equal(canAutoPublish(draft,{...verdict,translations_match:false},sourceText),false);
 await reset();await source();await enable();await runNewsPipeline(db,provider({v:{...verdict,translations_match:false,reason:'Different numbers in translation.'}}).fetcher);
 const [i]=await db.q('SELECT * FROM news_items');assert.equal(i.status,'review');assert.equal((await listNews(db)).articles.length,0);await assert.rejects(()=>newsAdminWrite(db,owner.user,{action:'publish',id:i.id}),/complete, source-checked/);
 await reset();await source();await enable();await runNewsPipeline(db,provider({d:{...draft,evidence:['This is not in the source post.']}}).fetcher);assert.equal((await listNews(db)).articles.length,0);
});
test('atomic reservations stop external spending at the cap and pause stops in-flight publication',async()=>{
 await reset();await source();await enable();await db.q('UPDATE news_settings SET daily_budget_cents=5');await reserveNewsCost(db,'x',3);await assert.rejects(()=>reserveNewsCost(db,'ai',6),/allowance/);assert.equal((await db.q('SELECT reserved_cents FROM news_budget'))[0].reserved_cents,3);
 await reset();await source();await enable();await runNewsPipeline(db,provider({onAI:async n=>{if(n===2)await db.q('UPDATE news_settings SET enabled=false');}}).fetcher);assert.equal((await db.q('SELECT status FROM news_items'))[0].status,'review');
});
test('pagination does not advance the collection watermark until all pages are imported',async()=>{
 await reset();await source();await enable();await runNewsPipeline(db,provider({next:'page-two'}).fetcher);let [s]=await db.q('SELECT * FROM news_sources');assert.equal(s.since_id,null);assert.equal(s.pending_since_id,'10000');assert.equal(s.pagination_token,'page-two');
 const p=provider({posts:[post('9999')]});await runNewsPipeline(db,p.fetcher);assert.ok(p.calls[0].url.includes('pagination_token=page-two'));[s]=await db.q('SELECT * FROM news_sources');assert.equal(s.since_id,'10000');assert.equal(s.pagination_token,null);
});
test('manual review publishes supported drafts and withdrawal hides them without deleting history',async()=>{
 await reset();await source();await enable();await db.q('UPDATE news_settings SET auto_publish=false');await runNewsPipeline(db,provider().fetcher);const [i]=await db.q('SELECT * FROM news_items');assert.equal(i.status,'review');
 await newsAdminWrite(db,owner.user,{action:'publish',id:i.id});assert.equal((await listNews(db)).articles.length,1);await newsAdminWrite(db,owner.user,{action:'withdraw',id:i.id});assert.equal((await listNews(db)).articles.length,0);await assert.rejects(()=>listNews(db,{id:i.id}),/not available/);assert.equal((await db.q('SELECT count(*)::int AS n FROM news_audit WHERE item_id=$1',[i.id]))[0].n,2);
});
test('news schedule is hourly UTC and separate from the six unchanged farm triggers',async()=>{
 const v=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
 const crons=v.crons.filter(c=>c.path.startsWith('/api/news-cron/'));
 assert.deepEqual(crons.map(c=>c.schedule),Array.from({length:24},(_,h)=>`25 ${h} * * *`));assert.equal(new Set(v.crons.map(c=>c.path)).size,30);
});
