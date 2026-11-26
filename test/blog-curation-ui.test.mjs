import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../public/forum-topics.js',import.meta.url),'utf8');
function setup({admin=true,ok=true}={}){
 const events=new Map(),requests=[],notices=[],loads=[];
 const context=vm.createContext({URL,console,location:{href:'https://joinvyx.com/?topic=blog#topics'},
  document:{addEventListener:(name,fn)=>events.set(name,fn)},
  data:{curatedFeed:true,user:{id:'editor',is_admin:admin}},page:'feed',
  e:value=>String(value).replaceAll('<','&lt;').replaceAll('"','&quot;'),
  date:()=> 'Nov 26',avatar:()=>'',fmt:String,messageReactionOptions:[],
  render(){},refresh:async()=>loads.push('refresh'),toast:message=>notices.push(message),
  fetch:async(url,options)=>{requests.push({url,...options});return {ok,json:async()=>ok?{ok:true}:{error:'This blog post has changed.'}};}
 });
 vm.runInContext(source,context);
 const message={id:'post',body:'Author text <tag>',author_id:'writer',created_at:'2026-11-26',reactions:[],homepage_version:'version',homepage_published:false};
 return {context,message,requests,notices,loads,click:events.get('click')};
}

test('manual publication controls are shown to the administrator and keep author text escaped',()=>{
 const fixture=setup(),topic={owner:false,replies_open:true};
 const html=fixture.context.topicMessageHTML(fixture.message,topic);
 assert.match(html,/Publish to homepage/);assert.match(html,/Author text &lt;tag>/);
 assert.match(fixture.context.topicMessageHTML({...fixture.message,homepage_published:true},topic),/Remove from homepage/);
 assert.doesNotMatch(fixture.context.topicMessageHTML({...fixture.message,homepage_version:undefined},topic),/data-blog-select/);
 fixture.context.data.user.is_admin=false;
 assert.doesNotMatch(fixture.context.topicMessageHTML(fixture.message,topic),/data-blog-select/);
 fixture.context.data.user=null;
 assert.doesNotMatch(fixture.context.topicMessageHTML(fixture.message,topic),/data-blog-select/);
});

test('manual publication sends the displayed version, refreshes the feed and unlocks its button',async()=>{
 const fixture=setup(),button={dataset:{blogSelect:'post',blogVersion:'seen-version',blogPublished:'false'},disabled:false};
 fixture.click({target:{closest:()=>button}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(fixture.requests.length,1);assert.equal(fixture.requests[0].url,'/api/admin');
 assert.equal(fixture.requests[0].credentials,'same-origin');
 assert.deepEqual(JSON.parse(fixture.requests[0].body),{action:'blog-curation-select',messageId:'post',version:'seen-version',published:true});
 assert.deepEqual(fixture.loads,['refresh']);assert.deepEqual(fixture.notices,['Published to the homepage.']);
 assert.equal(button.disabled,false);
});

test('failed selection does not report success and normal readers cannot dispatch publication',async()=>{
 const button={dataset:{blogSelect:'post',blogVersion:'seen-version',blogPublished:'true'},disabled:false};
 const fixture=setup({ok:false});
 fixture.click({target:{closest:()=>button}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(fixture.loads,[]);assert.deepEqual(fixture.notices,['This blog post has changed.']);
 assert.equal(JSON.parse(fixture.requests[0].body).published,false);assert.equal(button.disabled,false);
 const reader=setup({admin:false});reader.click({target:{closest:()=>button}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(reader.requests.length,0);
});
