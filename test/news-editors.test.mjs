import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createNewsHandler} from '../api/news.js';
import {createNewsCronHandler} from '../api/news-cron.js';
import {login} from '../server/oauth.js';

const pg=new PGlite();
await pg.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
after(()=>pg.close());
const wrap=p=>({q:async(s,a=[])=>(await p.query(s,a)).rows,tx:fn=>p.transaction(t=>fn(wrap(t)))}),db=wrap(pg);
process.env.VYX_ADMIN_X_IDS='2041';
process.env.PUBLIC_APP_URL='https://joinvyx.com';
process.env.VYX_APP_SECRET='local-news-test';
const account=(id,name)=>db.tx(tx=>login(tx,{id,name,username:name,avatar:''}));
const owner=await account('2041','editor'),member=await account('2042','writer'),reader=await account('2043','reader');
const api=createNewsHandler(fn=>fn(db));
async function request(who,input=null,path='/api/news'){
 const res={setHeader(){},end(s){this.data=JSON.parse(s);}};
 await api({url:path,method:input?'POST':'GET',headers:{origin:process.env.PUBLIC_APP_URL,'content-type':'application/json',cookie:who?'vyx_session='+who.sessionToken:''},body:input},res);
 return {status:res.statusCode,...res.data};
}
const story=()=>({action:'story-create',id:randomUUID(),category:'reviews',title:'A closer look',summary:'What changed this week',body:'First paragraph.\n\nSecond paragraph.',source:'https://example.org/demo'});

test('editorial permissions, bylines, retries, editing, comments and revocation through the HTTP handler',async()=>{
 const article=story(),staff=story();
 assert.equal((await request(null)).canPublish,false);
 assert.equal((await request(reader,article)).status,403);
 assert.equal((await request(member,{action:'author-grant',handle:member.user.handle})).status,403);
 assert.equal((await request(owner)).canPublish,true);
 assert.equal((await request(owner,staff)).status,200);
 const read=(who,id)=>request(who,null,'/api/news?id='+id);
 assert.equal((await read(null,staff.id)).article.publisher.name,'VYX');
 assert.equal((await request(owner,{action:'author-grant',handle:'@'+member.user.handle})).status,200);
 assert.equal((await request(member)).canPublish,true);
 assert.equal((await request(member,{...article,source:'javascript:alert(1)'})).status,400);
 assert.equal((await request(member,article)).status,200);
 assert.equal((await request(member,article)).status,200);
 assert.equal((await request(member,{...article,title:'Different retry'})).status,409);
 assert.equal((await request(null,null,'/api/news?category=reviews')).articles.length,2);
 const {article:detail}=await read(null,article.id);
 assert.equal(detail.publisher.name,member.user.name);assert.equal(detail.canEdit,false);
 assert.deepEqual(detail.paragraphs,['First paragraph.','Second paragraph.']);
 assert.equal((await request(member,{...staff,action:'story-edit'})).status,403);
 assert.equal((await request(member,{...article,action:'story-edit',title:'Revised',source:''})).status,200);
 assert.equal((await request(reader,{action:'comment-add',newsId:article.id,body:'Interesting review',requestId:randomUUID()})).status,200);
 assert.equal((await request(owner,{action:'author-revoke',id:member.user.id})).status,200);
 assert.equal((await request(member)).canPublish,false);
 assert.equal((await request(member,{...article,action:'story-edit'})).status,403);
 assert.equal((await request(member,story())).status,403);
 const published=(await read(member,article.id)).article;
 assert.equal(published.comments,1);assert.equal(published.title,'Revised');assert.equal(published.canEdit,false);
 assert.equal((await request(owner,{action:'story-withdraw',id:article.id})).status,200);
 assert.equal((await read(reader,article.id)).status,404);
});
test('a scheduled tick cannot spend on news even if old settings were enabled',async()=>{
 await db.q('UPDATE news_settings SET enabled=true,auto_publish=true');
 process.env.CRON_SECRET='local-cron';
 const cron=createNewsCronHandler(fn=>fn(db),()=>assert.fail('Unexpected external request'));
 const res={setHeader(){},end(s){this.data=JSON.parse(s);}};
 await cron({method:'GET',headers:{authorization:'Bearer local-cron'}},res);
 assert.equal(res.statusCode,200);assert.equal(res.data.status,'idle');
 assert.deepEqual(await db.q('SELECT * FROM news_budget'),[]);
 const migration=await readFile(new URL('../db/manual-news.sql',import.meta.url),'utf8');
 await pg.exec(migration);await pg.exec(migration);
 assert.equal((await db.q('SELECT enabled FROM news_settings'))[0].enabled,false);
});
