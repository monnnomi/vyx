'use strict';
let roomReadFlight=null,roomDirectoryPolling=false;
let mentionTimer=null,mentionVersion=0,mentionOptions=[],mentionIndex=0,mentionRange=null;
function roomMessageTime(value){const d=new Date(value),now=new Date();return e(d.toDateString()===now.toDateString()?d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}):d.toLocaleDateString('en-US',{month:'short',day:'numeric'}));}
function roomMessageText(body,mentions=[]){
 const known=new Set(mentions.map(p=>p.handle.toLowerCase()));
 return body.split(/(@[a-zA-Z0-9_][a-zA-Z0-9_.]{2,23})/g).map(part=>{
  const handle=part.slice(1).toLowerCase(),trimmed=handle.replace(/\.+$/,'');
  if(part[0]==='@'&&(known.has(handle)||known.has(trimmed))){const name=known.has(handle)?part:part.slice(0,trimmed.length+1);return `<span class="room-mention">${e(name)}</span>${e(part.slice(name.length))}`;}
  return e(part);
 }).join('');
}
function roomPinnedHTML(){return roomPinned?`<div class="room-pinned-note"><button data-room-quote="${roomPinned.id}"><span class="room-pin-label">PINNED MESSAGE <b>${e(roomPinned.name)}</b></span><span>${e(roomPinned.body||'Attachment')}</span></button>${roomInfo?.owner_id===data.user?.id?'<button class="room-unpin" data-room-unpin aria-label="Unpin message">×</button>':''}</div>`:'';}
function roomReplyHTML(){const reply=roomReplies.get(activeRoom);return reply?`<div class="room-reply-draft"><span><strong>Replying to ${e(reply.name)}</strong><span>${e(reply.body)}</span></span><button data-room-cancel-reply aria-label="Cancel reply">×</button></div>`:'';}
function updateRoomReply(){const log=$('.room-chat-log'),bottom=log&&log.scrollHeight-log.scrollTop-log.clientHeight<80,slot=$('[data-room-reply-slot]');if(slot)slot.innerHTML=roomReplyHTML();if(bottom)log.scrollTop=log.scrollHeight;}
function saveRoomDraft(){const field=$('#room-message-input');if(!field||!activeRoom)return;const media=JSON.stringify(typeof mediaDraftIds==='function'?mediaDraftIds('room:'+activeRoom):[]),body=field.value,replyTo=roomReplies.get(activeRoom)?.id||null,old=roomDrafts.get(activeRoom);roomDrafts.set(activeRoom,{body,replyTo,media,requestId:old?.body===body&&old.replyTo===replyTo&&old.media===media?old.requestId:crypto.randomUUID()});}
function resetRoomMessenger(){roomReadFlight=null;hideRoomMentions();}
function patchRoomSummary(summary){
 if(!summary)return;roomList=roomList.map(r=>r.id===summary.id?{...r,...summary}:r);homeRooms=homeRooms.map(r=>r.id===summary.id?{...r,...summary}:r);
 const row=$(`.chat-room-list [data-room-open="${summary.id}"]`)?.closest('.room-list-item');if(row)row.outerHTML=roomCard(summary,true);
}
async function markRoomRead(){
 const log=$('.room-chat-log'),last=roomMessages.at(-1);
 if(page!=='rooms'||!data.user||!activeRoom||!roomInfo?.joined||roomLoading||document.hidden||$('.app-shell')?.inert||!log||!last||log.scrollHeight-log.scrollTop-log.clientHeight>35||BigInt(last.seq)<=BigInt(roomReadSeq)||roomReadFlight)return;
 const task={id:activeRoom,owner:data.user.id,epoch:roomEpoch,through:last.seq};roomReadFlight=task;
 try{
  const result=await api('room-read',{id:task.id,through:task.through});
  if(task.owner!==data.user?.id)return;patchRoomSummary(result.room);
  if(task.id===activeRoom&&task.epoch===roomEpoch)roomReadSeq=String(BigInt(roomReadSeq)>BigInt(result.last_read_seq)?roomReadSeq:result.last_read_seq);
 }catch{}finally{if(roomReadFlight===task)roomReadFlight=null;}
}
async function pollRoomDirectory(){
 if(document.hidden||!['feed','rooms'].includes(page)||roomDirectoryPolling)return;
 // Preserve a paginated directory and the active conversation rather than replacing them.
 if(page==='rooms'&&roomPage>0)return;
 const owner=data.user?.id,current=page,filter=roomFilter,search=roomSearch;roomDirectoryPolling=true;
 try{
  const result=await api('rooms',undefined,current==='rooms'?{filter,search}:{});
  if(owner!==data.user?.id||current!==page||document.hidden)return;
  if(current==='feed'){
   homeRooms=result.rooms;const list=$('.home-room-list');if(list)list.innerHTML=homeRooms.length?homeRooms.slice(0,3).map(r=>roomCard(r,true)).join(''):'<div role="listitem"><button class="secondary" data-action="rooms">Find your room ↗</button></div>';
  }else if(filter===roomFilter&&search===roomSearch){
   const wasEmpty=!roomList.length,field=$('#room-search'),draft=field?.value,focused=document.activeElement===field;roomList=result.rooms;roomNextPage=result.nextPage;
   if(!activeRoom&&wasEmpty!==!roomList.length){render();if($('#room-search')&&draft!==undefined){$('#room-search').value=draft;if(focused)$('#room-search').focus();}}
   else{const list=$('.room-directory-list');if(list)list.innerHTML=roomCards();}
  }
 }catch{}finally{roomDirectoryPolling=false;}
}
function hideRoomMentions(){clearTimeout(mentionTimer);mentionVersion++;mentionOptions=[];mentionRange=null;const menu=$('#room-mention-menu');if(menu){menu.hidden=true;menu.innerHTML='';}const field=$('#room-message-input');field?.setAttribute('aria-expanded','false');field?.removeAttribute('aria-activedescendant');}
function currentMention(){
 const field=$('#room-message-input');if(!field||field.selectionStart!==field.selectionEnd)return null;
 const at=field.selectionStart,match=field.value.slice(0,at).match(/(?:^|\s)@([a-zA-Z0-9_.]{0,24})$/);
 return match?{start:at-match[1].length-1,end:at,query:match[1],value:field.value}:null;
}
function paintRoomMentions(){
 const menu=$('#room-mention-menu'),field=$('#room-message-input');if(!menu||!field)return;
 menu.innerHTML=mentionOptions.map((p,i)=>`<button type="button" role="option" id="room-mention-${i}" aria-selected="${i===mentionIndex}" data-room-mention="${i}" tabindex="-1"><span>${e(p.name)}</span><small>@${e(p.handle)}</small></button>`).join('');
 menu.hidden=!mentionOptions.length;field.setAttribute('aria-expanded',String(!menu.hidden));if(!menu.hidden)field.setAttribute('aria-activedescendant','room-mention-'+mentionIndex);
}
function scheduleRoomMentions(){
 hideRoomMentions();const range=currentMention();if(!range)return;
 const id=activeRoom,owner=data.user?.id,version=mentionVersion;
 mentionTimer=setTimeout(async()=>{
  try{const result=await api('room-mention-candidates',undefined,{id,search:range.query});
   if(version!==mentionVersion||id!==activeRoom||owner!==data.user?.id||currentMention()?.value!==range.value||document.activeElement?.id!=='room-message-input')return;
   mentionRange=range;mentionOptions=result.members;mentionIndex=0;paintRoomMentions();
  }catch{}
 },220);
}
function insertRoomMention(index){
 const person=mentionOptions[index],range=mentionRange,field=$('#room-message-input');if(!person||!range||!field)return;
 const insertion='@'+person.handle+' ';field.value=field.value.slice(0,range.start)+insertion+field.value.slice(range.end);const at=range.start+insertion.length;
 hideRoomMentions();field.focus();field.setSelectionRange(at,at);saveRoomDraft();
}
function roomMentionKey(ev){
 if(ev.isComposing||!mentionOptions.length)return false;
 if(ev.key==='ArrowDown'||ev.key==='ArrowUp'){ev.preventDefault();mentionIndex=(mentionIndex+(ev.key==='ArrowDown'?1:-1)+mentionOptions.length)%mentionOptions.length;paintRoomMentions();return true;}
 if(ev.key==='Enter'&&!ev.shiftKey){ev.preventDefault();insertRoomMention(mentionIndex);return true;}
 if(ev.key==='Escape'){ev.preventDefault();hideRoomMentions();return true;}return false;
}
async function showRoomMessage(messageId){
 const node=$(`[data-room-message="${messageId}"]`);
 if(node){node.scrollIntoView({block:'center',behavior:document.body.dataset.motion==='reduced'?'instant':'smooth'});node.classList.add('room-message-highlight');setTimeout(()=>node.classList.remove('room-message-highlight'),1800);return;}
 const id=activeRoom,owner=data.user?.id,result=await api('room-message',undefined,{id,messageId});if(id!==activeRoom||owner!==data.user?.id)return;
 const m=result.message;showModal(`<span class="eyebrow">FROM ${e(roomInfo.name)}</span><h2 id="modal-title">${e(m.name)}</h2><p class="modal-subtitle">${date(m.created_at)}</p>${m.media?.length?mediaHTML(m.media):''}<p class="room-message-detail">${roomMessageText(m.body,m.mentions)}</p><button class="secondary" data-room-modal-reply="${m.id}">Reply to this message ↩</button>`);
}
document.addEventListener('click',async ev=>{
 const b=ev.target.closest('button');if(!b)return;const d=b.dataset;
 try{
  if(d.roomReply||d.roomModalReply){const messageId=d.roomReply||d.roomModalReply,id=activeRoom,owner=data.user?.id;let m=roomMessages.find(m=>m.id===messageId);if(!m)m=(await api('room-message',undefined,{id,messageId})).message;if(id!==activeRoom||owner!==data.user?.id)return;if(d.roomModalReply)closeModal();roomReplies.set(id,m);saveRoomDraft();hideRoomMentions();updateRoomReply();$('#room-message-input')?.focus();}
  if('roomCancelReply' in d){roomReplies.delete(activeRoom);saveRoomDraft();updateRoomReply();$('#room-message-input')?.focus();}
  if(d.roomQuote)await showRoomMessage(d.roomQuote);
  if(d.roomPin||'roomUnpin' in d){closeModal();const id=activeRoom,messageId=d.roomPin&&roomPinned?.id!==d.roomPin?d.roomPin:null;if(await roomWrite('room-pin',{id,messageId})){if(id===activeRoom){await pollRoom();toast(messageId?'Message pinned.':'Message unpinned.');}}}
  if('roomMention' in d)insertRoomMention(Number(d.roomMention));
 }catch(err){toast(err.message);}
});
document.addEventListener('pointerdown',ev=>{if(ev.target.closest('[data-room-mention]'))ev.preventDefault();else if(!ev.target.closest('.room-compose-area'))hideRoomMentions();});
document.addEventListener('scroll',ev=>{if(ev.target.matches?.('.room-chat-log'))markRoomRead();},true);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){markRoomRead();pollRoomDirectory();}});
setInterval(pollRoomDirectory,15000);
