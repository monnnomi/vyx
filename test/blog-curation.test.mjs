import {test,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {migrateForumTopics,createForumTopic,changeForumTopic,forumTopic} from '../server/forum-topics.js';
import {migrateBlogCuration,curatedBlogFeed,runBlogCuration,selectBlogPost,blogPostVersion} from '../server/blog-curation.js';
import {createAdminHandler} from '../api/admin.js';
import {createHandler} from '../api/vyx.js';
import {hash} from '../server/http.js';
import {createNewsCronHandler} from '../api/news-cron.js';
import {curatedFeedEnabled,blogCurationAdmin,saveBlogCurationSettings} from '../server/blog-curation-settings.js';

const pg=new PGlite();
const wrap=conn=>({q:async(sql,args=[])=>(await conn.query(sql,args)).rows,tx:fn=>conn.transaction(tx=>fn(wrap(tx)))});
const db=wrap(pg);
await pg.exec(`CREATE TABLE users(id uuid PRIMARY KEY,name text,handle text,avatar_url text,x_id text,is_system boolean NOT NULL DEFAULT false);
 CREATE TABLE member_controls(user_id uuid,target_id uuid,blocked boolean,muted boolean);
 CREATE TABLE follows(follower_id uuid,following_id uuid);
 CREATE TABLE sessions(token_hash text,user_id uuid,expires_at timestamptz);
 CREATE TABLE rate_limits(bucket text,window_start bigint,count integer,PRIMARY KEY(bucket,window_start));
 CREATE TABLE posts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,body text,request_id uuid,created_at timestamptz DEFAULT now());
 CREATE TABLE activity_events(user_id uuid,season text,day text,kind text,target text,PRIMARY KEY(user_id,season,day,kind,target));`);
await migrateForumTopics(db);
await migrateBlogCuration(db);
const names=['VYX_CURATED_FEED','FLOP_API_KEY','FLOP_GATEWAY_URL','VYX_BLOG_MODEL','VYX_APP_SECRET','PUBLIC_APP_URL','CRON_SECRET','VYX_ADMIN_X_IDS'];
const previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
after(async()=>{for(const name of names){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];}await pg.close();});
beforeEach(async()=>{
 await db.q('TRUNCATE users,forum_topics,forum_topic_messages,blog_curations,blog_curation_worker,blog_curation_settings,member_controls,follows,sessions,rate_limits,posts,activity_events CASCADE');
 await db.q('INSERT INTO blog_curation_settings(id,enabled) VALUES(true,true)');
 process.env.VYX_CURATED_FEED='1';
 process.env.FLOP_API_KEY='isolated-test-key';
 process.env.FLOP_GATEWAY_URL='https://gateway.testnet.flop.network/v1';
 process.env.VYX_BLOG_MODEL='qwen/qwen3-14b';
 process.env.VYX_APP_SECRET='isolated-test-secret';
 process.env.PUBLIC_APP_URL='https://joinvyx.com';
});

async function blog(){
 const user={id:randomUUID()};
 await db.q('INSERT INTO users(id,name,handle) VALUES($1,$2,$3)',[user.id,'A blog author','author_'+user.id.slice(0,6)]);
 const topic=await createForumTopic(db,user,{title:'Research journal',description:'First-hand project notes'});
 return {user,topic};
}
async function update(owner,body){
 await changeForumTopic(db,owner.user,'topic-message',{topicId:owner.topic.id,body});
 return (await db.q('SELECT id FROM forum_topic_messages WHERE topic_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[owner.topic.id]))[0];
}
const assessment=(overrides={})=>({score:85,useful:true,spam:false,duplicate:false,reason:'Concrete first-hand findings and a reproducible explanation.',...overrides});
const completion=review=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(review)}}]}));
const goodBody='I tested three public RPC endpoints against the same finalized block. Here are the request parameters, measured delays, and the steps that reproduced the timeout.';

async function editor(){
 const account=await blog();
 account.user.x_id='987654';process.env.VYX_ADMIN_X_IDS=account.user.x_id;
 await db.q('UPDATE users SET x_id=$2 WHERE id=$1',[account.user.id,account.user.x_id]);
 return account.user;
}
async function selection(message,published=true){
 const [row]=await db.q('SELECT * FROM forum_topic_messages WHERE id=$1',[message.id]);
 return {messageId:row.id,version:blogPostVersion(row),published};
}

