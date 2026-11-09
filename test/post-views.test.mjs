import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {login} from '../server/oauth.js';
import {feed,mutate} from '../server/service.js';
import {memberProfile,postDetail,searchCommunity} from '../server/social.js';
import {recordPostViews} from '../server/post-views.js';
import {createHandler} from '../api/vyx.js';
const pg=new PGlite();await pg.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
const wrap=p=>({q:async(s,v=[])=>(await p.query(s,v)).rows,tx:fn=>p.transaction(tx=>fn(wrap(tx)))}),db=wrap(pg);after(()=>pg.close());
const [a,b,c]=await Promise.all(['8201','8202','8203'].map(id=>db.tx(tx=>login(tx,{id,username:'post_view_'+id,name:'Member '+id,avatar:''}))));
const post=await mutate(db,a.user,'post',{body:'A public community story for checking unique post views.',requestId:randomUUID()});
const mark=(who,ids)=>db.tx(tx=>recordPostViews(tx,who?.user,{postIds:ids}));
const balance=()=>db.q('SELECT count(*)::int AS n,COALESCE(sum(amount),0)::text AS vp FROM reward_ledger');
test('post reads are side-effect free; each signed-in reader counts once and the author never counts',async()=>{
 const before=await balance();assert.equal((await feed(db,b.user))[0].view_count,0);assert.equal((await db.q('SELECT count(*)::int AS n FROM post_views'))[0].n,0);
 assert.equal((await mark(a,[post.id])).views[0].view_count,0);
 const first=await mark(b,[post.id,post.id]);assert.equal(first.views[0].view_count,1);assert.equal(first.views[0].viewed_by_me,true);
 await mark(b,[post.id]);await mark(c,[post.id]);assert.equal((await feed(db,a.user))[0].view_count,2);
 assert.equal((await db.q('SELECT count(*)::int AS n FROM post_views'))[0].n,2);assert.deepEqual(await balance(),before);
});
test('feed, author profile, search, saved posts and post detail return the same public total without reader identities',async()=>{
 await mutate(db,b.user,'save',{id:post.id});
 const cards=[(await feed(db,null))[0],(await memberProfile(db,b.user,a.user.id)).posts[0],(await searchCommunity(db,b.user,'checking unique')).posts[0],(await feed(db,b.user,{filter:'saved'}))[0],(await postDetail(db,b.user,post.id)).post];
 for(const card of cards){assert.equal(card.view_count,2);assert.ok(!('viewers' in card));assert.ok(!('user_ids' in card));}
 assert.equal(cards[0].viewed_by_me,false);assert.equal(cards[1].viewed_by_me,true);
});
test('hidden or unavailable posts reject the entire batch; invalid requests never create a receipt',async()=>{
 const unseen=await mutate(db,a.user,'post',{body:'A second community story which remains unseen in an invalid batch.'});
 await assert.rejects(mark(b,[unseen.id,randomUUID()]),e=>e.status===404);assert.equal((await db.q('SELECT count(*)::int AS n FROM post_views WHERE post_id=$1',[unseen.id]))[0].n,0);
 await mutate(db,b.user,'member-control',{id:a.user.id,control:'muted',enabled:true});await assert.rejects(mark(b,[post.id]),e=>e.status===404);assert.ok(!(await feed(db,b.user)).some(p=>p.id===post.id));
 await mutate(db,b.user,'member-control',{id:a.user.id,control:'muted',enabled:false});
 await mutate(db,a.user,'member-control',{id:b.user.id,control:'blocked',enabled:true});await assert.rejects(mark(b,[post.id]),e=>e.status===404);
 await mutate(db,a.user,'member-control',{id:b.user.id,control:'blocked',enabled:false});
 for(const postIds of [[],Array(61).fill(post.id),['bad-id']])await assert.rejects(db.tx(tx=>recordPostViews(tx,b.user,{postIds})),e=>e.status===400);
 await assert.rejects(mark(null,[post.id]),e=>e.status===401);
});
test('additive migration keeps existing post and message receipts and deletes post views with a hard-deleted post',async()=>{
 const before=await db.q('SELECT * FROM post_views ORDER BY user_id,post_id');const messages=await db.q('SELECT count(*)::int AS n FROM message_views');
 await pg.exec(await readFile(new URL('../db/post-views.sql',import.meta.url),'utf8'));await pg.exec(await readFile(new URL('../db/post-views.sql',import.meta.url),'utf8'));
 assert.deepEqual(await db.q('SELECT * FROM post_views ORDER BY user_id,post_id'),before);assert.deepEqual(await db.q('SELECT count(*)::int AS n FROM message_views'),messages);
 const disposable=await mutate(db,a.user,'post',{body:'An isolated disposable post for checking the receipt foreign key.'});await mark(b,[disposable.id]);await db.q('DELETE FROM posts WHERE id=$1',[disposable.id]);assert.equal((await db.q('SELECT count(*)::int AS n FROM post_views WHERE post_id=$1',[disposable.id]))[0].n,0);
});
test('post views require a same-origin authenticated write and always use the session viewer',async()=>{
 process.env.PUBLIC_APP_URL='https://joinvyx.com';const app=createHandler(fn=>fn(db));
 async function call({who=b,method='POST',origin='https://joinvyx.com',input={postIds:[post.id],userId:a.user.id}}={}){const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(t){this.data=JSON.parse(t);}};await app({method,url:'/api/vyx?action=post-views',headers:{origin,...(who?{cookie:'vyx_session='+who.sessionToken}:{}),'content-type':'application/json'},body:input},res);return res;}
 assert.equal((await call({who:null})).statusCode,401);assert.equal((await call({origin:'https://foreign.invalid'})).statusCode,403);assert.equal((await call({method:'GET'})).statusCode,404);
 assert.equal((await call({input:{postIds:[]}})).statusCode,400);const r=await call();assert.equal(r.statusCode,200);assert.equal(r.headers['cache-control'],'no-store');assert.deepEqual(Object.keys(r.data.views[0]).sort(),['id','view_count','viewed_by_me']);assert.equal(r.data.views[0].view_count,2);
});
