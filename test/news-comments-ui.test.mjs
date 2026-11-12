import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/news-comments.js',import.meta.url),'utf8');
function setup(){
 const listeners={},ctx=vm.createContext({document:{addEventListener:(type,fn)=>listeners[type]=fn,getElementById:()=>null},data:{user:{id:'alice'}},page:'news',newsStory:{id:'story',comments:0},newsRows:[],URL,Map,Date,
 location:{origin:'https://joinvyx.com'},e:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),icon:()=>'',fmt:String,date:String,avatar:()=>'',loadingPanel:()=>'<p>Loading</p>',errorPanel:()=>'<p>Retry</p>'});
 vm.runInContext(source,ctx);return {ctx,listeners};
}
test('comment bodies are rendered as text, with controls restricted to server-confirmed permissions',()=>{
 const {ctx}=setup(),c={id:'comment',body:'<img src=x onerror=alert(1)>',createdAt:'2026-11-12',author:{id:'bob',name:'<script>',handle:'bob'},canEdit:false,canDelete:false};
 let html=ctx.newsCommentHTML(c);assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));assert.ok(!html.includes('data-news-comment-edit'));assert.ok(!html.includes('data-news-comment-delete'));
 html=ctx.newsCommentHTML({...c,canEdit:true,canDelete:true,editedAt:'2026-11-12'});assert.ok(html.includes('data-news-comment-edit'));assert.ok(html.includes('data-news-comment-delete'));assert.ok(html.includes('Edited'));
});
test('a late response for a different story or account cannot replace the current discussion',async()=>{
 for(const change of ['story','account']){
  const {ctx}=setup();let finish;ctx.fetch=()=>new Promise(r=>finish=r);const pending=ctx.loadNewsComments();
  if(change==='story')ctx.newsStory={id:'another'};else ctx.data.user={id:'bob'};
  finish({ok:true,json:async()=>({comments:[{id:'private-old-view'}],total:1,next:null})});await pending;
  assert.equal(vm.runInContext('newsCommentRows.length',ctx),0);
 }
});
test('pagination prepends older comments and preserves the unsent draft across rendering',async()=>{
 const {ctx}=setup();ctx.fetch=async()=>({ok:true,json:async()=>({comments:[{id:'latest'}],total:2,next:'previous'})});await ctx.loadNewsComments();
 vm.runInContext("newsCommentDrafts.set(newsCommentKey('story'),{body:'My unsent thought'});",ctx);
 ctx.fetch=async url=>{assert.ok(url.includes('before=previous'));return {ok:true,json:async()=>({comments:[{id:'older'}],total:2,next:null})};};await ctx.loadNewsComments(true);
 assert.equal(vm.runInContext('newsCommentRows.map(c=>c.id).join(",")',ctx),'older,latest');assert.ok(ctx.newsCommentForm('story').includes('My unsent thought'));
 ctx.data.user={id:'bob'};assert.ok(!ctx.newsCommentForm('story').includes('My unsent thought'));
});
test('finishing an old write re-enables the current discussion after navigation or an account change',async()=>{
 for(const change of ['story','account']){
  const {ctx,listeners}=setup(),renders=[];let finish;
  ctx.requireUser=()=>true;ctx.crypto={randomUUID:()=> 'request'};ctx.toast=()=>{};
  ctx.renderNewsDiscussion=()=>renders.push({id:ctx.newsStory.id,busy:vm.runInContext('newsCommentBusy',ctx)});
  ctx.fetch=()=>new Promise(r=>finish=r);
  const form={dataset:{newsId:'story'},elements:{body:{value:'A pending response'}},hasAttribute:()=>false,querySelectorAll:()=>[],isConnected:false};
  const pending=listeners.submit({preventDefault(){},target:{closest:()=>form}});
  if(change==='story')ctx.newsStory={id:'another'};else ctx.data.user={id:'bob'};
  finish({ok:true,json:async()=>({ok:true,id:'saved'})});await pending;
  assert.equal(renders.at(-1).id,ctx.newsStory.id);assert.equal(renders.at(-1).busy,false);
 }
});
