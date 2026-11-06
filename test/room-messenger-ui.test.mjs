import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/room-messenger.js',import.meta.url),'utf8');
function setup(){
 const log={scrollHeight:1000,scrollTop:700,clientHeight:300},shell={inert:false},doc={hidden:false,addEventListener(){}};
 const ctx=vm.createContext({document:doc,setInterval(){},setTimeout,clearTimeout,BigInt,Date,Map,Set,
  $:q=>q==='.room-chat-log'?log:q==='.app-shell'?shell:null,crypto:{randomUUID:()=> 'fixture-request'},
  page:'rooms',data:{user:{id:'alice'}},activeRoom:'circle',roomInfo:{joined:true},roomLoading:false,roomEpoch:1,roomReadSeq:'5',
  roomMessages:[{id:'visible',seq:'9'}],roomList:[{id:'circle',unread_count:4}],homeRooms:[],roomDrafts:new Map(),roomReplies:new Map(),
  api:async()=>({last_read_seq:'9',room:{id:'circle',unread_count:0}})
 });vm.runInContext(source,ctx);return {ctx,log,shell,doc};
}
test('read acknowledgements require a visible chat at the bottom and send the last delivered cursor',async()=>{
 const {ctx,log,shell,doc}=setup(),calls=[];ctx.api=async(action,input)=>{calls.push({action,input});return {last_read_seq:'9',room:{id:'circle',unread_count:1}};};
 doc.hidden=true;await ctx.markRoomRead();doc.hidden=false;shell.inert=true;await ctx.markRoomRead();shell.inert=false;
 log.scrollTop=100;await ctx.markRoomRead();assert.equal(calls.length,0);
 log.scrollTop=700;await ctx.markRoomRead();assert.equal(calls.length,1);assert.equal(calls[0].action,'room-read');assert.equal(calls[0].input.through,'9');
 assert.equal(ctx.roomReadSeq,'9');assert.equal(ctx.roomList[0].unread_count,1);
 await ctx.markRoomRead();assert.equal(calls.length,1);
});
test('duplicate acknowledgements are suppressed and a previous account cannot change current room state',async()=>{
 const {ctx}=setup();let resolve,calls=0;ctx.api=()=>{calls++;return new Promise(r=>resolve=r);};
 const pending=ctx.markRoomRead();await ctx.markRoomRead();assert.equal(calls,1);
 ctx.data={user:{id:'bob'}};resolve({last_read_seq:'9',room:{id:'circle',unread_count:0}});await pending;
 assert.equal(ctx.roomReadSeq,'5');assert.equal(ctx.roomList[0].unread_count,4);
});
test('a failed acknowledgement does not clear unread state and can be retried',async()=>{
 const {ctx}=setup();ctx.api=async()=>{throw Error('Offline');};await ctx.markRoomRead();assert.equal(ctx.roomReadSeq,'5');assert.equal(ctx.roomList[0].unread_count,4);
 ctx.api=async()=>({last_read_seq:'9',room:{id:'circle',unread_count:0}});await ctx.markRoomRead();assert.equal(ctx.roomReadSeq,'9');
});
test('activity refresh applies server order while preserving the open chat and composer draft',async()=>{
 const {ctx,doc}=setup(),list={innerHTML:''},field={value:'My unsent reply'};
 Object.assign(ctx,{roomPage:0,roomFilter:'all',roomSearch:'',roomNextPage:null,roomCards:()=>ctx.roomList.map(r=>r.id).join(',')});
 ctx.$=q=>q==='.room-directory-list'?list:q==='#room-search'?field:null;doc.activeElement=field;
 ctx.api=async()=>({rooms:[{id:'most-active'},{id:'circle'}],nextPage:null});
 await ctx.pollRoomDirectory();
 assert.equal(list.innerHTML,'most-active,circle');assert.equal(ctx.activeRoom,'circle');assert.equal(ctx.roomMessages[0].id,'visible');assert.equal(field.value,'My unsent reply');
});
test('guests also receive fresh activity order without a sign-in or chat read',async()=>{
 const {ctx}=setup(),list={innerHTML:''},calls=[];
 Object.assign(ctx,{data:{user:null},roomPage:0,roomFilter:'all',roomSearch:'',roomNextPage:null,roomCards:()=>ctx.roomList.map(r=>r.id).join(',')});
 ctx.$=q=>q==='.room-directory-list'?list:null;
 ctx.api=async action=>{calls.push(action);return {rooms:[{id:'active-guest-room'}],nextPage:null};};
 await ctx.pollRoomDirectory();assert.deepEqual(calls,['rooms']);assert.equal(list.innerHTML,'active-guest-room');
});
