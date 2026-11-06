'use strict';
let wonderSound=true,wonderAudio=null,wonderOwner=null,wonderReceipt=null,wonderFetch=null,wonderPreloaded=false;
let wonderSoundFile=null,wonderSoundLoad=null,wonderSoundBuffer=null,wonderAudioVoice=null,wonderAudioEpoch=0,activeChestReveal=null;
try{wonderSound=localStorage.getItem('vyx-drop-sound')!=='off';}catch{}
function wonderSoundButton(){return `<button class="wonder-sound" data-wonder-sound aria-pressed="${wonderSound}" aria-label="${wonderSound?'Turn drop sound off':'Turn drop sound on'}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4Z"/>${wonderSound?'<path d="M17 8c3 2 3 6 0 8m2-11c5 4 5 10 0 14"/>':'<path d="m17 9 5 6m0-6-5 6"/>'}</svg><span>Sound ${wonderSound?'on':'off'}</span></button>`;}
function showWonder(html,keepAudio=false){showModal(html,{keepDropAudio:keepAudio});document.querySelector('#modal').classList.add('is-wonder');}
function preloadWonderAudio(){
 if(wonderSoundFile)return Promise.resolve(wonderSoundFile);
 if(!wonderSoundLoad)wonderSoundLoad=fetch('/assets/audio/chest-open.wav').then(r=>{if(!r.ok)throw Error('Sound unavailable');return r.arrayBuffer();}).then(bytes=>wonderSoundFile=bytes).catch(()=>null).finally(()=>{wonderSoundLoad=null;});
 return wonderSoundLoad;
}
function prepareWonderAudio(){
 if(!wonderSound)return Promise.resolve(null);
 try{
  const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return Promise.resolve(null);
  wonderAudio??=new Audio({latencyHint:'interactive'});
  const resume=wonderAudio.state==='suspended'?wonderAudio.resume():Promise.resolve();
  return Promise.all([resume,preloadWonderAudio()]).then(async([,bytes])=>{if(!bytes)return null;if(!wonderSoundBuffer)wonderSoundBuffer=await wonderAudio.decodeAudioData(bytes.slice(0));return wonderSoundBuffer;}).catch(()=>null);
 }catch{return Promise.resolve(null);}
}
function stopWonderAudio(){
 wonderAudioEpoch++;const voice=wonderAudioVoice;wonderAudioVoice=null;
 if(voice)try{const now=wonderAudio.currentTime;voice.gain.gain.cancelScheduledValues(now);voice.gain.gain.setValueAtTime(voice.gain.gain.value,now);voice.gain.gain.linearRampToValueAtTime(0,now+.035);voice.source.stop(now+.04);}catch{}
 document.body.dataset.dropAudio='idle';
}
function playWonderSound(preview=false){
 stopWonderAudio();if(!wonderSound||document.hidden)return;
 const epoch=wonderAudioEpoch,requested=performance.now();
 prepareWonderAudio().then(buffer=>{
  if(!buffer||epoch!==wonderAudioEpoch||!wonderSound||document.hidden||wonderAudio.state!=='running')return;
  // Catch up to the animation if decoding took time; never delay the visual result.
  const offset=preview?1.7:(performance.now()-requested)/1000;if(offset>=buffer.duration)return;
  try{
   const source=wonderAudio.createBufferSource(),gain=wonderAudio.createGain(),now=wonderAudio.currentTime;source.buffer=buffer;
   gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(preview?.3:.6,now+.018);
   if(preview){gain.gain.setValueAtTime(.3,now+.22);gain.gain.linearRampToValueAtTime(0,now+.45);}
   source.connect(gain);gain.connect(wonderAudio.destination);const voice={source,gain};wonderAudioVoice=voice;
   source.onended=()=>{source.disconnect();gain.disconnect();if(wonderAudioVoice===voice){wonderAudioVoice=null;document.body.dataset.dropAudio='idle';}};
   source.start(now,offset,...(preview?[.48]:[]));document.body.dataset.dropAudio='playing';
  }catch{document.body.dataset.dropAudio='unavailable';}
 });
}
function playWonderChime(){playWonderSound(true);}
function playWonderOpening(){playWonderSound(false);}
function presentChestOpening(html,tier,owner,token){
 let finished=false;const finish=()=>{if(finished||token!==revealToken||data.user?.id!==owner||document.querySelector('#modal-backdrop').hidden)return;finished=true;activeChestReveal=null;showModal(html,{keepDropAudio:true});};
 if(reduceMotion()){showModal(html);playWonderChime();return;}
 showWonder(`<div class="drop-arrival"><div class="wonder-modal-top"><span class="pill-label gold">YOUR SEASONAL CHEST</span>${wonderSoundButton()}</div><h2 id="modal-title">Something good<br>is <em>inside.</em></h2>${dropSceneHTML('opening',tier)}<div class="wonder-arrival-bottom"><p class="modal-subtitle">Opening your chest…</p><button class="text-link" data-chest-skip>Skip to result</button></div></div>`);
 activeChestReveal={finish};playWonderOpening();setTimeout(finish,DROP_SCENE_TIMING.opening);
}
function preloadWonder(){if(wonderPreloaded)return;wonderPreloaded=true;if(wonderSound)preloadWonderAudio();for(const name of ['reliquary-open','drop-sanctuary']){const im=new Image();im.src='/assets/wonder/'+name+'.webp';}}
function resetRoomWonder(){stopWonderAudio();wonderOwner=null;wonderReceipt=null;wonderFetch=null;updateRoomWonder();}
async function hydrateRoomWonder(d,owner){
 if(wonderOwner!==owner){wonderOwner=owner;wonderReceipt=null;}
 const id=d.nextUnopened;if(!id){wonderReceipt=null;updateRoomWonder();return;}
 if(wonderReceipt?.id===id){updateRoomWonder();return;}if(wonderFetch===id)return;wonderFetch=id;
 try{const r=await api('drop-result',undefined,{id});if(data.user?.id!==owner||wonderOwner!==owner||wonderFetch!==id)return;wonderReceipt=r;updateRoomWonder();}catch{}finally{if(wonderFetch===id)wonderFetch=null;}
}
function roomWonderHTML(id){
 if(!data.user||wonderOwner!==data.user.id||wonderReceipt?.revealedAt||!wonderReceipt)return '';
 const own=wonderReceipt.rooms.find(r=>r.id===id);if(!own)return '';
 return `<button class="room-wonder-invitation" data-drop-open="${e(wonderReceipt.id)}"><span class="room-wonder-art"><img src="/assets/wonder/reliquary-closed.webp" width="120" height="80" alt=""></span><span><small>YOUR ROOM DROP HAS ARRIVED</small><strong>A moment you made together.</strong><span>${fmt(own.amount)} VP recorded · Reveal your round</span></span><b aria-hidden="true">↗</b></button>`;
}
function updateRoomWonder(){
 const slot=document.querySelector('[data-room-wonder-slot]');if(slot&&typeof activeRoom!=='undefined'){const log=document.querySelector('.room-chat-log'),bottom=log&&log.scrollHeight-log.scrollTop-log.clientHeight<65;slot.innerHTML=roomWonderHTML(activeRoom);if(bottom)log.scrollTop=log.scrollHeight;}
}
function acknowledgeRoomWonder(r){if(wonderReceipt?.id===r.id){wonderReceipt.revealedAt=r.revealedAt;updateRoomWonder();}}
document.addEventListener('click',ev=>{const button=ev.target.closest('[data-wonder-sound]');if(!button)return;wonderSound=!wonderSound;try{localStorage.setItem('vyx-drop-sound',wonderSound?'on':'off');}catch{}if(wonderSound){prepareWonderAudio();playWonderChime();}else stopWonderAudio();document.querySelectorAll('[data-wonder-sound]').forEach(el=>{el.outerHTML=wonderSoundButton();});});
document.addEventListener('visibilitychange',()=>{document.body.classList.toggle('wonder-paused',document.hidden);if(document.hidden)stopWonderAudio();});
document.addEventListener('click',ev=>{if(ev.target.closest('[data-chest-skip]')){stopWonderAudio();activeChestReveal?.finish();}});
// A small pointer response on art, never on the chat or on coarse-pointer devices.
let wonderFrame=0;
document.addEventListener('pointermove',ev=>{if(!matchMedia('(hover:hover) and (pointer:fine)').matches||matchMedia('(prefers-reduced-motion:reduce)').matches||document.body.dataset.motion==='reduced')return;const el=ev.target.closest('.club-hero-art,.chest-art-button');if(!el)return;if(wonderFrame)return;wonderFrame=requestAnimationFrame(()=>{wonderFrame=0;if(!el.isConnected)return;const r=el.getBoundingClientRect();el.style.setProperty('--art-x',(((ev.clientX-r.left)/r.width-.5)*5).toFixed(2)+'deg');el.style.setProperty('--art-y',(-((ev.clientY-r.top)/r.height-.5)*5).toFixed(2)+'deg');});},{passive:true});
document.addEventListener('pointerout',ev=>{const el=ev.target.closest('.club-hero-art,.chest-art-button');if(el&&!el.contains(ev.relatedTarget)){el.style.removeProperty('--art-x');el.style.removeProperty('--art-y');}},{passive:true});