test('manual selections work without FLOP, preserve authorship and blog links, and can be removed',async()=>{
 delete process.env.FLOP_API_KEY;
 const admin=await editor(),author=await blog(),post=await update(author,goodBody);
 const input=await selection(post);
 await selectBlogPost(db,admin,input);await selectBlogPost(db,admin,input);
 const feed=await curatedBlogFeed(db,admin);
 assert.equal(feed.length,1);assert.equal(feed[0].body,goodBody);
 assert.equal(feed[0].author.id,author.user.id);assert.equal(feed[0].source_topic.id,author.topic.id);
 assert.equal(feed[0].selection_source,'manual');assert.equal(feed[0].homepage_version,input.version);
 assert.equal((await curatedBlogFeed(db,null))[0].homepage_version,undefined);
 const [record]=await db.q('SELECT * FROM blog_curations');
 assert.equal(record.reviewer_id,admin.id);assert.equal(record.score,null);assert.equal(record.request_body,null);
 const view=await forumTopic(db,admin,author.topic.id);
 assert.equal(view.messages[0].homepage_published,true);
 assert.equal((await forumTopic(db,author.user,author.topic.id)).messages[0].homepage_version,undefined);
 await selectBlogPost(db,admin,{...input,published:false});
 assert.equal((await curatedBlogFeed(db,null)).length,0);
 assert.equal((await db.q('SELECT body FROM forum_topic_messages WHERE id=$1',[post.id]))[0].body,goodBody);
 assert.equal((await runBlogCuration(db,()=>assert.fail('No FLOP call for a manual decision'))).status,'unconfigured');
});

test('manual selection rejects other users, replies, hidden authors and stale versions',async()=>{
 const admin=await editor(),author=await blog(),reader=await blog(),post=await update(author,goodBody);
 const input=await selection(post);
 await assert.rejects(selectBlogPost(db,null,input),e=>e.status===401);
 await assert.rejects(selectBlogPost(db,{...reader.user,handle:'monnnomi_',is_admin:true},input),e=>e.status===403);
 await changeForumTopic(db,reader.user,'topic-message',{topicId:author.topic.id,body:'A reader reply.'});
 const [reply]=await db.q("SELECT id FROM forum_topic_messages WHERE kind='reply'");
 await assert.rejects(selectBlogPost(db,admin,await selection(reply)),e=>e.status===404);
 await db.q('INSERT INTO member_controls VALUES($1,$2,true,false)',[author.user.id,admin.id]);
 await assert.rejects(selectBlogPost(db,admin,input),e=>e.status===404);
 await db.q('DELETE FROM member_controls');
 await changeForumTopic(db,author.user,'topic-message-edit',{topicId:author.topic.id,messageId:post.id,body:'A changed post.'});
 await assert.rejects(selectBlogPost(db,admin,input),e=>e.status===409);
 assert.equal((await curatedBlogFeed(db,null)).length,0);
});

test('manual decisions survive automation and edited selections require another manual approval',async()=>{
 const admin=await editor(),author=await blog(),post=await update(author,goodBody);
 await selectBlogPost(db,admin,await selection(post));
 await changeForumTopic(db,author.user,'topic-message-edit',{topicId:author.topic.id,messageId:post.id,body:'A revised author update.'});
 assert.equal((await curatedBlogFeed(db,null)).length,0);
 assert.equal((await runBlogCuration(db,()=>assert.fail('Manual selection must not be overwritten'))).reviewed,0);
 await selectBlogPost(db,admin,await selection(post));
 assert.equal((await curatedBlogFeed(db,null))[0].body,'A revised author update.');
 await selectBlogPost(db,admin,await selection(post,false));
 assert.equal((await runBlogCuration(db,()=>assert.fail('Manual removal must not be republished'))).reviewed,0);
 await selectBlogPost(db,admin,await selection(post));
 await changeForumTopic(db,author.user,'topic-message-delete',{topicId:author.topic.id,messageId:post.id});
 assert.equal((await curatedBlogFeed(db,null)).length,0);
});

