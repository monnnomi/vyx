'use strict';
let roomList=[],roomFilter='all',roomSearch='',roomNextPage=null,roomPage=0,roomsLoaded=false;
let activeRoom=null,roomInfo=null,roomMessages=[],roomBefore=null,roomBusy=false,roomLoading=false,roomEpoch=0;
const roomDrafts=new Map(),roomReplies=new Map();
let roomPinned=null,roomReadSeq='0',roomEntryReadSeq='0';
function rememberRoomSignIn(){if(!data.user)try{sessionStorage.setItem('vyx-room-return',activeRoom||'discover');}catch{}}
async function resumeRoomAfterSignIn(){
 let target;try{target=sessionStorage.getItem('vyx-room-return');sessionStorage.removeItem('vyx-room-return');}catch{}
 if(data.user&&(target==='discover'||/^[0-9a-f-]{36}$/i.test(target||''))){page='rooms';activeRoom=target==='discover'?null:target;roomURL(activeRoom);await loadRooms();}
}
const requestedRoom=new URL(location.href).searchParams.get('room');
if(/^[0-9a-f-]{36}$/i.test(requestedRoom||'')){activeRoom=requestedRoom;roomLoading=true;}
function roomMark(r){return `<span class="room-mark room-tone-${clubRoomTone(r)}" aria-hidden="true">${e(r.name.slice(0,1).toUpperCase())}</span>`;}
function roomPoster(r){const tone=clubRoomTone(r);return `<div class="room-poster poster-${tone}" aria-hidden="true">${roomCoverArt(tone)}<span class="poster-issue">VYX / GOOD COMPANY</span><span class="poster-room-initial">${e(r.name.slice(0,1).toUpperCase())}</span><span class="poster-caption">ROOM FOR EVERYONE.</span><span class="poster-arrow">↗</span></div>`;}
function roomCard(r,compact=false){const last=r.joined&&roomFilter==='mine'?r.last_message:null,unread=r.joined?Number(r.unread_count||0):0;return `<div class="room-list-item" role="listitem"><button class="room-row ${compact?'room-row-compact':''} ${r.id===activeRoom?'selected':''} ${unread?'has-unread':''}" data-room-open="${r.id}" aria-label="${r.joined?'Open chat':'Explore room'}: ${e(r.name)}${unread?`, ${unread} unread messages`:''}"><span class="room-row-cover" aria-hidden="true">${socialRoomAvatar(r)}</span><span class="room-row-info"><span class="room-row-name">${e(r.name)}</span>${last?`<span class="room-row-preview"><b>${e(last.sender_id===data.user?.id?'You':last.name)}:</b> ${e(last.body)}</span>`:`<span class="room-row-description">${e(r.description||'A shared space for good conversations.')}</span>`}${!last&&r.topic?`<span class="room-current-topic">${e(r.topic)}</span>`:''}<span class="room-row-byline">${r.language?`<span>${e(r.language)}</span>`:''}<span class="room-row-members">${icon('people')} ${fmt(r.member_count)} ${r.member_count===1?'member':'members'}</span>${r.joined?'<span class="room-row-joined">Joined</span>':''}${r.owner_name?`<span class="room-row-host">Hosted by ${e(r.owner_name)}</span>`:''}</span></span><span class="room-row-tail">${last?`<time datetime="${e(last.created_at)}" title="${e(date(last.created_at))}">${roomMessageTime(last.created_at)}</time>`:''}<span class="room-row-indicators">${r.mention_count?'<span class="room-mention-badge" aria-label="You were mentioned">@</span>':''}${unread?`<span class="room-unread-badge" aria-label="${unread} unread messages">${unread>99?'99+':unread}</span>`:`<span class="room-row-entry"><span>${r.joined?'Open chat':'Explore'}</span>${icon('arrowup')}</span>`}</span></span></button></div>`;}



