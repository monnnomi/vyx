import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {login} from '../server/oauth.js';
import {listNews} from '../server/news.js';
import {listNewsComments,writeNewsComment} from '../server/news-comments.js';
import {createNewsHandler} from '../api/news.js';
const pg=new PGlite();await pg.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
const wrap=p=>({q:async(s,a=[])=>(await p.query(s,a)).rows,tx:fn=>p.transaction(t=>fn(wrap(t)))}),db=wrap(pg);
process.env.VYX_APP_SECRET='isolated-news-comments';process.env.VYX_ADMIN_X_IDS='1003';process.env.PUBLIC_APP_URL='https://joinvyx.com';
const alice=await db.tx(tx=>login(tx,{id:'1001',username:'alice',name:'Alice',avatar:''})),bob=await db.tx(tx=>login(tx,{id:'1002',username:'bob',name:'Bob',avatar:''})),admin=await db.tx(tx=>login(tx,{id:'1003',username:'admin',name:'Admin',avatar:''}));
const [source]=await db.q("INSERT INTO news_sources(username) VALUES('fixture') RETURNING id");
const [story]=await db.q("INSERT INTO news_items(source_id,x_post_id,source_url,source_text,source_published_at,content_hash,status,title_en,summary_en,published_at) VALUES($1,'10000','https://x.com/fixture/status/10000','Fixture',now(),'comments-fixture','published','Fixture story','Fixture story summary',now()) RETURNING id",[source.id]);
const api=createNewsHandler(fn=>fn(db),()=>{throw Error('Comment actions must not call X or AI');});
after(()=>pg.close());
async function reset(){await db.q('DELETE FROM news_comments');await db.q('DELETE FROM member_controls');await db.q('DELETE FROM rate_limits');await db.q("UPDATE news_items SET status='published' WHERE id=$1",[story.id]);}
const add=(user=alice.user,body='A thoughtful response.',extra={})=>writeNewsComment(db,user,{action:'comment-add',newsId:story.id,body,requestId:randomUUID(),...extra});
async function call({method='GET',user=null,input={},url='/api/news',origin='https://joinvyx.com'}={}){const req={method,url,headers:{origin,'content-type':'application/json','x-forwarded-for':'127.0.0.9',...(user?{cookie:'vyx_session='+user.sessionToken}:{})},body:input};const res={setHeader(){},end(body){this.body=JSON.parse(body);}};await api(req,res);return {status:res.statusCode,body:res.body};}
test('members can comment, edit only their own comments, and remove them without changing news or VP',async()=>{
 await reset();const beforePosts=(await db.q('SELECT count(*)::int n FROM posts'))[0].n;const c=await add();let view=await listNewsComments(db,alice.user,{id:story.id});assert.equal(view.total,1);assert.equal(view.comments[0].canEdit,true);assert.equal(view.comments[0].canDelete,true);assert.equal(view.comments[0].author.name,'Alice');assert.ok(!JSON.stringify(view).includes('sessionToken'));assert.ok(!JSON.stringify(view).includes('x_id'));
 await assert.rejects(()=>writeNewsComment(db,bob.user,{action:'comment-edit',newsId:story.id,id:c.id,body:'Hijack'}),e=>e.status===403);
 await assert.rejects(()=>writeNewsComment(db,bob.user,{action:'comment-delete',newsId:story.id,id:c.id}),e=>e.status===403);
 await writeNewsComment(db,alice.user,{action:'comment-edit',newsId:story.id,id:c.id,body:'Updated perspective.'});view=await listNewsComments(db,null,{id:story.id});assert.equal(view.comments[0].body,'Updated perspective.');assert.ok(view.comments[0].editedAt);assert.equal(view.comments[0].canEdit,false);
 assert.equal((await listNews(db)).articles[0].comments,1);assert.equal((await listNews(db,{id:story.id})).article.comments,1);
 await writeNewsComment(db,alice.user,{action:'comment-delete',newsId:story.id,id:c.id});await writeNewsComment(db,alice.user,{action:'comment-delete',newsId:story.id,id:c.id});assert.equal((await listNewsComments(db,null,{id:story.id})).total,0);assert.equal((await listNews(db)).articles[0].comments,0);
 await assert.rejects(()=>writeNewsComment(db,alice.user,{action:'comment-edit',newsId:story.id,id:c.id,body:'Restore deleted'}),e=>e.status===404);
 assert.equal((await db.q('SELECT count(*)::int n FROM reward_ledger'))[0].n,0);assert.equal((await db.q('SELECT count(*)::int n FROM news_budget'))[0].n,0);assert.equal((await db.q('SELECT count(*)::int n FROM posts'))[0].n,beforePosts);
});
test('administrator can moderate by deleting but cannot edit another member’s words',async()=>{
 await reset();const c=await add(bob.user);const view=await listNewsComments(db,admin.user,{id:story.id});assert.equal(view.comments[0].canEdit,false);assert.equal(view.comments[0].canDelete,true);
 await assert.rejects(()=>writeNewsComment(db,admin.user,{action:'comment-edit',newsId:story.id,id:c.id,body:'Rewrite Bob'}),e=>e.status===403);
 await writeNewsComment(db,admin.user,{action:'comment-delete',newsId:story.id,id:c.id});assert.equal((await listNewsComments(db,bob.user,{id:story.id})).comments.length,0);
});
test('retries are idempotent, cannot switch stories or bodies, and never recreate a deleted comment',async()=>{
 await reset();const requestId=randomUUID(),first=await add(alice.user,'Original response',{requestId});assert.equal((await add(alice.user,'Original response',{requestId})).id,first.id);
 await assert.rejects(()=>add(alice.user,'Different response',{requestId}),e=>e.status===409);
 await writeNewsComment(db,alice.user,{action:'comment-delete',newsId:story.id,id:first.id});assert.equal((await add(alice.user,'Original response',{requestId})).deleted,true);assert.equal((await db.q('SELECT count(*)::int n FROM news_comments'))[0].n,1);
});
test('hidden members are excluded from the thread and both story counters',async()=>{
 await reset();await add(alice.user);await add(bob.user);await db.q('INSERT INTO member_controls(user_id,target_id,muted) VALUES($1,$2,true)',[alice.user.id,bob.user.id]);
 assert.equal((await listNewsComments(db,alice.user,{id:story.id})).total,1);assert.equal((await listNews(db,{viewer:alice.user})).articles[0].comments,1);assert.equal((await listNews(db,{viewer:alice.user,id:story.id})).article.comments,1);assert.equal((await listNewsComments(db,null,{id:story.id})).total,2);
 await db.q('UPDATE member_controls SET muted=false,blocked=true WHERE user_id=$1',[alice.user.id]);assert.equal((await listNewsComments(db,bob.user,{id:story.id})).total,1);
});
test('only published stories have discussions; malformed, oversized and blank writes fail closed',async()=>{
 await reset();for(const body of ['','  ','x'.repeat(2001)])await assert.rejects(()=>add(alice.user,body),e=>e.status===400);
 await assert.rejects(()=>add(alice.user,'Valid text',{requestId:'invalid'}),e=>e.status===400);
 await db.q("UPDATE news_items SET status='withdrawn' WHERE id=$1",[story.id]);await assert.rejects(()=>listNewsComments(db,null,{id:story.id}),e=>e.status===404);await assert.rejects(()=>add(),e=>e.status===404);
});
test('pagination is stable with tied timestamps and returns every comment exactly once',async()=>{
 await reset();const stamp=new Date().toISOString();for(let i=0;i<65;i++)await db.q('INSERT INTO news_comments(news_id,user_id,body,request_id,created_at) VALUES($1,$2,$3,$4,$5)',[story.id,alice.user.id,'Comment '+i,randomUUID(),stamp]);
 const ids=[];let cursor=null;do{const page=await listNewsComments(db,null,{id:story.id,before:cursor});ids.push(...page.comments.map(c=>c.id));cursor=page.next;assert.equal(page.total,65);}while(cursor);
 assert.equal(ids.length,65);assert.equal(new Set(ids).size,65);
 await assert.rejects(()=>add(alice.user),e=>e.status===429);
});
test('API requires real sign-in, same origin, ownership and rate limits while leaving admin actions private',async()=>{
 await reset();const input={action:'comment-add',newsId:story.id,body:'Via the signed-in API',requestId:randomUUID()};
 assert.equal((await call({method:'POST',input})).status,401);assert.equal((await call({method:'POST',input,user:alice,origin:'https://evil.invalid'})).status,403);
 const sent=await call({method:'POST',input,user:alice});assert.equal(sent.status,200);assert.equal((await call({url:'/api/news?action=comments&id='+story.id})).body.total,1);
 assert.equal((await call({method:'POST',user:bob,input:{action:'comment-edit',newsId:story.id,id:sent.body.id,body:'Not mine'}})).status,403);
 assert.equal((await call({method:'POST',user:alice,input:{action:'source-add',username:'nope'}})).status,403);
 await db.q("INSERT INTO rate_limits(bucket,window_start,count) VALUES($1,floor(extract(epoch from now())/60)::bigint*60,30) ON CONFLICT(bucket,window_start) DO UPDATE SET count=30",['news-comments:'+alice.user.id]);assert.equal((await call({method:'POST',input:{...input,requestId:randomUUID()},user:alice})).status,429);
});
test('comment migration is repeatable and preserves existing discussions and article data',async()=>{
 await reset();await add();const before=await db.q('SELECT * FROM news_comments'),sql=await readFile(new URL('../db/news-comments.sql',import.meta.url),'utf8');await pg.exec(sql);await pg.exec(sql);assert.deepEqual(await db.q('SELECT * FROM news_comments'),before);
});
