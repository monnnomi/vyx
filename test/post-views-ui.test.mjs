import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/post-views.js',import.meta.url),'utf8');
function setup(count=1){
 let now=10000;const calls=[],modal={hidden:true},doc={hidden:false,addEventListener(){},querySelectorAll:()=>[]};
 const nodes=Array.from({length:count},(_,i)=>({dataset:{postViewId:'post-'+i,postViewAuthor:'bob',postViewed:'false'},visible:true}));
 const root={querySelectorAll:()=>nodes},overlay={querySelectorAll:()=>[]},shell={inert:false};
 const ctx=vm.createContext({document:doc,window:{addEventListener(){}},Date:{now:()=>now},Map,Set,Number,Math,String,fmt:String,setInterval(){},setTimeout:()=>1,clearTimeout(){},data:{user:{id:'alice'},posts:[]},feedPosts:[],profilePosts:[],exploreState:null,$:s=>({'#modal-backdrop':modal,'#modal':overlay,'.app-shell':shell,'#main-content':root}[s]||null),messageNodeVisible:node=>node.visible,api:async(action,input)=>{calls.push({action,input});return {views:input.postIds.map(id=>({id,view_count:1,viewed_by_me:true}))};}});
 vm.runInContext(source,ctx);return {ctx,calls,nodes,root,overlay,modal,shell,doc,advance:ms=>now+=ms};
}
test('posts count after visible dwell, excluding the author, anonymous visits, off-screen cards and background tabs',async()=>{
 const f=setup(3);f.nodes[1].visible=false;f.nodes[2].dataset.postViewAuthor='alice';f.ctx.scanPostViews();f.advance(800);f.ctx.scanPostViews();await f.ctx.flushPostViews();assert.equal(f.calls.length,0);
 f.doc.hidden=true;f.ctx.scanPostViews();f.advance(2000);f.doc.hidden=false;f.ctx.scanPostViews();f.advance(1100);f.ctx.scanPostViews();await f.ctx.flushPostViews();assert.deepEqual([...f.calls[0].input.postIds],['post-0']);assert.equal(f.calls[0].action,'post-views');
 f.ctx.data.user=null;f.ctx.scanPostViews();f.advance(2000);f.ctx.scanPostViews();await f.ctx.flushPostViews();assert.equal(f.calls.length,1);
});
test('the visible post in a discussion/profile overlay counts once across surfaces; the covered feed does not',async()=>{
 const f=setup(2);f.ctx.scanPostViews();f.advance(700);f.modal.hidden=false;f.overlay.querySelectorAll=()=>[f.nodes[1]];f.ctx.scanPostViews();f.advance(1100);f.ctx.scanPostViews();await f.ctx.flushPostViews();assert.deepEqual([...f.calls[0].input.postIds],['post-1']);
 f.modal.hidden=true;f.ctx.scanPostViews();f.advance(1100);f.ctx.scanPostViews();await f.ctx.flushPostViews();assert.deepEqual([...f.calls[1].input.postIds],['post-0']);
 f.ctx.scanPostViews();f.advance(2000);f.ctx.scanPostViews();await f.ctx.flushPostViews();assert.equal(f.calls.length,2);
});
test('post batches stay bounded and late responses cannot update another account',async()=>{
 const f=setup(80);f.ctx.scanPostViews();f.advance(1100);f.ctx.scanPostViews();await f.ctx.flushPostViews();await f.ctx.flushPostViews();assert.deepEqual(f.calls.map(c=>c.input.postIds.length),[60,20]);
 const g=setup();let finish;g.ctx.api=()=>new Promise(resolve=>finish=resolve);g.ctx.scanPostViews();g.advance(1100);g.ctx.scanPostViews();const pending=g.ctx.flushPostViews();g.ctx.data.user={id:'carol'};g.ctx.scanPostViews();finish({views:[{id:'post-0',view_count:99,viewed_by_me:true}]});await pending;assert.match(g.ctx.postViewsHTML({id:'post-0',view_count:0}),/0 unique views/);
});
test('replacing or scrolling away from a post resets dwell; failures back off without increasing the display',async()=>{
 const f=setup();f.ctx.scanPostViews();f.advance(800);f.nodes[0].visible=false;f.ctx.scanPostViews();f.advance(1000);f.nodes[0].visible=true;f.ctx.scanPostViews();f.advance(700);f.ctx.scanPostViews();await f.ctx.flushPostViews();assert.equal(f.calls.length,0);
 let attempts=0;f.ctx.api=async()=>{attempts++;throw Error('Offline');};f.advance(400);f.ctx.scanPostViews();await f.ctx.flushPostViews();f.advance(5000);f.ctx.scanPostViews();await f.ctx.flushPostViews();assert.equal(attempts,1);assert.match(f.ctx.postViewsHTML({id:'post-0',view_count:0}),/0 unique views/);
});