function clearRoomState(){roomEpoch++;roomList=[];roomInfo=null;roomMessages=[];roomDrafts.clear();roomReplies.clear();roomPinned=null;roomReadSeq='0';roomEntryReadSeq='0';resetRoomMessenger();roomsLoaded=false;roomFilter='all';activeRoom=null;clearFarmingState();}
function roomURL(id){const url=new URL(location.href);url.searchParams.delete('auth');if(id)url.searchParams.set('room',id);else url.searchParams.delete('room');url.hash='rooms';history.replaceState({},'',url);}
function roomCards(){return roomList.map(r=>roomCard(r,true)).join('');}
function renderRooms(){return socialRooms();}

function roomBubbles(){
 if(roomLoading)return loadingPanel('Loading the conversation…');if(roomLoadError)return errorPanel(roomLoadError,'data-room-retry');
 const firstUnread=roomMessages.find(m=>m.sender_id!==data.user?.id&&BigInt(m.seq)>BigInt(roomEntryReadSeq));
 return roomMessages.map(m=>`${m.id===firstUnread?.id?'<div class="room-unread-divider">New messages</div>':''}<article class="room-message ${m.sender_id===data.user?.id?'mine':''} ${m.mentions?.some(p=>p.id===data.user?.id)?'mentions-you':''}" data-room-message="${m.id}">${avatar(m)}<div class="room-message-content"><div class="room-message-by"><strong>${e(m.name)}</strong><time datetime="${e(m.created_at)}">${roomMessageTime(m.created_at)}</time></div>${m.reply?`<button class="room-quote" data-room-quote="${m.reply.id}" ${m.reply.removed?'disabled':''}><strong>${m.reply.removed?'Message removed':e(m.reply.name)}</strong>${!m.reply.removed?`<span>${e(m.reply.body)}</span>`:''}</button>`:''}${m.media?.length?mediaHTML(m.media):''}<p>${roomMessageText(m.body,m.mentions)}</p>${messageReactionsHTML(m,'room')}<div class="room-message-actions"><button data-social-message-menu="${m.id}" aria-label="Message actions for ${e(m.name)}">${icon('more')}</button></div></div></article>`).join('')||'<div class="room-chat-empty"><span>✦</span><h2>Every circle starts with hello.</h2><p>Be the first to say something.</p></div>';
}

