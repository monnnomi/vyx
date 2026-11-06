import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/social-shell.js',import.meta.url),'utf8');
function setup(){
 const field={focus(){this.focused=true;}},directory={outerHTML:'original'},scroll={scrollTop:175};
 const ctx=vm.createContext({document:{activeElement:field,addEventListener(){}},Map,Set,Date,
  page:'rooms',activeRoom:'open-conversation',roomMessages:[{id:'existing-message'}],roomDrafts:new Map([['open-conversation',{body:'Unsent reply'}]]),data:{user:{id:'alice'}},
  $:q=>q==='.chat-directory'?directory:q==='#room-search'?field:q==='.chat-directory-scroll'?scroll:null,
  fetchRoomList:async()=>{},render(){throw Error('Must not replace the conversation');}
 });vm.runInContext(source,ctx);ctx.socialChatDirectory=()=> 'updated directory';return {ctx,field,directory,scroll};
}
test('search and pagination update only the room pane and retain the active thread and draft',async()=>{
 const {ctx,field,directory,scroll}=setup();let fetched;ctx.fetchRoomList=async append=>fetched=append;
 await ctx.reloadRoomDirectory(true);assert.equal(fetched,true);assert.equal(directory.outerHTML,'updated directory');assert.equal(scroll.scrollTop,175);assert.equal(field.focused,true);
 assert.equal(ctx.activeRoom,'open-conversation');assert.equal(ctx.roomMessages[0].id,'existing-message');assert.equal(ctx.roomDrafts.get('open-conversation').body,'Unsent reply');
 await ctx.reloadRoomDirectory(false);assert.equal(scroll.scrollTop,0);
});
test('a directory response from an old account does not replace the current account pane',async()=>{
 const {ctx,directory}=setup();let finish;ctx.fetchRoomList=()=>new Promise(r=>finish=r);
 const pending=ctx.reloadRoomDirectory();ctx.data={user:{id:'bob'}};finish();await pending;assert.equal(directory.outerHTML,'original');
});
