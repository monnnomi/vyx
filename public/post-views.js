'use strict';
let postViewOwner=null,postViewEpoch=0,postViewsBusy=false,postViewsTimer=null;
const postViewDwell=new Map(),postViewAcks=new Map(),postViewQueued=new Set(),postViewQueue=new Set(),postViewCooldown=new Map();
function resetPostViews(owner=null){
 postViewOwner=owner;postViewEpoch++;postViewDwell.clear();postViewAcks.clear();postViewQueued.clear();postViewQueue.clear();postViewCooldown.clear();clearTimeout(postViewsTimer);postViewsTimer=null;
}
function syncPostViewOwner(){const owner=typeof data==='undefined'?null:data.user?.id||null;if(owner!==postViewOwner)resetPostViews(owner);return owner;}
function postViewsHTML(p){
 syncPostViewOwner();const count=Math.max(0,Number(p.view_count)||0,postViewAcks.get(p.id)||0);
 return `<span class="post-view-count" data-post-view-count="${p.id}" data-count="${count}" aria-label="${count} unique ${count===1?'view':'views'}" title="Unique signed-in viewers. The author is not counted."><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg><span class="post-view-number">${fmt(count)}</span></span>`;
}
function postViewRoot(){
 if(!$('#modal-backdrop')?.hidden)return $('#modal');
 if($('.app-shell')?.inert)return null;
 return $('#main-content');
}
function schedulePostViewFlush(){if(postViewsTimer||!postViewQueue.size)return;postViewsTimer=setTimeout(()=>{postViewsTimer=null;flushPostViews();},700);}
function scanPostViews(){
 const owner=syncPostViewOwner(),root=postViewRoot();
 if(!owner||!root||document.hidden){postViewDwell.clear();return;}
 const now=Date.now(),visible=new Set();
 for(const node of root.querySelectorAll('[data-post-view-id]')){
  const id=node.dataset.postViewId;
  if(node.dataset.postViewAuthor===owner||node.dataset.postViewed==='true'||postViewAcks.has(id)||postViewQueued.has(id)||(postViewCooldown.get(id)||0)>now)continue;
  if(!messageNodeVisible(node,root))continue;
  visible.add(id);const dwell=postViewDwell.get(id);
  if(!dwell||dwell.node!==node||dwell.root!==root){postViewDwell.set(id,{since:now,node,root});continue;}
  if(now-dwell.since<1000)continue;
  postViewQueue.add(id);postViewQueued.add(id);postViewDwell.delete(id);
 }
 for(const id of postViewDwell.keys())if(!visible.has(id))postViewDwell.delete(id);
 schedulePostViewFlush();
}
function applyPostView(row){
 const count=Math.max(0,Number(row.view_count)||0);if(row.viewed_by_me)postViewAcks.set(row.id,Math.max(count,postViewAcks.get(row.id)||0));
 const lists=[data.posts,typeof feedPosts==='undefined'?null:feedPosts,typeof profilePosts==='undefined'?null:profilePosts,typeof exploreState==='undefined'?null:exploreState?.posts];
 for(const list of lists)for(const p of list||[])if(p.id===row.id){p.view_count=Math.max(Number(p.view_count)||0,count);p.viewed_by_me=row.viewed_by_me;}
 for(const node of document.querySelectorAll('[data-post-view-id]'))if(node.dataset.postViewId===row.id)node.dataset.postViewed=String(row.viewed_by_me);
 for(const counter of document.querySelectorAll('[data-post-view-count]'))if(counter.dataset.postViewCount===row.id){
  const n=counter.querySelector('.post-view-number'),value=Math.max(count,Number(counter.dataset.count)||0);counter.dataset.count=String(value);counter.setAttribute('aria-label',value+' unique '+(value===1?'view':'views'));if(n)n.textContent=fmt(value);
 }
}
async function flushPostViews(){
 if(postViewsBusy||!postViewQueue.size)return;
 const owner=syncPostViewOwner();if(!owner||!postViewQueue.size)return;
 const epoch=postViewEpoch,ids=[...postViewQueue].slice(0,60);for(const id of ids)postViewQueue.delete(id);postViewsBusy=true;
 try{
  const result=await api('post-views',{postIds:ids});
  if(epoch!==postViewEpoch||owner!==data.user?.id)return;
  for(const row of result.views||[])if(ids.includes(row.id))applyPostView(row);
 }catch{
  if(epoch===postViewEpoch&&owner===data.user?.id)for(const id of ids)postViewCooldown.set(id,Date.now()+30000);
 }finally{
  if(epoch===postViewEpoch)for(const id of ids)postViewQueued.delete(id);
  postViewsBusy=false;schedulePostViewFlush();
 }
}
setInterval(scanPostViews,500);
document.addEventListener('visibilitychange',()=>{postViewDwell.clear();if(!document.hidden)scanPostViews();});
document.addEventListener('scroll',scanPostViews,{capture:true,passive:true});
window.addEventListener('resize',()=>{postViewDwell.clear();scanPostViews();});
window.addEventListener('hashchange',()=>postViewDwell.clear());
window.addEventListener('vyx-auth-changed',()=>resetPostViews(data.user?.id||null));