let roomDetailsOpen=false,roomLoadError='';
function renderRoomThread(){
 const r=roomInfo||roomList.find(r=>r.id===activeRoom);
 if(!r&&roomLoadError)return errorPanel(roomLoadError,'data-room-retry');
 if(!r)return `<button class="text-link" data-room-action="back">← All rooms</button><div class="rooms-empty"><h2>${roomLoading?'Opening your room…':'This room is unavailable.'}</h2><p>${roomLoading?'Just a moment.':'Go back to discover another circle.'}</p></div>`;
 const joined=r.joined&&data.user;
 return `<section class="room-thread ${joined?'is-member':''}" aria-label="Room ${e(r.name)}"><div class="room-conversation"><header class="room-thread-header"><button class="icon-button conversation-back" data-room-action="back" aria-label="Back to chats">${icon('back')}</button>${socialRoomAvatar(r)}<div><h1>${e(r.name)}</h1><button class="text-link room-member-count" data-room-action="members" ${joined?'':'disabled'}>${fmt(r.member_count)} ${r.member_count===1?'member':'members'} <span>·</span> Community room</button></div><div class="conversation-header-actions"><button class="icon-button" data-room-action="share" aria-label="Copy invite link">${icon('arrowup')}</button>${joined?`<button class="icon-button" data-room-action="details" aria-expanded="${roomDetailsOpen}" aria-label="Room details and contribution">${icon('info')}</button><button class="room-options" data-room-action="options" aria-label="Room options">${icon('more')}</button>`:''}</div></header>${joined?`${r.topic?`<div class="room-topic"><b>Talking about</b> ${e(r.topic)}</div>`:''}<div id="room-pinned">${roomPinnedHTML()}</div><div class="room-history-tools">${roomBefore?'<button class="text-link" data-room-action="older">Earlier messages ↑</button>':'<span>The start of this conversation</span>'}<span id="room-connection" role="status">Up to date</span></div><div class="room-chat-log" role="log" aria-label="Room messages" aria-relevant="additions text" tabindex="0">${roomBubbles()}</div><div data-room-wonder-slot>${roomWonderHTML(r.id)}</div><button class="latest-messages" data-social-latest hidden>Latest messages ↓</button><div class="room-compose-area"><div data-room-reply-slot>${roomReplyHTML()}</div><div id="room-mention-menu" class="room-mention-menu" role="listbox" aria-label="Mention a room member" hidden></div><form class="room-chat-form" id="room-chat-form" data-media-form="room:${r.id}">${typeof mediaComposerHTML==='function'?mediaComposerHTML('room:'+r.id,'room',r.id):''}<label class="sr-only" for="room-message-input">Message to ${e(r.name)}</label><textarea id="room-message-input" name="body" aria-autocomplete="list" aria-controls="room-mention-menu" aria-expanded="false" rows="1" maxlength="2000" placeholder="Message…" required>${e(roomDrafts.get(r.id)?.body||'')}</textarea><button class="primary" aria-label="Send to room">${icon('send')}</button>${typeof mediaDraftHTML==='function'?mediaDraftHTML('room:'+r.id):''}</form><p class="room-compose-note">Enter to send <span>·</span> Shift + Enter for a new line <span>·</span> @ to mention</p></div>`:`<div class="room-join-screen">${roomPoster(r)}<div><span class="eyebrow">YOU'RE INVITED</span><h2>Join the conversation.</h2><p>${e(r.description||'Join this room to meet its people and read the conversation.')}</p><button class="primary" data-room-action="join">${data.user?'Join this room':'Continue with X'} ${icon('arrowup')}</button><small>Anyone signed in can join. Members can read the full conversation history.</small></div></div>`}</div>${joined?`<aside class="room-context ${roomDetailsOpen?'is-open':''}"><div class="room-context-heading"><span class="eyebrow">ROOM DETAILS</span><button class="icon-button mobile-room-details" data-room-action="details" aria-label="Close room details">×</button></div>${r.description?`<p class="room-description">${e(r.description)}</p>`:''}<button class="context-members" data-room-action="members">${icon('people')}<span>Meet the members</span>${icon('arrowup')}</button>${roomFarmingHTML(r.id)}${roomList.filter(x=>x.joined&&x.id!==r.id).length?`<div class="context-other-rooms"><span class="eyebrow">YOUR OTHER ROOMS</span>${roomList.filter(x=>x.joined&&x.id!==r.id).slice(0,5).map(x=>`<button data-room-open="${x.id}">${roomMark(x)}<span>${e(x.name)}</span>${icon('arrowup')}</button>`).join('')}</div>`:''}</aside>`:''}</section>`;
}