test('manual selection wins over an in-flight automatic review without losing its request evidence',async()=>{
 const admin=await editor(),author=await blog(),post=await update(author,goodBody);
 let manualTime;
 await runBlogCuration(db,async()=>{
  await selectBlogPost(db,admin,await selection(post));
  [manualTime]=await db.q('SELECT request_id,request_body,credential_hash FROM blog_curations');
  return completion(assessment({score:5,useful:false}));
 });
 const [record]=await db.q('SELECT * FROM blog_curations');
 assert.equal(record.status,'approved');assert.equal(record.review_source,'manual');
 assert.equal(record.request_id,manualTime.request_id);assert.equal(record.request_body,manualTime.request_body);
 assert.equal(record.credential_hash,manualTime.credential_hash);
 assert.equal((await curatedBlogFeed(db,null)).length,1);
});

test('manual publication API requires an administrator session and same-origin request',async()=>{
 const admin=await editor(),author=await blog(),post=await update(author,goodBody),cookie='b'.repeat(43);
 await db.q("INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",[hash(cookie),admin.id]);
 const handler=createAdminHandler(fn=>fn(db)),input={action:'blog-curation-select',...await selection(post)};
 const call=async(headers)=>{
  const res={setHeader(){},end(value){this.body=JSON.parse(value);}};
  await handler({method:'POST',url:'/api/admin',body:input,headers:{'content-type':'application/json',...headers}},res);
  return res;
 };
 assert.equal((await call({origin:'https://joinvyx.com'})).statusCode,401);
 assert.equal((await call({origin:'https://other.example',cookie:'vyx_session='+cookie})).statusCode,403);
 assert.equal((await curatedBlogFeed(db,null)).length,0);
 assert.equal((await call({origin:'https://joinvyx.com',cookie:'vyx_session='+cookie})).statusCode,200);
 assert.equal((await curatedBlogFeed(db,null)).length,1);
});

test('curation migration is repeatable and leaves existing blog content intact',async()=>{
 const owner=await blog();await update(owner,goodBody);
 const before=await db.q('SELECT id,body FROM forum_topic_messages');
 await migrateBlogCuration(db);await migrateBlogCuration(db);
 assert.deepEqual(await db.q('SELECT id,body FROM forum_topic_messages'),before);
 delete process.env.FLOP_API_KEY;
 assert.equal((await runBlogCuration(db,()=>assert.fail('An unconfigured bot does not call FLOP'))).status,'unconfigured');
});

test('curation settings require an existing administrator and store a verified key encrypted',async()=>{
 const owner={x_id:'123456',is_system:false};process.env.VYX_ADMIN_X_IDS=owner.x_id;
 const input={enabled:true,gateway:'https://api.flop.network',model:'qwen/qwen3-14b',apiKey:'flop_isolated-key'};
 await assert.rejects(saveBlogCurationSettings(db,{x_id:'somebody-else'},input),error=>error.status===403);
 const provider=async(url,options)=>{
  if(url.endsWith('/keys/me')){
   assert.equal(options.headers.Authorization,'Bearer flop_isolated-key');
   return new Response(JSON.stringify({remaining_quota:10,expires_at:Date.now()+86400000,model_allowlist:['Qwen/Qwen3-14B']}));
  }
  return new Response(JSON.stringify({data:[{id:input.model}]}));
 };
 const saved=await saveBlogCurationSettings(db,owner,input,provider);
 assert.equal(saved.configured,true);assert.equal(saved.gateway,'https://api.flop.network/v1');
 assert.ok(!JSON.stringify(saved).includes(input.apiKey));
 const [stored]=await db.q('SELECT sealed_key FROM blog_curation_settings');
 assert.ok(stored.sealed_key);assert.ok(!stored.sealed_key.includes(input.apiKey));
 const author=await blog();await update(author,goodBody);
 await runBlogCuration(db,async(url,options)=>{
  assert.equal(url,'https://api.flop.network/v1/chat/completions');
  assert.equal(options.headers.Authorization,'Bearer flop_isolated-key');return completion(assessment());
 });
 assert.equal((await curatedBlogFeed(db,null)).length,1);
 const summary=await blogCurationAdmin(db,owner);
 assert.equal(summary.counts.published,1);assert.ok(!('sealed_key' in summary));
 await db.q("UPDATE blog_curation_settings SET key_expires_at=clock_timestamp()-interval '1 second'");
 assert.equal((await blogCurationAdmin(db,owner)).configured,false);
 assert.equal((await runBlogCuration(db,()=>assert.fail('Expired access does not start inference'))).status,'unconfigured');
 await saveBlogCurationSettings(db,owner,{...input,apiKey:'',enabled:false},()=>assert.fail('Disabling never depends on provider availability'));
 assert.equal(await curatedFeedEnabled(db),false);
});

