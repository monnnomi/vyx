'use strict';
let halloweenClock=null;
const halloweenArt='assets/halloween-chest-2026.png';
function syncHalloweenClock(event){if(event?.serverNow)halloweenClock={now:Date.parse(event.serverNow),at:performance.now()};}
function halloweenRemaining(){return !halloweenClock||!data.event?null:Math.max(0,Date.parse(data.event.endsAt)-halloweenClock.now-(performance.now()-halloweenClock.at));}
function halloweenStage(){
 if(!data.event)return 'loading';if(data.event.minted)return 'minted';
 return data.event.status==='ended'||halloweenRemaining()===0?'ended':data.event.status;
}
function halloweenTimerHTML(){
 const ms=halloweenRemaining(),seconds=ms===null?null:Math.ceil(ms/1000);
 const values=seconds===null?['--','--','--','--']:[Math.floor(seconds/86400),Math.floor(seconds/3600)%24,Math.floor(seconds/60)%60,seconds%60].map(v=>String(v).padStart(2,'0'));
 return values.map((v,i)=>`<span><b>${v}</b><small>${['DAYS','HRS','MIN','SEC'][i]}</small></span>`).join('');
}
function halloweenActionHTML(){
 const stage=halloweenStage();
 if(stage==='loading')return '<button class="halloween-claim" disabled>Preparing your chest…</button>';
 if(stage==='minted')return `<div class="halloween-collected">${icon('check')} Halloween chest minted <small>One per X account · saved to your collection</small></div><button class="text-link" data-action="mint-receipt">View mint receipt ↗</button>`;
 if(stage==='ended')return '<button class="halloween-claim" disabled>Mint closed</button><span class="halloween-claim-note">This Halloween mint has ended.</span>';
 if(stage==='upcoming')return '<button class="halloween-claim" disabled>Coming soon</button>';
 return `<button class="halloween-claim" data-action="claim-halloween">${data.user?'Mint free chest':'Connect X to mint'} ${icon('arrow')}</button><span class="halloween-claim-note">Free · one per X account · no quests required</span>`;
}
function halloweenHTML(compact=false){const stage=halloweenStage(),owned=data.event?.minted;return `<section class="halloween-drop halloween-drop-compact ${stage==='ended'?'halloween-ended':''}" aria-label="Halloween chest mint"><img src="${halloweenArt}" alt="Halloween collectible chest" width="200" height="200"><div class="halloween-content"><div class="halloween-eyebrow">SEASONAL ARCHIVE / 2026</div><h2>The Halloween edition.</h2><p>A keepsake from the first VYX season. No VP attached.</p><div class="halloween-claim-slot">${halloweenActionHTML()}</div><small class="halloween-archive-note">Mint window closed November 1, 00:00 UTC.</small></div></section>`;}
function mintReceiptModal(){
 if(!data.event?.minted)return;
 const time=new Date(data.event.mintedAt).toLocaleString('en-GB',{timeZone:'UTC',dateStyle:'medium',timeStyle:'short'});
 showModal(`<div class="halloween-reveal"><span class="halloween-eyebrow">HALLOWEEN 2026 · MINTED</span><h2 id="modal-title">This little fright<br>is yours.</h2><img src="${halloweenArt}" alt="Your minted Halloween collectible"><p>Your chest is saved to your VYX collection.<br>This collectible has no points reward.</p><dl class="mint-details"><dt>Minted</dt><dd>${e(time)} UTC</dd><dt>Receipt</dt><dd>${e(data.event.mintId)}</dd></dl><button class="halloween-claim" data-action="copy-mint">Copy mint receipt ${icon('check')}</button><button class="text-link" data-action="close">Back to my circle</button></div>`);
}
async function claimHalloweenChest(){
 if(!requireUser())return;
 const result=await write('mint-event',{});
 if(!result){await refresh().catch(()=>{});return;}
 mintReceiptModal();
}
function openHalloweenChest(){mintReceiptModal();}
function rewardName(record){return record.source==='x-task'?'X task reward':record.source==='room-drop'?'Room drop · '+escapeHTML(record.room_name||'Your circle'):tiers[record.tier]?.name||'Reward';}
function chestCount(){return inventory().reduce((a,b)=>a+b,0);}
let previousHalloweenStage=null;
setInterval(()=>{
 for(const timer of $$('.halloween-timer'))timer.innerHTML=halloweenTimerHTML();
 const stage=halloweenStage();
 if(stage!==previousHalloweenStage){for(const slot of $$('.halloween-claim-slot'))slot.innerHTML=halloweenActionHTML();for(const card of $$('.halloween-drop'))card.classList.toggle('halloween-ended',stage==='ended');previousHalloweenStage=stage;}
},1000);
