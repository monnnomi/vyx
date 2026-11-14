'use strict';
// A small private inbox refresh, independent of farming, X API and page navigation.
const liveInbox={owner:null,ready:false,versions:new Set(),pending:new Map(),cards:new Map(),etag:'',timer:null,controller:null,failures:0,lastFetch:0,lastServer:0,suspended:false};
function noticeVersion(n){return n.id+'@'+n.created_at;}
function notificationGlyph(n){return ({drop:'chest',follow:'people',like:'heart',message:'message','room-mention':'comment'})[n.kind]||'comment';}
function syncLiveNotificationOwner(){
 const owner=data.user?.id||null;if(owner===liveInbox.owner)return;
 clearTimeout(liveInbox.timer);liveInbox.controller?.abort();
 liveInbox.owner=owner;liveInbox.ready=false;liveInbox.versions.clear();liveInbox.pending.clear();liveInbox.etag='';liveInbox.lastServer=0;liveInbox.failures=0;liveInbox.lastFetch=0;
 for(const id of [...liveInbox.cards.keys()])dismissLiveNotice(id);
 if(owner)scheduleNotifications(5000);
}
function scheduleNotifications(delay){clearTimeout(liveInbox.timer);if(liveInbox.owner&&!liveInbox.suspended)liveInbox.timer=setTimeout(pollNotifications,delay);}
function notificationTray(){
 let tray=document.getElementById('live-notifications');if(!tray){tray=document.createElement('section');tray.id='live-notifications';tray.className='live-notifications';tray.setAttribute('aria-label','New notifications');tray.setAttribute('aria-live','polite');tray.setAttribute('aria-relevant','additions');document.body.append(tray);}return tray;
}
function dismissLiveNotice(id){const card=liveInbox.cards.get(id);if(!card)return;clearTimeout(card.timer);card.element.remove();liveInbox.cards.delete(id);}
function showLiveNotice(n){
 while(liveInbox.cards.size>=3)dismissLiveNotice(liveInbox.cards.keys().next().value);
 const element=document.createElement('article'),id=noticeVersion(n);element.className='live-notice';
 element.innerHTML=`<button class="live-notice-open" data-live-notice="${e(n.id)}"><span class="live-notice-symbol">${icon(notificationGlyph(n))}</span><span class="live-notice-copy"><small>VYX · Just now</small><strong>${e(n.title)}</strong><span>${e(n.body)}</span></span><span class="live-notice-arrow" aria-hidden="true">↗</span></button><button class="live-notice-dismiss" aria-label="Dismiss notification">×</button>`;
 element.querySelector('.live-notice-dismiss').addEventListener('click',()=>dismissLiveNotice(id));
 const card={element,timer:null},expire=()=>{if(element.matches(':hover, :focus-within')){card.timer=setTimeout(expire,1000);return;}dismissLiveNotice(id);};
 card.timer=setTimeout(expire,10000);liveInbox.cards.set(id,card);notificationTray().append(element);
}
async function flushNotificationPopups(){
 if(document.hidden||!liveInbox.owner||!liveInbox.pending.size)return;
 const owner=liveInbox.owner;
 const show=()=>{
  if(owner!==liveInbox.owner||document.hidden)return;
  let shown=[];try{shown=JSON.parse(localStorage.getItem('vyx-notice-shown-v1:'+owner)||'[]');if(!Array.isArray(shown))shown=[];}catch{}
  for(const [key,n] of liveInbox.pending){
   liveInbox.pending.delete(key);if(shown.includes(key))continue;
   shown.push(key);showLiveNotice(n);
  }
  try{localStorage.setItem('vyx-notice-shown-v1:'+owner,JSON.stringify(shown.slice(-300)));}catch{}
 };
 // Visible windows share a short lock; notification contents never enter storage.
 if(navigator.locks?.request)await navigator.locks.request('vyx-notices:'+owner,show);else show();
}
function acceptLiveNotifications(snapshot,owner=data.user?.id){
 syncLiveNotificationOwner();if(!snapshot||!owner||owner!==liveInbox.owner)return false;
 const stamp=Date.parse(snapshot.serverNow)||0;if(stamp&&stamp<liveInbox.lastServer)return false;liveInbox.lastServer=stamp;
 const previous=liveInbox.versions,next=new Set(snapshot.items.map(noticeVersion));
 if(liveInbox.ready)for(const n of [...snapshot.items].reverse())if(n.unread&&!previous.has(noticeVersion(n)))liveInbox.pending.set(noticeVersion(n),n);
 liveInbox.versions=next;liveInbox.ready=true;inboxData=snapshot;
 for(const [key] of liveInbox.pending)if(!snapshot.items.some(n=>noticeVersion(n)===key&&n.unread))liveInbox.pending.delete(key);
 for(const [key] of liveInbox.cards)if(!snapshot.items.some(n=>noticeVersion(n)===key&&n.unread))dismissLiveNotice(key);
 renderProductBadge();flushNotificationPopups();return true;
}
async function pollNotifications(){
 syncLiveNotificationOwner();const owner=liveInbox.owner;if(!owner)return;
 if(liveInbox.controller)return;
 const controller=new AbortController();liveInbox.controller=controller;liveInbox.lastFetch=Date.now();
 const timeout=setTimeout(()=>controller.abort(),20000);
 try{
  const response=await fetch('/api/vyx?action=notifications',{credentials:'same-origin',cache:'no-store',headers:liveInbox.etag?{'If-None-Match':liveInbox.etag}:{},signal:controller.signal});
  if(owner!==data.user?.id||owner!==liveInbox.owner)return;
  if(response.status===401){data.user=null;inboxData=null;syncLiveNotificationOwner();renderProductBadge();return;}
  if(response.status!==304){
   if(!response.ok)throw new Error('Inbox unavailable');
   const snapshot=await response.json();liveInbox.etag=response.headers.get('ETag')||'';
   if(acceptLiveNotifications(snapshot,owner)&&page==='notifications'){
    // Activity has no composer. Preserve keyboard focus and document scroll.
    const focused=document.activeElement?.closest('[data-open-notice]')?.dataset.openNotice;
    $('#main-content').innerHTML=renderNotifications();
    if(focused)$$('[data-open-notice]').find(b=>b.dataset.openNotice===focused)?.focus({preventScroll:true});
   }
  }
  liveInbox.failures=0;
 }catch{if(owner===liveInbox.owner)liveInbox.failures=Math.min(liveInbox.failures+1,4);}
 finally{clearTimeout(timeout);if(liveInbox.controller===controller)liveInbox.controller=null;if(owner===liveInbox.owner)scheduleNotifications(Math.min(60000,(document.hidden?20000:5000)*2**liveInbox.failures));}
}
async function openLiveNotification(id){
 const n=inboxData?.items.find(n=>n.id===id);if(!n)return;
 try{
  if(n.unread){await api('notifications-read',{id:n.id,createdAt:n.created_at});n.unread=false;inboxData.unreadCount=Math.max(0,(inboxData.unreadCount||0)-1);liveInbox.etag='';renderProductBadge();}
  dismissLiveNotice(noticeVersion(n));closeModal();
  if(n.kind==='follow')await personModal(n.target);
  else if(n.kind==='message'){activeChat=n.target;chatMessages=[];go('messages');}
  else if(n.kind==='room-mention')await openRoom(n.target);
  else if(n.kind==='drop')await openDrop(new Date(n.target).toISOString());
  else{go('feed');await commentsModal(n.target);}
 }catch(err){toast(err.message);}
}
document.addEventListener('click',ev=>{const button=ev.target.closest('[data-live-notice],[data-open-notice]');if(button)openLiveNotification(button.dataset.liveNotice||button.dataset.openNotice);});
function resumeNotifications(){syncLiveNotificationOwner();flushNotificationPopups();if(liveInbox.owner&&Date.now()-liveInbox.lastFetch>2000)scheduleNotifications(0);}
document.addEventListener('visibilitychange',resumeNotifications);
window.addEventListener('focus',resumeNotifications);
window.addEventListener('online',resumeNotifications);
window.addEventListener('vyx-auth-changed',resumeNotifications);
window.addEventListener('pagehide',()=>{liveInbox.suspended=true;clearTimeout(liveInbox.timer);liveInbox.controller?.abort();});
window.addEventListener('pageshow',()=>{liveInbox.suspended=false;resumeNotifications();});
