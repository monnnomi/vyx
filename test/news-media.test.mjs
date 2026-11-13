import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {cleanNewsPhotos,extractNewsPhotos,newsMediaFields} from '../server/news-media.js';
import {enqueueNewsPost} from '../server/news-queue.js';
import {collectNewsBatches} from '../server/news-batch.js';
import {syncNewsPhotos} from '../server/news-media-sync.js';
import {listNews,reserveNewsCost} from '../server/news.js';
const pg=new PGlite();await pg.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
const wrap=p=>({q:async(s,a=[])=>(await p.query(s,a)).rows,tx:fn=>p.transaction(t=>fn(wrap(t)))}),db=wrap(pg);
process.env.X_NEWS_BEARER_TOKEN='fixture-x';process.env.VYX_NEWS_AI_MODEL='gpt-6-luna';process.env.VYX_NEWS_AI_BASE_URL='https://triklz27.ru/v1';
after(()=>pg.close());
const photos=[{media_key:'3_11',type:'photo',url:'https://pbs.twimg.com/media/First_photo.jpg',width:1200,height:800,alt_text:'Product announcement'},{media_key:'3_12',type:'photo',url:'https://pbs.twimg.com/media/Second_photo.png',width:800,height:1200,alt_text:'Feature details'}];
const post={id:'123456',author_id:'99999',text:'The team announced an updated developer platform with clearer transaction details and new tools for the community.',created_at:new Date().toISOString(),attachments:{media_keys:['3_12','3_11']}};
async function reset(){await db.q('DELETE FROM news_read_reservations');await db.q('DELETE FROM news_scan_batches');await db.q('DELETE FROM news_items');await db.q('DELETE FROM news_sources');await db.q('DELETE FROM news_budget');await db.q("UPDATE news_settings SET pacing_enabled=false,enabled=true,collection_mode='batch',daily_budget_cents=100,scan_lease_until=NULL,scan_lease_token=NULL");return (await db.q("INSERT INTO news_sources(username,x_user_id) VALUES('fixture','99999') RETURNING *"))[0];}
test('only photos attached to the exact post are used, preserving attachment order and excluding quotes, videos and unrelated includes',()=>{
 const found=extractNewsPhotos(post,{media:[...photos,{media_key:'3_13',type:'photo',url:'https://pbs.twimg.com/media/Unrelated.jpg'}]});assert.deepEqual(found.map(p=>p.url),[photos[1].url,photos[0].url]);
 assert.equal(extractNewsPhotos({...post,attachments:{media_keys:['3_13','7_14']}},{media:[photos[0],{media_key:'7_14',type:'video',preview_image_url:photos[1].url}]}).length,0);
 assert.deepEqual(extractNewsPhotos({...post,attachments:null},{media:photos}),[]);assert.deepEqual(extractNewsPhotos(post,{media:[photos[0],photos[0]]}),[]);
});
test('media URLs are restricted to real X photo paths with no credentials, unsafe schemes, SVGs or foreign hosts',()=>{
 for(const url of ['javascript:alert(1)','http://pbs.twimg.com/media/x.jpg','https://pbs.twimg.com.evil.invalid/media/x.jpg','https://secret@pbs.twimg.com/media/x.jpg','https://pbs.twimg.com:444/media/x.jpg','https://pbs.twimg.com/media/x.svg','https://pbs.twimg.com/profile_images/x.jpg','https://pbs.twimg.com/media/../evil.jpg'])assert.deepEqual(cleanNewsPhotos([{url}]),[]);
 const values=cleanNewsPhotos(Array.from({length:8},(_,i)=>({url:'https://pbs.twimg.com/media/photo_'+i+'.jpg',alt:'<script>\ntext',width:-1,height:999999})));assert.equal(values.length,4);assert.equal(values[0].width,null);assert.equal(values[0].height,null);assert.ok(!values[0].alt.includes('\n'));
});
test('requests add only attachment media expansions, without fetching unrelated authors or referenced posts',()=>{
 const u=new URL('https://api.x.com/2/tweets?tweet.fields=author_id,created_at');newsMediaFields(u);assert.equal(u.searchParams.get('expansions'),'attachments.media_keys');assert.ok(u.searchParams.get('media.fields').includes('url'));assert.equal(u.searchParams.get('tweet.fields'),'author_id,created_at,attachments');
});
test('newly collected pictures survive production-style PostgreSQL serialization and are exposed on both card and article',async()=>{
 const source=await reset(),{Types}=await import('../node_modules/postgres/src/types.js'),types=Types();
 const adapter={...db,q:async(sql,args=[])=>{
  if(sql.startsWith('INSERT INTO news_items(')){
   await db.q('PREPARE media_driver_insert AS '+sql);const [{t}]=await db.q("SELECT parameter_types::text[] AS t FROM pg_prepared_statements WHERE name='media_driver_insert'");await db.q('DEALLOCATE media_driver_insert');args=args.map((v,i)=>t[i]==='jsonb'?types.serializer(3802)(v):t[i]==='text'?types.serializer(25)(v):v);
  }return db.q(sql,args);
 }};
 const id=await enqueueNewsPost(adapter,post,source,new Date(),{media:photos});assert.ok(id);await db.q("UPDATE news_items SET status='published',published_at=clock_timestamp() WHERE id=$1",[id]);
 const [row]=await db.q('SELECT source_media,media_checked_at FROM news_items');assert.ok(Array.isArray(row.source_media));assert.equal(row.source_media.length,2);assert.ok(row.media_checked_at);
 const cards=await listNews(db),article=await listNews(db,{id});assert.deepEqual(cards.articles[0].media,article.article.media);assert.equal(article.article.media[0].alt,'Feature details');assert.equal((await db.q('SELECT count(*)::int n FROM news_budget'))[0].n,0);
});
test('the batch collector associates included photos per post while keeping its existing reservation bounds',async()=>{
 await reset();let calls=0;await collectNewsBatches(db,async(raw)=>{calls++;const url=new URL(raw);assert.equal(url.searchParams.get('expansions'),'attachments.media_keys');return new Response(JSON.stringify({data:[post],includes:{media:photos}}));});
 assert.equal(calls,1);assert.equal((await db.q('SELECT source_media FROM news_items'))[0].source_media.length,2);assert.equal((await db.q('SELECT reserved_cents FROM news_budget'))[0].reserved_cents,1);
});
async function legacyStory(){const s=await reset();return (await db.q("INSERT INTO news_items(source_id,x_post_id,source_url,source_text,source_published_at,content_hash,status,title_en,summary_en,published_at) VALUES($1,$2,'https://x.com/fixture/status/123456','Original article source',now(),'media-legacy','published','Original article title','Original article summary',now()) RETURNING *",[s.id,post.id]))[0];}
test('existing published stories acquire original photos once, within the daily allowance and without rewriting their text',async()=>{
 const before=await legacyStory();let calls=0;const fetcher=async(raw,options)=>{calls++;assert.equal(new URL(raw).searchParams.get('ids'),post.id);assert.equal(options.headers.Authorization,'Bearer fixture-x');return new Response(JSON.stringify({data:[post],includes:{media:photos}}));};
 assert.equal((await syncNewsPhotos(db,fetcher)).updated,1);await syncNewsPhotos(db,fetcher);assert.equal(calls,1);const [after]=await db.q('SELECT * FROM news_items');assert.equal(after.title_en,before.title_en);assert.equal(after.status,before.status);assert.deepEqual(after.published_at,before.published_at);assert.equal(after.source_media.length,2);assert.equal((await db.q('SELECT reserved_cents FROM news_budget'))[0].reserved_cents,1);
});
test('exhausted allowance, pause and expired runtime prevent media network requests',async()=>{
 await legacyStory();await reserveNewsCost(db,'ai',80);const noFetch=()=>{throw Error('Must not fetch');};assert.equal((await syncNewsPhotos(db,noFetch)).updated,0);await db.q('UPDATE news_settings SET enabled=false');assert.equal((await syncNewsPhotos(db,noFetch)).updated,0);assert.equal((await syncNewsPhotos(db,noFetch,Date.now()-40000)).updated,0);
});
test('mismatched or failed lookups never attach images, retain the reservation and back off instead of repeating',async()=>{
 await legacyStory();let calls=0;const bad=async()=>{calls++;return new Response(JSON.stringify({data:[{...post,author_id:'foreign'}],includes:{media:photos}}));};await syncNewsPhotos(db,bad);await syncNewsPhotos(db,bad);assert.equal(calls,1);const [row]=await db.q('SELECT source_media,media_checked_at,media_next_attempt_at FROM news_items');assert.deepEqual(row.source_media,[]);assert.equal(row.media_checked_at,null);assert.ok(new Date(row.media_next_attempt_at)>new Date());assert.equal((await db.q('SELECT reserved_cents FROM news_budget'))[0].reserved_cents,1);
});
test('one unavailable legacy post does not prevent valid articles from receiving their photos',async()=>{
 const before=await legacyStory();await db.q("INSERT INTO news_items(source_id,x_post_id,source_url,source_text,source_published_at,content_hash,status,published_at) VALUES($1,'999999','https://x.com/fixture/status/999999','Deleted source post',now(),'missing-legacy','published',now())",[before.source_id]);
 const result=await syncNewsPhotos(db,async()=>new Response(JSON.stringify({data:[post],includes:{media:photos},errors:[{resource_id:'999999',title:'Not Found Error'}]})));
 assert.equal(result.updated,1);const rows=await db.q('SELECT x_post_id,source_media,media_checked_at,media_next_attempt_at FROM news_items ORDER BY x_post_id');assert.equal(rows[0].source_media.length,2);assert.ok(rows[0].media_checked_at);assert.equal(rows[1].media_checked_at,null);assert.ok(new Date(rows[1].media_next_attempt_at)>new Date());
});
test('migration is repeatable and preserves comments, article contents and community data',async()=>{
 await legacyStory();const before=await db.q('SELECT * FROM news_items'),sql=await readFile(new URL('../db/news-media.sql',import.meta.url),'utf8');await pg.exec(sql);await pg.exec(sql);assert.deepEqual(await db.q('SELECT * FROM news_items'),before);
});