async function fetchRoomList(append=false){
 const filter=roomFilter,search=roomSearch,userId=data.user?.id;
 const result=await api('rooms',undefined,{filter,search,page:append?roomNextPage:0});
 if(filter!==roomFilter||search!==roomSearch||userId!==data.user?.id)return;
 roomList=append?[...new Map([...roomList,...result.rooms].map(r=>[r.id,r])).values()]:result.rooms;
 roomNextPage=result.nextPage;roomPage=append?roomPage+1:0;roomsLoaded=true;
}
async function loadRooms(){
 const epoch=++roomEpoch,id=activeRoom;roomLoading=true;roomLoadError='';
 try{
  await fetchRoomList();if(epoch!==roomEpoch||page!=='rooms')return;
  if(id){
   const summary=await api('room-info',undefined,{id});if(epoch!==roomEpoch)return;roomInfo=summary.room;
   if(data.user&&roomInfo.joined){try{const t=await api('room-thread',undefined,{id});if(epoch!==roomEpoch)return;roomInfo={...roomInfo,...t.room};roomMessages=t.messages;roomBefore=t.nextBefore;roomPinned=t.pinned;roomReadSeq=t.lastReadSeq;roomEntryReadSeq=t.lastReadSeq;}
    catch(err){if(epoch!==roomEpoch)return;roomMessages=[];roomBefore=null;roomLoadError=err.message;toast(err.message);}}
   else {roomMessages=[];roomBefore=null;roomPinned=null;}
  }
 }catch(err){if(epoch===roomEpoch){if(id){roomLoadError=err.message;roomMessages=[];}toast(err.message);}}finally{if(epoch===roomEpoch){roomLoading=false;if(page==='rooms'){render();const log=$('.room-chat-log');if(log)log.scrollTop=log.scrollHeight;markRoomRead();refreshRoomFarming(true);}}}
}
async function openRoom(id){
 if(roomBusy)return;trackProduct('room_open');hideRoomMentions();roomPinned=null;roomReadSeq='0';roomEntryReadSeq='0';roomDetailsOpen=false;activeRoom=id;roomInfo=roomList.find(r=>r.id===id)||null;roomMessages=[];roomBefore=null;roomLoading=true;page='rooms';roomURL(id);render();window.scrollTo({top:0,behavior:'instant'});await loadRooms();
}
function createRoomModal(){rememberRoomSignIn();if(!requireUser())return;showModal(`<h2 id="modal-title">Make room for your people.</h2><p class="modal-subtitle">Create an open group around something you love. Anyone on VYX can discover and join it.</p><form id="room-create-form" data-request="${crypto.randomUUID()}"><label class="modal-field">Room name<input name="name" placeholder="e.g. The Night Circle" minlength="3" maxlength="48" required></label><label class="modal-field">About your room <span class="muted">(optional)</span><textarea name="description" placeholder="What brings your circle together?" maxlength="240" rows="3"></textarea></label><label class="modal-field">Language<input name="language" maxlength="40" placeholder="e.g. English, Русский"></label><label class="modal-field">Current topic<input name="topic" maxlength="120" placeholder="A question or discussion to join"></label><p class="room-form-note">You’ll be the owner and first member. Members can read the full conversation. Up to 500 members per room.</p><button class="primary" type="submit">Create room ${icon('arrow')}</button></form>`);$('#room-create-form input').focus();}
async function roomWrite(action,input){
 if(!requireUser()||roomBusy)return null;roomBusy=true;document.body.classList.add('saving');
 try{return await api(action,input);}catch(err){toast(err.message);return null;}
 finally{roomBusy=false;document.body.classList.remove('saving');}
}
async function showRoomMembers(memberPage=0){
 if(!requireUser())return;const id=activeRoom,result=await api('room-members',undefined,{id,page:memberPage});if(id!==activeRoom)return;
 const list=result.members.map(m=>`<div class="room-member">${avatar(m)}<div><strong>${e(m.name)}</strong><small>${compactHandle(m.handle)}</small></div>${m.id===roomInfo.owner_id?'<span class="badge">Owner</span>':''}</div>`).join('');
 if(memberPage){$('#room-members-list')?.insertAdjacentHTML('beforeend',list);$('#room-more-members')?.remove();}
 else showModal(`<h2 id="modal-title">People in this circle</h2><p class="modal-subtitle">${e(roomInfo.name)} · ${fmt(roomInfo.member_count)} members</p><div id="room-members-list">${list}</div>`);
 if(result.nextPage!==null)$('#modal').insertAdjacentHTML('beforeend',`<button id="room-more-members" class="secondary load-more" data-room-member-page="${result.nextPage}">More members ↓</button>`);
}
document.addEventListener('click',async ev=>{
 const b=ev.target.closest('button');if(!b)return;const d=b.dataset;
 try{
  if(d.roomOpen){await openRoom(d.roomOpen);return;}
  if(d.roomFilter){rememberRoomSignIn();if(d.roomFilter==='mine'&&!requireUser())return;roomFilter=d.roomFilter;await reloadRoomDirectory();}
  if(d.roomMemberPage)await showRoomMembers(Number(d.roomMemberPage));
  if(d.roomRemove){showModal(`<h2 id="modal-title">Remove this message?</h2><p class="modal-subtitle">It will disappear from this room for everyone.</p><button class="primary" data-room-delete="${e(d.roomRemove)}">Remove message</button>`);}
  if(d.roomDelete){if(await roomWrite('room-delete-message',{id:activeRoom,messageId:d.roomDelete})){roomMessages=roomMessages.filter(m=>m.id!==d.roomDelete);closeModal();await loadRooms();}}
  if(!d.roomAction)return;const a=d.roomAction;
  if(a==='create')createRoomModal();
  if(a==='details'){roomDetailsOpen=!roomDetailsOpen;$('.room-context')?.classList.toggle('is-open',roomDetailsOpen);$$('[data-room-action=details]').forEach(el=>el.setAttribute('aria-expanded',String(roomDetailsOpen)));}
  if(a==='back'){roomEpoch++;page='rooms';activeRoom=null;roomInfo=null;roomMessages=[];roomURL(null);render();await loadRooms();}
  if(a==='discover'){roomFilter='all';await loadRooms();}
  if(a==='more')await reloadRoomDirectory(true);
  if(a==='join'){rememberRoomSignIn();if(!requireUser())return;if(await roomWrite('room-join',{id:activeRoom})){trackProduct('room_join');toast('Welcome to the circle ✦');await loadRooms();}}
  if(a==='share')await copy(location.origin+'/?room='+activeRoom+'#rooms');
  if(a==='members'&&roomInfo?.joined)await showRoomMembers();
  if(a==='options'){const owner=roomInfo.owner_id===data.user?.id;showModal(`<h2 id="modal-title">${e(roomInfo.name)}</h2><p class="modal-subtitle">${owner?'You own this room. You can remove messages or close the room for everyone.':'Leaving removes your access to the conversation. Your earlier messages stay in this room.'}</p><button class="secondary load-more" data-room-action="share">Copy room link ↗</button>${owner?'<button class="secondary" data-edit-room>Edit room details</button>':''}<button class="secondary" data-mute-room="${activeRoom}">Mute room mentions</button><button class="secondary" data-report-kind="room" data-report-id="${activeRoom}">Report room</button><button class="primary" data-room-action="${owner?'confirm-close':'leave'}">${owner?'Close room…':'Leave room'}</button>`);}
  if(a==='confirm-close')showModal('<h2 id="modal-title">Close this circle?</h2><p class="modal-subtitle">The room will disappear from discovery. Everyone will lose access to the conversation.</p><button class="primary" data-room-action="close">Close room for everyone</button>');
  if(a==='leave'||a==='close'){const id=activeRoom;if(await roomWrite(a==='leave'?'room-leave':'room-close',{id})){roomDrafts.delete(id);roomReplies.delete(id);closeModal();activeRoom=null;roomInfo=null;roomMessages=[];roomURL(null);await loadRooms();toast(a==='leave'?'You left the room.':'Room closed.');}}
  if(a==='older'&&roomBefore){const id=activeRoom,t=await api('room-thread',undefined,{id,before:roomBefore});if(id!==activeRoom)return;const box=$('.room-chat-log'),oldHeight=box?.scrollHeight||0,oldTop=box?.scrollTop||0;roomMessages=[...new Map([...t.messages,...roomMessages].map(m=>[m.id,m])).values()];roomBefore=t.nextBefore;render();const next=$('.room-chat-log');if(next)next.scrollTop=next.scrollHeight-oldHeight+oldTop;}
 }catch(err){toast(err.message);}
});
document.addEventListener('input',ev=>{if(ev.target.id==='room-message-input'){saveRoomDraft();scheduleRoomMentions();}});
document.addEventListener('keydown',ev=>{if(ev.target.id==='room-message-input'){
 if(roomMentionKey(ev))return;
 if(ev.key==='Enter'&&!ev.shiftKey&&!ev.isComposing){ev.preventDefault();ev.target.form.requestSubmit();}
}});
document.addEventListener('submit',async ev=>{
 const f=ev.target;if(!['room-create-form','room-chat-form','room-search-form'].includes(f.id))return;ev.preventDefault();const values=Object.fromEntries(new FormData(f));
 if(f.id==='room-search-form'){roomSearch=values.search.trim();await reloadRoomDirectory();}
 if(f.id==='room-create-form'){const result=await roomWrite('room-create',{...values,requestId:f.dataset.request});if(result){closeModal();await openRoom(result.id);toast('Your room is ready ✦');}}
 if(f.id==='room-chat-form'){
  const id=activeRoom,message=values.body.trim(),key='room:'+id;let ids;try{ids=mediaSendIds(key);}catch(err){toast(err.message);return;}if(!message&&!ids.length||roomBusy)return;
  const old=roomDrafts.get(id),replyTo=roomReplies.get(id)?.id||null,requestId=old?.body?.trim()===message&&old.replyTo===replyTo&&old.media===JSON.stringify(ids)?old.requestId:crypto.randomUUID();roomDrafts.set(id,{body:values.body,requestId,replyTo,media:JSON.stringify(ids)});
  const result=await roomWrite('room-send',{id,body:message,requestId,replyTo,mediaIds:ids});
  if(result){trackProduct('message_sent');if(message&&!ids.length&&result.farming&&!result.farming.counted)toast('Message sent. It doesn’t qualify for VP this round: '+result.farming.reason);if(roomDrafts.get(id)?.requestId===requestId){roomDrafts.delete(id);roomReplies.delete(id);}if(activeRoom!==id)clearMediaDraft(key);if(activeRoom===id){$('#room-message-input').value=roomDrafts.get(id)?.body||'';clearMediaDraft(key);hideRoomMentions();updateRoomReply();await pollRoom(true);await refreshRoomFarming(true);$('#room-message-input')?.focus();}}
 }
});
let roomPolling=false;
async function pollRoom(forceBottom=false){
 if(page!=='rooms'||!data.user||!activeRoom||!roomInfo?.joined||roomBusy||roomLoading||roomPolling||document.hidden)return;
 const id=activeRoom,epoch=roomEpoch;roomPolling=true;
 try{
  const t=await api('room-thread',undefined,{id});if(id!==activeRoom||epoch!==roomEpoch||page!=='rooms')return;
  const previousLog=$('.room-chat-log'),wasAtBottom=previousLog&&previousLog.scrollHeight-previousLog.scrollTop-previousLog.clientHeight<80;
  const min=t.messages[0]?.seq;
  const gap=roomMessages.length&&t.messages.length&&!t.messages.some(m=>roomMessages.some(old=>old.id===m.id));
  if(gap){roomMessages=t.messages;roomBefore=t.nextBefore;render();}
  else roomMessages=[...roomMessages.filter(m=>min&&BigInt(m.seq)<BigInt(min)),...t.messages];roomInfo={...roomInfo,...t.room};roomPinned=t.pinned;roomReadSeq=String(BigInt(roomReadSeq)>BigInt(t.lastReadSeq)?roomReadSeq:t.lastReadSeq);
  const pinned=$('#room-pinned');if(pinned&&pinned.innerHTML!==roomPinnedHTML())pinned.innerHTML=roomPinnedHTML();
  const box=$('.room-chat-log');if(box){const bottom=forceBottom||wasAtBottom,top=box.scrollTop;const content=roomBubbles();if(typeof patchMediaLog==='function')patchMediaLog(box,content);else if(box.innerHTML!==content)box.innerHTML=content;box.scrollTop=bottom?box.scrollHeight:top;}
  const count=$('.room-member-count');if(count)count.innerHTML=fmt(t.room.member_count)+' '+(t.room.member_count===1?'member':'members')+' <span>·</span> Community room';
  updateLatestButton();markRoomRead();if($('#room-connection'))$('#room-connection').textContent='Up to date';
 }catch(err){
  if(id!==activeRoom||epoch!==roomEpoch)return;
  if(/Join this room|no longer available|Sign in with X/.test(err.message)){roomInfo=null;roomMessages=[];await loadRooms();}
  else if($('#room-connection'))$('#room-connection').textContent='Reconnecting… Your draft is saved here.';
 }finally{roomPolling=false;}
}
setInterval(pollRoom,10000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)pollRoom();});