test('invalid, expired or wrong-model FLOP access cannot replace working settings',async()=>{
 const owner={x_id:'123456',is_system:false};process.env.VYX_ADMIN_X_IDS=owner.x_id;
 const input={enabled:true,gateway:'https://api.flop.network/v1',model:'qwen/qwen3-14b',apiKey:'flop_isolated-key'};
 await assert.rejects(saveBlogCurationSettings(db,owner,{...input,gateway:'https://unrelated.example/v1'}),error=>error.status===400);
 await assert.rejects(saveBlogCurationSettings(db,owner,input,async()=>new Response('{}',{status:401})),error=>error.status===409);
 await assert.rejects(saveBlogCurationSettings(db,owner,input,async url=>new Response(JSON.stringify(url.endsWith('/keys/me')?{remaining_quota:10,expires_at:Date.now()-1000}:{data:[]}))),error=>error.status===409);
 await assert.rejects(saveBlogCurationSettings(db,owner,input,async url=>new Response(JSON.stringify(url.endsWith('/keys/me')?
  {remaining_quota:10,expires_at:Date.now()+86400000,model_allowlist:['Qwen/Qwen2.5-0.5B-Instruct']}:{data:[{id:input.model}]}))),error=>error.status===409);
 assert.equal((await db.q('SELECT sealed_key FROM blog_curation_settings'))[0].sealed_key,null);
});

test('only useful owner updates enter the homepage with their original author and blog link',async()=>{
 const owner=await blog(),reader=await blog();
 const post=await update(owner,goodBody);await update(reader,'Good morning, who is bullish today?');
 await changeForumTopic(db,reader.user,'topic-message',{topicId:owner.topic.id,body:'A reader reply is not a blog update.',replyTo:post.id});
 let requests=0;
 const result=await runBlogCuration(db,async(url,options)=>{
  requests++;assert.equal(url,'https://gateway.testnet.flop.network/v1/chat/completions');
  assert.equal(options.headers.Authorization,'Bearer isolated-test-key');
  assert.ok(options.headers['Idempotency-Key']);
  const request=JSON.parse(options.body),input=JSON.parse(request.messages[1].content);
  assert.equal(request.stream,false);
  assert.ok(!('temperature' in request));
  return completion(assessment(input.post===goodBody?{}:{score:10,useful:false,reason:'A greeting with no substantive information.'}));
 });
 assert.equal(result.published,1);assert.equal(requests,2);
 const feed=await curatedBlogFeed(db,null);
 assert.equal(feed.length,1);assert.equal(feed[0].body,goodBody);
 assert.equal(feed[0].author.id,owner.user.id);assert.equal(feed[0].source_topic.id,owner.topic.id);
 assert.equal((await runBlogCuration(db,()=>assert.fail('Completed reviews are not repeated'))).reviewed,0);
});

test('exact normalized copies are skipped without a second inference request',async()=>{
 const first=await blog(),second=await blog();
 await update(first,goodBody);await update(second,goodBody.toUpperCase());
 let requests=0;
 const result=await runBlogCuration(db,async()=>{requests++;return completion(assessment());});
 assert.equal(requests,1);assert.equal(result.published,1);
 assert.equal((await curatedBlogFeed(db,null)).length,1);
});

test('edits hide the old selection until re-review and deletion removes it from the homepage',async()=>{
 const owner=await blog(),post=await update(owner,goodBody);
 await runBlogCuration(db,async()=>completion(assessment()));
 await changeForumTopic(db,owner.user,'topic-message-edit',{topicId:owner.topic.id,messageId:post.id,body:'An updated explanation with exact request parameters and additional measured results.'});
 assert.equal((await curatedBlogFeed(db,null)).length,0);
 assert.equal((await runBlogCuration(db,async()=>completion(assessment()))).published,1);
 assert.equal((await curatedBlogFeed(db,null)).length,1);
 await changeForumTopic(db,owner.user,'topic-message-delete',{topicId:owner.topic.id,messageId:post.id});
 assert.equal((await curatedBlogFeed(db,null)).length,0);
 assert.equal((await db.q('SELECT * FROM blog_curations')).length,0);
});

