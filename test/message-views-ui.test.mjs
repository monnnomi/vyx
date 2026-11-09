import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/message-views.js',import.meta.url),'utf8');
function setup(count=1){
 let now=10000,timer=0;const events=new Map(),timers=new Map(),calls=[],rootRect={top:0,bottom:300,left:0,right:400,height:300,width:400};
 const messages=Array.from({length:count},(_,i)=>({id:'message-'+i,sender_id:'bob',view_count:0,viewed_by_me:false}));
 const nodes=messages.map(m=>({dataset:{roomMessage:m.id,dmMessage:m.id},isConnected:true,rect:{top:30,bottom:100,left:0,right:250,width:250,height:70},getBoundingClientRect(){return this.rect;}}));
 const root={isConnected:true,getBoundingClientRect:()=>rootRect,querySelectorAll:selector=>selector==='[data-message-view-count]'?[]:nodes};
 const modal={hidden:true},shell={inert:false},doc={hidden:false,addEventListener:(name,fn)=>events.set(name,fn)};
 const ctx=vm.createContext({document:doc,window:{innerHeight:400,innerWidth:400,addEventListener:(name,fn)=>events.set(name,fn)},Date:{now:()=>now},Map,Set,Number,Math,String,fmt:String,setInterval(){},setTimeout:fn=>{timers.set(++timer,fn);return timer;},clearTimeout:id=>timers.delete(id),data:{user:{id:'alice'}},page:'rooms',activeRoom:'room',activeChat:'bob',roomInfo:{joined:true},roomLoading:false,roomMessages:messages,chatMessages:messages,$:selector=>({'.room-chat-log':root,'.chat-bubbles':root,'#modal-backdrop':modal,'.app-shell':shell}[selector]||null),api:async(action,input)=>{calls.push({action,input});return {views:input.messageIds.map(id=>({id,view_count:1,viewed_by_me:true}))};}});
 vm.runInContext(source,ctx);return {ctx,nodes,rootRect,modal,shell,doc,calls,events,messages,advance:ms=>now+=ms};
}
test('only on-screen messages dwell for a second; own messages, background tabs and modal overlays do not count',async()=>{
 const f=setup(3);f.nodes[1].rect.top=500;f.nodes[1].rect.bottom=570;f.messages[2].sender_id='alice';
 f.doc.hidden=true;f.ctx.scanMessageViews();f.advance(2000);f.doc.hidden=false;f.ctx.scanMessageViews();f.advance(800);f.ctx.scanMessageViews();await f.ctx.flushMessageViews();assert.equal(f.calls.length,0);
 f.modal.hidden=false;f.ctx.scanMessageViews();f.advance(2000);f.modal.hidden=true;f.ctx.scanMessageViews();f.advance(1100);f.ctx.scanMessageViews();await f.ctx.flushMessageViews();
 assert.equal(f.calls.length,1);assert.deepEqual([...f.calls[0].input.messageIds],['message-0']);assert.equal(f.messages[0].view_count,1);
 f.advance(4000);f.ctx.scanMessageViews();await f.ctx.flushMessageViews();assert.equal(f.calls.length,1);
});
test('scrolling away or disconnecting a node cancels dwell; tall messages count when enough of the viewport is covered',async()=>{
 const f=setup();f.ctx.scanMessageViews();f.advance(700);f.nodes[0].rect.top=500;f.nodes[0].rect.bottom=570;f.ctx.scanMessageViews();f.advance(1200);await f.ctx.flushMessageViews();assert.equal(f.calls.length,0);
 f.nodes[0].rect={top:-200,bottom:800,left:0,right:250,height:1000,width:250};f.ctx.scanMessageViews();f.advance(1100);f.ctx.scanMessageViews();await f.ctx.flushMessageViews();assert.equal(f.calls.length,1);
 const g=setup();g.ctx.scanMessageViews();g.nodes[0].isConnected=false;g.advance(1500);g.ctx.scanMessageViews();await g.ctx.flushMessageViews();assert.equal(g.calls.length,0);
});
test('batches are bounded to 60 and a response from a previous account cannot update the current chat',async()=>{
 const f=setup(80);f.ctx.scanMessageViews();f.advance(1100);f.ctx.scanMessageViews();await f.ctx.flushMessageViews();await f.ctx.flushMessageViews();assert.deepEqual(f.calls.map(c=>c.input.messageIds.length),[60,20]);assert.equal(new Set(f.calls.flatMap(c=>[...c.input.messageIds])).size,80);
 const g=setup();let done;g.ctx.api=()=>new Promise(resolve=>done=resolve);g.ctx.scanMessageViews();g.advance(1100);g.ctx.scanMessageViews();const pending=g.ctx.flushMessageViews();g.ctx.data={user:{id:'carol'}};g.ctx.scanMessageViews();done({views:[{id:'message-0',view_count:99,viewed_by_me:true}]});await pending;assert.equal(g.messages[0].view_count,0);
});
test('DM views use the active conversation; failed requests back off without inventing a count',async()=>{
 const f=setup();f.ctx.page='messages';f.ctx.scanMessageViews();f.advance(1100);f.ctx.scanMessageViews();await f.ctx.flushMessageViews();assert.equal(f.calls[0].input.kind,'dm');assert.equal(f.calls[0].input.id,'bob');
 const g=setup();let attempts=0;g.ctx.api=async()=>{attempts++;throw Error('Unavailable');};g.ctx.scanMessageViews();g.advance(1100);g.ctx.scanMessageViews();await g.ctx.flushMessageViews();g.advance(5000);g.ctx.scanMessageViews();await g.ctx.flushMessageViews();assert.equal(attempts,1);assert.equal(g.messages[0].view_count,0);
});
