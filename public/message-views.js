'use strict';
let messageViewOwner=null,messageViewEpoch=0,messageViewScope=null,messageViewRoot=null,messageViewsBusy=false,messageViewsTimer=null;
const messageViewDwell=new Map(),messageViewAcks=new Set(),messageViewQueued=new Set(),messageViewQueue=new Map(),messageViewCooldown=new Map();
function messageViewKey(kind,id){return kind+':'+id;}
function resetMessageViews(owner=null){
 messageViewOwner=owner;messageViewEpoch++;messageViewScope=null;messageViewRoot=null;
 messageViewDwell.clear();messageViewAcks.clear();messageViewQueued.clear();messageViewQueue.clear();messageViewCooldown.clear();clearTimeout(messageViewsTimer);messageViewsTimer=null;
}
function messageViewContext(){
 if(typeof data==='undefined'||!data.user)return null;
 if(page==='rooms'&&activeRoom&&roomInfo?.joined&&!roomLoading){const root=$('.room-chat-log');return root?{owner:data.user.id,kind:'room',id:activeRoom,root,messages:roomMessages,selector:'[data-room-message]',attribute:'roomMessage'}:null;}
 if(page==='messages'&&activeChat){const root=$('.chat-bubbles');return root?{owner:data.user.id,kind:'dm',id:activeChat,root,messages:chatMessages,selector:'[data-dm-message]',attribute:'dmMessage'}:null;}
 return null;
}
function messageNodeVisible(node,root){
 if(!node.isConnected||!root.isConnected)return false;
 const a=node.getBoundingClientRect(),b=root.getBoundingClientRect();
 const top=Math.max(0,b.top),bottom=Math.min(window.innerHeight,b.bottom),left=Math.max(0,b.left),right=Math.min(window.innerWidth,b.right);
 if(bottom<=top||right<=left||a.height<=0||a.width<=0)return false;
 const height=Math.max(0,Math.min(a.bottom,bottom)-Math.max(a.top,top)),width=Math.max(0,Math.min(a.right,right)-Math.max(a.left,left));
 return height>=Math.min(a.height*.5,(bottom-top)*.5)&&width>=Math.min(a.width*.5,(right-left)*.5);
}
function scheduleMessageViewFlush(){if(messageViewsTimer||!messageViewQueue.size)return;messageViewsTimer=setTimeout(()=>{messageViewsTimer=null;flushMessageViews();},700);}
function scanMessageViews(){
 const owner=typeof data==='undefined'?null:data.user?.id||null;if(owner!==messageViewOwner)resetMessageViews(owner);
 const context=messageViewContext();
 if(!context||document.hidden||!$('#modal-backdrop')?.hidden||$('.app-shell')?.inert){messageViewDwell.clear();messageViewScope=null;messageViewRoot=null;return;}
 const scope=context.kind+':'+context.id;
 if(messageViewScope!==scope||messageViewRoot!==context.root){messageViewDwell.clear();messageViewScope=scope;messageViewRoot=context.root;}
 const now=Date.now(),visible=new Set();
 for(const node of context.root.querySelectorAll(context.selector)){
  const id=node.dataset[context.attribute],message=context.messages.find(m=>m.id===id),key=messageViewKey(context.kind,id);
  if(!message||message.sender_id===owner||message.viewed_by_me||messageViewAcks.has(key)||messageViewQueued.has(key)||(messageViewCooldown.get(key)||0)>now)continue;
  if(!messageNodeVisible(node,context.root))continue;
  visible.add(key);const since=messageViewDwell.get(key);
  if(since===undefined){messageViewDwell.set(key,now);continue;}
  if(now-since<1000)continue;
  if(!messageViewQueue.has(scope))messageViewQueue.set(scope,{owner,kind:context.kind,id:context.id,ids:new Set()});
  messageViewQueue.get(scope).ids.add(id);messageViewQueued.add(key);messageViewDwell.delete(key);
 }
 for(const key of messageViewDwell.keys())if(!visible.has(key))messageViewDwell.delete(key);
 scheduleMessageViewFlush();
}
async function flushMessageViews(){
 if(messageViewsBusy||!messageViewQueue.size)return;
 const [scope,task]=messageViewQueue.entries().next().value;
 if(task.owner!==data.user?.id){resetMessageViews(data.user?.id||null);return;}
 const epoch=messageViewEpoch,ids=[...task.ids].slice(0,60);for(const id of ids)task.ids.delete(id);if(!task.ids.size)messageViewQueue.delete(scope);
 messageViewsBusy=true;
 try{
  const result=await api('message-views',{kind:task.kind,id:task.id,messageIds:ids});
  if(epoch!==messageViewEpoch||task.owner!==data.user?.id)return;
  for(const row of result.views||[]){
   if(!ids.includes(row.id))continue;
   const key=messageViewKey(task.kind,row.id);if(row.viewed_by_me)messageViewAcks.add(key);
   const current=messageViewContext();if(!current||current.kind!==task.kind||current.id!==task.id)continue;
   const message=current.messages.find(m=>m.id===row.id);if(message){message.view_count=row.view_count;message.viewed_by_me=row.viewed_by_me;}
   for(const counter of current.root.querySelectorAll('[data-message-view-count]'))if(counter.dataset.messageViewCount===row.id&&counter.dataset.kind===task.kind){
    const count=Math.max(0,Number(row.view_count)||0),label=count+' unique '+(count===1?'view':'views');counter.setAttribute('aria-label',label);counter.querySelector('.message-view-number').textContent=fmt(count);
   }
  }
 }catch{
  if(epoch===messageViewEpoch&&task.owner===data.user?.id)for(const id of ids)messageViewCooldown.set(messageViewKey(task.kind,id),Date.now()+30000);
 }finally{
  if(epoch===messageViewEpoch)for(const id of ids)messageViewQueued.delete(messageViewKey(task.kind,id));
  messageViewsBusy=false;scheduleMessageViewFlush();
 }
}
setInterval(scanMessageViews,500);
document.addEventListener('visibilitychange',()=>{messageViewDwell.clear();if(!document.hidden)scanMessageViews();});
document.addEventListener('scroll',scanMessageViews,{capture:true,passive:true});
window.addEventListener('resize',()=>{messageViewDwell.clear();scanMessageViews();});
window.addEventListener('hashchange',()=>{messageViewDwell.clear();messageViewScope=null;messageViewRoot=null;});
window.addEventListener('vyx-auth-changed',()=>resetMessageViews(data.user?.id||null));