test('an edit during inference cannot publish the body that was not reviewed',async()=>{
 const owner=await blog(),post=await update(owner,goodBody);
 let calls=0;
 await runBlogCuration(db,async()=>{
  if(calls++===0){
   await changeForumTopic(db,owner.user,'topic-message-edit',{topicId:owner.topic.id,messageId:post.id,body:'Buy this token now!'});
   return completion(assessment());
  }
  return completion(assessment({score:5,useful:false,spam:true,reason:'Pure promotion.'}));
 });
 assert.equal((await curatedBlogFeed(db,null)).length,0);
});

test('simultaneous worker runs make one inference request and publish once',async()=>{
 const owner=await blog();await update(owner,goodBody);
 let release,started,calls=0;
 const gate=new Promise(resolve=>release=resolve),began=new Promise(resolve=>started=resolve);
 const first=runBlogCuration(db,async()=>{calls++;started();await gate;return completion(assessment());});
 await began;
 assert.equal((await runBlogCuration(db,()=>assert.fail('A worker lease prevents a duplicate request'))).status,'already-running');
 release();assert.equal((await first).published,1);assert.equal(calls,1);
});

test('lost responses are reconciled before replay, preserving the exact request and identity',async()=>{
 const owner=await blog();await update(owner,goodBody);
 let original;
 assert.equal((await runBlogCuration(db,async(url,options)=>{original={url,options};throw Error('Connection lost after sending.');})).status,'waiting');
 await db.q("UPDATE blog_curations SET retry_at=clock_timestamp()-interval '1 second'");
 let lookups=0;
 const pending=await runBlogCuration(db,async(url,options)=>{
  lookups++;assert.ok(url.includes('/keys/me/receipts/'));assert.equal(options.method,undefined);
  return new Response(JSON.stringify({state:'estimated',response_status:200}));
 });
 assert.equal(pending.published,0);assert.equal(lookups,1);
 await db.q("UPDATE blog_curations SET retry_at=clock_timestamp()-interval '1 second'");
 const recovered=await runBlogCuration(db,async(url,options)=>{
  if(options.method!=='POST')return new Response(JSON.stringify({state:'settled',response_status:200}));
  assert.equal(url,original.url);assert.equal(options.body,original.options.body);
  assert.equal(options.headers['Idempotency-Key'],original.options.headers['Idempotency-Key']);
  return completion(assessment());
 });
 assert.equal(recovered.published,1);
});

test('missing receipts and changed credentials do not trigger replacement paid requests',async()=>{
 const owner=await blog();await update(owner,goodBody);
 await runBlogCuration(db,async()=>{throw Error('Unknown outcome');});
 await db.q("UPDATE blog_curations SET retry_at=clock_timestamp()-interval '1 second'");
 await runBlogCuration(db,async(url,options)=>{assert.equal(options.method,undefined);return new Response('{}',{status:404});});
 process.env.FLOP_API_KEY='a-different-test-key';
 await db.q("UPDATE blog_curations SET retry_at=clock_timestamp()-interval '1 second'");
 assert.equal((await runBlogCuration(db,()=>assert.fail('An old request cannot use new credentials'))).status,'waiting');
});

test('invalid model output and high-scoring spam cannot publish',async()=>{
 const a=await blog(),b=await blog();await update(a,goodBody);await update(b,goodBody+' Additional text.');
 let calls=0;
 const result=await runBlogCuration(db,async()=>completion(calls++===0?{score:'100',useful:true}:assessment({score:100,spam:true})));
 assert.equal(result.published,0);assert.equal((await curatedBlogFeed(db,null)).length,0);
 await runBlogCuration(db,()=>assert.fail('A completed invalid review is not purchased repeatedly'));
});

