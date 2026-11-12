import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {newsAIConfig,newsAIStatus} from '../server/news-ai.js';
import {listNews,newsAdminState,newsAdminWrite,reserveNewsCost,newsHandle} from '../server/news.js';
import {initialNewsSources,newsSourceContext} from '../server/news-policy.js';
import {normalizeNewsPost,validNewsDraft,canAutoPublish,runNewsPipeline} from '../server/news-pipeline.js';
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
const draft={newsworthy:true,selection_reason:'Concrete product update.',kind:'news',highlights_en:['An updated block explorer with clearer transaction details.'],headings_en:['What changed'],category:'updates',risk:'low',title_en:'A clearer block explorer is now available',summary_en:'The account announced an updated explorer with improved transaction details and search.',body_en:['According to the account, the public test network has updated its block explorer with clearer transaction details and a new search tool.'],evidence:['clearer transaction details and a new search tool'],duplicate_of:null};
const verdict={supported:true,english:true,newsworthy:true,low_risk:true,confidence:97,reason:'The English story stays within the source announcement.'};
async function reset(){delete process.env.VYX_NEWS_AI_BASE_URL;delete process.env.VYX_NEWS_AI_MODEL;delete process.env.VYX_NEWS_AI_API_KEY;await db.q('DELETE FROM news_audit');await db.q('DELETE FROM news_items');await db.q('DELETE FROM news_sources');await db.q('DELETE FROM news_budget');await db.q("UPDATE news_settings SET enabled=false,auto_publish=true,daily_budget_cents=100,lease_token=NULL,lease_until=NULL,last_status='waiting-for-sources'");process.env.X_NEWS_BEARER_TOKEN='fixture-x';process.env.OPENAI_API_KEY='fixture-ai';}
async function source(){await newsAdminWrite(db,owner.user,{action:'source-add',username:'@example'});return (await db.q('SELECT * FROM news_sources'))[0];}
async function enable(){await newsAdminWrite(db,owner.user,{action:'settings',enabled:true,autoPublish:true,budgetCents:100});}
const post=(id='10000')=>({id,author_id:'123',text:sourceText,created_at:new Date().toISOString()});
function provider({d=draft,v=verdict,posts=[post()],next=null,onAI=async()=>{},endpoint='https://api.openai.com/v1/responses'}={}){
 const calls=[];let ai=0;
 const fetcher=async(url,options)=>{
  calls.push({url,options});assert.equal(options.redirect,'error');
  if(url.includes('/by/username/'))return new Response(JSON.stringify({data:{id:'123',username:'example'}}));
  if(url.includes('/tweets'))return new Response(JSON.stringify({data:posts,meta:next?{next_token:next}:{}}));
  assert.equal(url,endpoint);const payload=JSON.parse(options.body);assert.equal(payload.store,false);assert.equal(payload.text.format.strict,true);assert.ok(!Object.keys(payload.text.format.schema.properties).some(k=>k.endsWith('_ru')||k==='translations_match'));await onAI(++ai);
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
 await reset();await source();delete process.env.OPENAI_API_KEY;await assert.rejects(()=>enable(),/connect X and the AI service/);
 const cron=createNewsCronHandler(fn=>fn(db),()=>{throw Error('must not call');});assert.equal((await call(cron,{url:'/api/news-cron'})).status,401);
});
test('collection validates author, time, references and full source text',()=>{
 const s={x_user_id:'123',username:'example'};assert.ok(normalizeNewsPost(post(),s));assert.equal(normalizeNewsPost({...post(),author_id:'456'},s),null);assert.equal(normalizeNewsPost({...post(),created_at:'bad'},s),null);assert.equal(normalizeNewsPost({...post(),referenced_tweets:[{type:'retweeted'}]},s),null);assert.equal(normalizeNewsPost({...post(),text:sourceText+'…'},s),null);assert.equal(normalizeNewsPost({...post(),created_at:'2020-01-01'},s),null);
});
test('real-shaped pipeline publishes verified English news once, with a public source and no private data',async()=>{
 await reset();await source();await enable();const p=provider();assert.equal((await runNewsPipeline(db,p.fetcher)).processed,1);assert.equal(p.calls.length,4);
 const feed=await listNews(db);assert.equal(feed.articles.length,1);assert.equal(feed.articles[0].source.username,'example');assert.equal(feed.articles[0].title,draft.title_en);assert.ok(!JSON.stringify(feed).includes('source_text'));assert.ok(!JSON.stringify(feed).includes('fixture-'));
 const story=await listNews(db,{language:'ru',id:feed.articles[0].id});assert.equal(story.article.title,draft.title_en);assert.deepEqual(story.article.paragraphs,draft.body_en);assert.equal(story.article.publisher.name,'VYX');assert.equal(story.article.publisher.avatar,'/assets/vyx-mark-v1.png');assert.deepEqual(story.article.highlights,draft.highlights_en);assert.deepEqual(story.article.headings,draft.headings_en);
 await db.q('UPDATE news_sources SET next_fetch_at=clock_timestamp()');await runNewsPipeline(db,p.fetcher);assert.equal((await db.q('SELECT count(*)::int AS n FROM news_items'))[0].n,1);
 const budget=(await db.q('SELECT * FROM news_budget'))[0];assert.equal(budget.ai_cents,12);assert.equal(budget.x_cents,7);
 const admin=await newsAdminState(db,owner.user);assert.ok(!('lease_token' in admin.settings));assert.equal((await db.q('SELECT count(*)::int AS n FROM reward_ledger'))[0].n,0);
});
test('risky content, unverifiable evidence and non-English drafts are never auto-published',async()=>{
 assert.equal(canAutoPublish(draft,verdict,'Claim your free token airdrop now'),false);assert.equal(canAutoPublish(draft,{...verdict,english:false},sourceText),false);
 await reset();await source();await enable();await runNewsPipeline(db,provider({v:{...verdict,english:false,reason:'The draft is not in English.'}}).fetcher);
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
test('news readers remain present under the news section without receiving rewards',async()=>{
 const {touchPresence}=await import('../api/presence.js');await touchPresence(db,member.user,token(),'news');
 const [row]=await db.q('SELECT page FROM presence_sessions WHERE user_id=$1',[member.user.id]);assert.equal(row.page,'news');
});
test('ORBITA provider uses its own key, with both writing and verification sent only to its endpoint',async()=>{
 await reset();process.env.VYX_NEWS_AI_BASE_URL='https://triklz27.ru/v1';process.env.VYX_NEWS_AI_MODEL='gpt-6-luna';process.env.VYX_NEWS_AI_API_KEY='fixture-orbita-ai';
 await source();await enable();const p=provider({endpoint:'https://triklz27.ru/v1/responses'});await runNewsPipeline(db,p.fetcher);
 const calls=p.calls.filter(c=>c.options.method==='POST');assert.equal(calls.length,2);
 for(const c of calls){assert.equal(c.options.headers.Authorization,'Bearer fixture-orbita-ai');assert.equal(JSON.parse(c.options.body).model,'gpt-6-luna');}
 const state=await newsAdminState(db,owner.user);assert.equal(state.readiness.ai,true);assert.equal(state.readiness.provider,'ORBITA AI service');assert.ok(!JSON.stringify(state).includes('fixture-orbita-ai'));
 assert.equal((await listNews(db)).articles.length,1);assert.equal((await db.q('SELECT ai_cents FROM news_budget'))[0].ai_cents,2);
});
test('unapproved AI hosts, URL credentials, paths, ports and unpriced models fail closed without sending keys',async()=>{
 await reset();
 for(const base of ['http://triklz27.ru/v1','https://evil.invalid/v1','https://triklz27.ru.evil.invalid/v1','https://api.openai.com@evil.invalid/v1','https://secret@triklz27.ru/v1','https://triklz27.ru/v1?key=secret','https://triklz27.ru/v1#secret','https://triklz27.ru:444/v1','https://triklz27.ru/other']){
  process.env.VYX_NEWS_AI_BASE_URL=base;assert.equal(newsAIStatus().ready,false);assert.throws(()=>newsAIConfig());
 }
 process.env.VYX_NEWS_AI_BASE_URL='https://triklz27.ru/v1';delete process.env.VYX_NEWS_AI_API_KEY;assert.equal(newsAIStatus().ready,false,'An official OpenAI fallback key is not sent to the proxy');
 process.env.VYX_NEWS_AI_API_KEY='fixture-orbita-ai';process.env.VYX_NEWS_AI_MODEL='unpriced-model';assert.equal(newsAIStatus().ready,false);
 delete process.env.VYX_NEWS_AI_MODEL;process.env.VYX_NEWS_AI_API_KEY='bad\nheader';assert.equal(newsAIStatus().ready,false);
 await reset();
});

test('editorial migration is repeatable, preserves existing news, and permits market views',async()=>{
 await reset();await source();await enable();await runNewsPipeline(db,provider().fetcher);
 const before=await db.q('SELECT * FROM news_items');
 const sql=await readFile(new URL('../db/news-editorial.sql',import.meta.url),'utf8');await pg.exec(sql);await pg.exec(sql);
 assert.deepEqual(await db.q('SELECT * FROM news_items'),before);
 await db.q("UPDATE news_items SET category='markets'");
 await assert.rejects(()=>db.q("UPDATE news_items SET category='unknown'"),/check constraint/);
});
test('owner-selected sources are idempotent and do not restart monitoring',async()=>{
 await reset();for(let i=0;i<2;i++)for(const username of initialNewsSources)await newsAdminWrite(db,owner.user,{action:'source-add',username});
 const state=await newsAdminState(db,owner.user);assert.equal(state.sources.length,4);assert.equal(state.settings.enabled,false);
 assert.deepEqual(state.sources.map(s=>s.username).sort(),['blknoiz06','robinhoodapp','robinhoodcrypto','vladtenev']);
 assert.equal(newsSourceContext('RobinhoodApp').group,newsSourceContext('vladtenev').group);assert.notEqual(newsSourceContext('blknoiz06').group,newsSourceContext('vladtenev').group);
});
test('reasoned market views retain attribution, while guarantees and malformed presentation cannot publish',async()=>{
 await reset();await source();await enable();
 const text='My view: Bitcoin could see stronger demand if the announced institutional flows continue. The thesis depends on those flows holding; a reversal would undermine it.';
 const d={...draft,category:'markets',kind:'market-view',evidence:['The thesis depends on those flows holding'],title_en:'An account outlines a conditional Bitcoin demand thesis',summary_en:'The author links a possible rise in demand to continued institutional flows, while noting reversal risk.',body_en:['The author suggests Bitcoin demand could strengthen if institutional flows continue, and says a reversal would undermine the thesis.'],highlights_en:['A conditional market thesis, attributed to the source author.'],};
 assert.equal(validNewsDraft(d,text),true);assert.equal(validNewsDraft({...d,kind:'news'},text),false);assert.equal(validNewsDraft({...d,headings_en:[]},text),false);
 assert.equal(canAutoPublish(d,verdict,text),true);assert.equal(canAutoPublish(d,verdict,text+' Guaranteed returns.'),false);
 await runNewsPipeline(db,provider({d,posts:[{...post(),text}]}).fetcher);
 const [{id}]=await db.q('SELECT id FROM news_items');const {article}=await listNews(db,{id});assert.equal(article.kind,'market-view');assert.equal(article.category,'markets');assert.equal(article.publisher.name,'VYX');
});
test('rejected noise is terminal without verification and allows the next substantive post in the same cycle',async()=>{
 await reset();await source();await enable();
 const noise='This is going to the moon. Just watch this space and stay tuned for something absolutely huge.';
 const p=provider({posts:[{...post('10001'),text:noise},post()]});
 const fetcher=async(url,options)=>{
  if(options.method==='POST'&&JSON.parse(options.body).input.includes(noise))return new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({...draft,newsworthy:false,selection_reason:'Vague hype without a concrete update.',title_en:'',body_en:[]})}]}]}));
  return p.fetcher(url,options);
 };
 assert.equal((await runNewsPipeline(db,fetcher)).processed,2);
 const rejected=(await db.q("SELECT * FROM news_items WHERE x_post_id='10001'"))[0];assert.equal(rejected.status,'rejected');assert.equal(rejected.attempts,1);
 assert.equal((await listNews(db)).articles.length,1);assert.equal(p.calls.filter(c=>c.options.method==='POST').length,2);
 assert.equal((await db.q('SELECT ai_cents FROM news_budget'))[0].ai_cents,18);
 assert.equal(normalizeNewsPost({...post(),text:'gm '.repeat(25)},{x_user_id:'123',username:'example'}),null);
});
test('manual cycle is admin-only, respects pause, and uses the same spending and publication rules',async()=>{
 await reset();await source();const p=provider(),api=createNewsHandler(fn=>fn(db),p.fetcher);
 for(const [user,status] of [[null,401],[member,403]])assert.equal((await call(api,{method:'POST',user,input:{action:'run'}})).status,status);
 assert.equal((await call(api,{method:'POST',user:owner,origin:'https://evil.invalid',input:{action:'run'}})).status,403);
 assert.equal((await call(api,{method:'POST',user:owner,input:{action:'run'}})).data.status,'paused');assert.equal(p.calls.length,0);
 await enable();assert.equal((await call(api,{method:'POST',user:owner,input:{action:'run'}})).data.processed,1);assert.equal((await listNews(db)).articles.length,1);
 await db.q("UPDATE news_settings SET lease_until=clock_timestamp()+interval '1 minute'");assert.equal((await runNewsPipeline(db,p.fetcher)).status,'already-running');
});
test('source errors expose actionable status without leaking credentials or upstream content',async()=>{
 await reset();await source();await enable();await runNewsPipeline(db,async()=>new Response('private upstream content',{status:401}));
 const state=await newsAdminState(db,owner.user);assert.equal(state.sources[0].last_status,'x-authentication-required');assert.ok(!JSON.stringify(state).includes('private upstream content'));
});

test('legacy Russian query parameters cannot expose translated articles or presentation',async()=>{
 await reset();await source();await enable();await runNewsPipeline(db,provider().fetcher);
 const [{id}]=await db.q('SELECT id FROM news_items');
 await db.q("UPDATE news_items SET title_ru='Старый перевод',summary_ru='Русский текст',body_ru='[\"Русский абзац\"]'::jsonb,presentation=presentation||'{\"highlights_ru\":[\"Перевод\"],\"headings_ru\":[\"Заголовок\"]}'::jsonb");
 const api=createNewsHandler(fn=>fn(db));
 for(const suffix of ['', '&id='+id]){
  const result=await call(api,{url:'/api/news?language=ru'+suffix});assert.equal(result.status,200);
  const article=result.data.article||result.data.articles[0];assert.equal(article.language,'en');assert.equal(article.title,draft.title_en);assert.deepEqual(article.highlights,draft.highlights_en);
  assert.ok(!/[А-Яа-яЁё]/.test(JSON.stringify(result.data)));
 }
});
