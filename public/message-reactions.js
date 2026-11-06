'use strict';
function messageReactionsHTML(m,kind){return `<div class="message-reactions">${(m.reactions||[]).map(r=>`<button class="message-reaction ${r.mine?'selected':''}" aria-pressed="${r.mine}" aria-label="${e(r.emoji)}: ${r.count} reactions" data-message-react="${m.id}" data-kind="${kind}" data-emoji="${e(r.emoji)}" data-enabled="${!r.mine}">${e(r.emoji)} <span>${r.count}</span></button>`).join('')}<button class="reaction-add" aria-label="React to message" data-reaction-picker="${m.id}" data-kind="${kind}">☺＋</button></div>`;}
document.addEventListener('click',async ev=>{
 const b=ev.target.closest('[data-reaction-picker],[data-message-react]');if(!b)return;
 if(!requireUser())return;
 if(b.dataset.reactionPicker){const id=b.dataset.reactionPicker,kind=b.dataset.kind,m=(kind==='room'?roomMessages:chatMessages).find(x=>x.id===id);if(!m)return;showModal(`<h2 id="modal-title">React to message</h2><div class="reaction-picker">${['❤️','👍','🔥','😂','👏','😮'].map(emoji=>`<button aria-label="${emoji}" data-message-react="${id}" data-kind="${kind}" data-emoji="${emoji}" data-enabled="${!m.reactions?.some(r=>r.emoji===emoji&&r.mine)}">${emoji}</button>`).join('')}</div>`);return;}
 b.disabled=true;const owner=data.user.id,peer=activeChat,room=activeRoom;
 try{await api('message-react',{id:b.dataset.messageReact,kind:b.dataset.kind,emoji:b.dataset.emoji,enabled:b.dataset.enabled==='true'});if(owner!==data.user?.id)return;if(b.closest('#modal'))closeModal();if(b.dataset.kind==='room'&&room===activeRoom)await pollRoom();if(b.dataset.kind==='dm'&&peer===activeChat){chatMessages=(await api('messages',undefined,{id:peer})).messages;const box=$('.chat-bubbles');if(box)patchMediaLog(box,bubbles());}}
 catch(err){toast(err.message);}finally{b.disabled=false;}
});