test('feed pagination keeps timestamp ties and applies following, mute and block rules',async()=>{
 await assert.rejects(curatedBlogFeed(db,null,{cursor:'1'}),error=>error.status===400);
 await assert.rejects(curatedBlogFeed(db,null,{cursor:'2026-11-26T10:00:00Z|invalid-id'}),error=>error.status===400);
 const owner=await blog(),viewer=await blog();
 for(let i=0;i<31;i++){
  const body=goodBody+' #'+i;
  const [message]=await db.q("INSERT INTO forum_topic_messages(topic_id,author_id,kind,body) VALUES($1,$2,'update',$3) RETURNING id",[owner.topic.id,owner.user.id,body]);
  await db.q(`INSERT INTO blog_curations(message_id,reviewed_body,content_hash,status,model,token,lease_until,request_id,published_at)
   VALUES($1,$2,$3,'approved','fixture',$4,now(),$5,'2026-11-26T10:00:00Z')`,[message.id,body,hash(body),randomUUID(),randomUUID()]);
 }
 const first=await curatedBlogFeed(db,null),second=await curatedBlogFeed(db,null,{cursor:first.at(-1).cursor});
 assert.equal(first.length,30);assert.equal(second.length,1);assert.ok(!first.some(row=>row.id===second[0].id));
 assert.equal((await curatedBlogFeed(db,viewer.user,{filter:'following'})).length,0);
 await db.q('INSERT INTO follows VALUES($1,$2)',[viewer.user.id,owner.user.id]);
 assert.equal((await curatedBlogFeed(db,viewer.user,{filter:'following'})).length,30);
 await db.q('INSERT INTO member_controls VALUES($1,$2,false,true)',[viewer.user.id,owner.user.id]);
 assert.equal((await curatedBlogFeed(db,viewer.user)).length,0);
 await db.q('DELETE FROM member_controls');
 await db.q('INSERT INTO member_controls VALUES($1,$2,true,false)',[owner.user.id,viewer.user.id]);
 assert.equal((await curatedBlogFeed(db,viewer.user)).length,0);
});

test('direct homepage posting is denied at the API while owner blog updates still work',async()=>{
 const owner=await blog(),cookie='a'.repeat(43);
 await db.q("INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",[hash(cookie),owner.user.id]);
 const api=createHandler(fn=>fn(db));
 const call=async(action,data)=>{
  const res={setHeader(){},end(value){this.body=JSON.parse(value);}};
  await api({method:'POST',url:'/api/vyx?action='+action,body:data,
   headers:{origin:'https://joinvyx.com',cookie:'vyx_session='+cookie,'content-type':'application/json'}},res);
  return res;
 };
 const denied=await call('post',{body:goodBody});
 assert.equal(denied.statusCode,403);assert.match(denied.body.error,/Publish updates in your blog/);
 assert.equal((await call('post',{body:'[giveaway:members] '+goodBody})).statusCode,403);
 const published=await call('topic-message',{topicId:owner.topic.id,body:goodBody});
 assert.equal(published.statusCode,200);
 assert.equal((await curatedBlogFeed(db,null)).length,0);
 process.env.VYX_ADMIN_X_IDS='123456';
 await db.q("UPDATE users SET x_id='123456' WHERE id=$1",[owner.user.id]);
 assert.equal((await call('post',{body:goodBody})).statusCode,403);
 assert.equal((await call('post',{body:'[giveaway:members] '+goodBody})).statusCode,200);
 assert.equal((await curatedBlogFeed(db,null)).length,0);
});

test('the existing scheduler starts a background review without waiting for long inference',async()=>{
 const owner=await blog();await update(owner,goodBody);
 process.env.CRON_SECRET='fixture-cron';
 const pending=[];
 let release,started;
 const gate=new Promise(resolve=>release=resolve),began=new Promise(resolve=>started=resolve);
 const fetcher=async()=>{started();await gate;return completion(assessment());};
 const workerDB={...db,q:(sql,args)=>sql.includes('FROM x_task_access')?Promise.resolve([]):db.q(sql,args)};
 const handler=createNewsCronHandler(fn=>fn(workerDB),fetcher,promise=>pending.push(promise));
 const res={setHeader(){},end(value){this.body=JSON.parse(value);}};
 await handler({method:'GET',headers:{authorization:'Bearer fixture-cron'}},res);
 assert.equal(res.statusCode,200);assert.equal(res.body.status,'idle');
 assert.equal(pending.length,1);
 await began;
 assert.equal((await curatedBlogFeed(db,null)).length,0);
 release();await Promise.all(pending);
 assert.equal((await curatedBlogFeed(db,null)).length,1);
});
