'use strict';
// Presentation and opt-in journey measurements. Reward decisions stay on the server.
const vyxInterests=['All conversations','Crypto & Web3','Building things','Art & culture','Everyday life'];
let vyxInterest='All conversations';
const vyxSendFeedback=new Map();
const vyxJourneyMemory=new Set();
function vyxOwner(){return data.user?.id||'guest';}
function vyxStored(key){try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}}
function vyxStore(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{}}
function vyxMeasured(){try{return window.VYX_ANALYTICS?.enabled&&localStorage.getItem('vyx-analytics-consent-v1')==='granted';}catch{return false;}}
function vyxJourneyOnce(event,owner=vyxOwner(),session=false){
 if(!vyxMeasured())return;
 const key='vyx-journey-v1:'+owner+':'+event,storage=session?sessionStorage:localStorage;
 try{if(storage.getItem(key))return;storage.setItem(key,'1');}catch{if(vyxJourneyMemory.has(key))return;vyxJourneyMemory.add(key);}
 trackProduct(event);
}
function vyxMeasureVisit(){
 if(!vyxMeasured())return;
 vyxJourneyOnce('visit_started','browser',true);
 let fromX=false;try{const u=new URL(location.href),r=document.referrer?new URL(document.referrer):null;fromX=['x','twitter','t.co'].includes((u.searchParams.get('utm_source')||'').toLowerCase())||['x.com','twitter.com','t.co'].includes(r?.hostname);}catch{}
 if(fromX)vyxJourneyOnce('visit_from_x','browser',true);
 if(!data.user)return;
 vyxJourneyOnce('signed_in_visit',vyxOwner(),true);
 const key='vyx-journey-v1:'+vyxOwner()+':first-day',today=new Date().toISOString().slice(0,10),first=vyxStored(key);
 if(!first)vyxStore(key,today);
 else if((Date.parse(today)-Date.parse(first))/86400000===1)vyxJourneyOnce('return_next_day');
 if(Number(data.user.all_points)>0)vyxJourneyOnce('first_reward_seen');
}
function vyxRoundHTML(){const f=data.farming;if(!f)return '<span>Loading the current reward round…</span>';return f.status==='active'&&f.current?`<span>Next round closes in <strong data-farm-end="${e(f.current.endsAt)}">${farmCountdown(f.current.endsAt)}</strong></span>`:`<span>${f.status==='upcoming'?'Points rounds begin soon':'This farming period has ended'}</span>`;}
function vyxFirstStepsHTML(){
 const signed=Boolean(data.user),joined=signed&&roomList.some(r=>r.joined),spoken=signed&&(data.farming?.history?.length>0||roomMessages.some(m=>m.sender_id===data.user.id)||[...vyxSendFeedback.values()].some(v=>v.owner===data.user.id));
 return `<ol class="vyx-first-steps" aria-label="Your first steps"><li class="${signed?'is-done':''}"><span>${signed?'✓':'1'}</span><div><b>Connect with X</b><small>One account for your conversations and VP.</small></div></li><li class="${joined?'is-done':''}"><span>${joined?'✓':'2'}</span><div><b>Find your people</b><small>Choose a community room that interests you.</small></div></li><li class="${spoken?'is-done':''}"><span>${spoken?'✓':'3'}</span><div><b>Join the conversation</b><small>Introduce yourself, ask a question or share a useful find.</small></div></li></ol>`;
}
function vyxGuideHTML(compact=false){return `<section class="vyx-quick-start ${compact?'is-compact':''}" aria-label="Start with VYX"><div class="vyx-section-label">YOUR FIRST CONVERSATION</div>${vyxFirstStepsHTML()}<button class="${compact?'text-link':'primary vyx-primary'}" data-vyx-start>${data.user?'Find a room & get started':'Get started with X'} ${icon('arrow')}</button></section>`;}
function vyxOfficialHTML(compact=false){return `<article class="vyx-official ${compact?'is-compact':''}" aria-label="Official VYX guide"><div class="vyx-official-top"><img src="/assets/vyx-mark-v1.png" width="32" height="32" alt=""><span>VYX TEAM <small>PINNED GUIDE</small></span></div><h2>Conversations first. Your contribution counts.</h2><p>Eligible room messages earn VP in four-hour rounds. Verified X quests add their listed VP rewards. VP are app points, not a token or a guaranteed cash reward.</p><div class="vyx-guide-links"><button data-vyx-guide="rewards">How VP work</button><button data-vyx-guide="season">Season & roadmap</button><button data-vyx-guide="nft">NFT & referrals</button><button data-action="tasks">X quests</button></div></article>`;}
function vyxRewardSummaryHTML(){const f=data.farming;if(!f)return '';const last=f.history?.[0];return `<section class="vyx-reward-summary" aria-label="Your points overview"><div class="vyx-section-label">FOUR-HOUR ROOM DROPS</div>${vyxRoundHTML()}<p>${data.user?`<strong>${fmt(points())} VP</strong> confirmed this season`:'Connect with X to earn VP for eligible room contributions.'}</p>${last?`<small>Latest receipt: +${fmt(last.amount)} VP · ${e(last.room_name)} · ${utcTime(last.ends_at)}</small>`:'<small>Confirmed results appear after the round is processed.</small>'}<button class="text-link" data-vyx-guide="rewards">Understand your rewards →</button></section>`;}
function vyxWelcomeHTML(){
 return `<div class="conversation-welcome discovery-welcome vyx-welcome"><span class="vyx-beta-label">VYX · LIVE BETA</span><h1>Your people.<br>Your conversations.<br><span>Your contribution.</span></h1><p>Meet people in community rooms, share ideas and earn VP for eligible contributions every 4 hours.</p><div class="welcome-actions"><button class="primary vyx-primary" data-vyx-start>${data.user?'Find your next conversation':'Get started with X'} ${icon('arrow')}</button><button class="secondary" data-vyx-guide="rewards">How points work</button></div><div class="vyx-round-teaser">${vyxRoundHTML()}<small>Round closing is followed by processing. Estimates are not confirmed payouts.</small></div>${vyxGuideHTML()}<div class="vyx-welcome-bottom">${vyxOfficialHTML(true)}<section class="vyx-community-note"><h2>Help shape what comes next.</h2><p>Try the beta, share feedback and build your circle. Your own NFT eligibility is available privately in your profile.</p><button class="text-link" ${data.user?'data-action="profile"':'data-action="signin"'}>View my NFT progress →</button><p class="vyx-planned-note">Planned: additional NFTs for creating rooms. Room creation remains open during beta; activation details will be announced.</p></section></div></div>`;
}
function vyxStarterRooms(){
 const words={'Crypto & Web3':/crypto|web3|nft|token|chain|defi|airdrop/i,'Building things':/build|design|project|dev|create|work/i,'Art & culture':/art|music|book|film|photo|culture/i,'Everyday life':/life|chat|meet|chill|welcome|friend|food/i};
 const match=words[vyxInterest],matches=match?roomList.filter(r=>match.test([r.name,r.description,r.topic].join(' '))):roomList;
 return {rooms:(matches.length?matches:roomList).slice(0,6),matched:!match||matches.length>0};
}
function vyxStartModal(){
 const pick=vyxStarterRooms();
 showModal(`<div class="vyx-start-modal"><span class="vyx-section-label">START WITH A CONVERSATION</span><h2 id="modal-title">What brings you here?</h2><p class="modal-subtitle">Choose an interest, then explore a room made by another member.</p><div class="vyx-interest-options" role="group" aria-label="Choose an interest">${vyxInterests.map(t=>`<button data-vyx-interest="${e(t)}" aria-pressed="${t===vyxInterest}">${e(t)}</button>`).join('')}</div>${!pick.matched?'<p class="field-help">No topic matches in the loaded rooms yet. Explore these other conversations.</p>':''}<div class="vyx-starter-rooms">${!roomsLoaded?'<p role="status">Loading community rooms…</p>':pick.rooms.map(r=>`<button class="vyx-starter-room" data-vyx-open="${e(r.id)}">${socialRoomAvatar(r)}<span><strong>${e(r.name)}</strong><small>${e(r.topic||r.description||'Meet the people in this room.')}</small><small>${e(r.language||'Community room')} · ${fmt(r.member_count)} ${r.member_count===1?'member':'members'}</small></span><b>→</b></button>`).join('')||'<p>There are no rooms to explore yet. You can create one during beta.</p>'}</div><div class="vyx-icebreakers"><b>Not sure what to say?</b><p>Introduce an interest, ask what others are working on, or share something you discovered. Write in your own words — repeated text does not earn VP.</p></div>${!data.user?'<button class="primary vyx-primary" data-action="signin">Continue with X</button>':''}<button class="text-link" data-vyx-guide="rewards">Read the points rules</button></div>`);
}
function vyxGuideModal(section='overview'){
 const headings={overview:'Welcome to VYX.',rewards:'Your conversations. Your VP.',season:'Season 1 & what comes next.',nft:'NFT eligibility & invitations.'};
 showModal(`<div class="vyx-guide-modal"><span class="vyx-section-label">OFFICIAL VYX GUIDE</span><h2 id="modal-title">${headings[section]||headings.overview}</h2><div class="vyx-guide-tabs">${[['overview','Start here'],['rewards','Points'],['season','Season'],['nft','NFT & referrals']].map(([id,label])=>`<button data-vyx-guide="${id}" aria-pressed="${section===id}">${label}</button>`).join('')}</div>${section==='overview'?`<p>VYX is a SocialFi beta for meeting people, sharing ideas and building communities through conversation.</p>${vyxFirstStepsHTML()}<button class="primary vyx-primary" data-vyx-start>Choose a community room</button>`:section==='rewards'?`<p>Eligible messages in rooms contribute to one shared VP fund. Rounds close every four hours; payouts appear after processing. X quests have fixed rewards paid separately from the promotion reserve.</p><ul class="vyx-guide-list"><li>Share an original contribution: at least 40 characters, 24 letters and 5 distinct words.</li><li>One eligible message per five minutes, at most eight per UTC hour. The first five accepted messages in a round have full weight; the next five have half weight. Limits apply across all rooms.</li><li>Your share depends on your accepted contribution and activity across VYX. Short replies are welcome, even when they do not earn VP.</li><li>Check the strip above a room’s messages for your current contribution and latest confirmed result. Processing can take up to about an hour after a round closes.</li></ul><p class="vyx-planned-note">VP are app points. They do not promise tokens or monetary value. Estimates can change; completed receipts are the confirmed result.</p><button class="secondary" data-farm-action="rules">Full reward rules & calculations</button>`:section==='season'?`<div class="vyx-guide-status"><b>Live now</b><p>Community rooms, posts, profiles, invitations, X quests, Season 1 VP farming and the leaderboard. The project remains in testing throughout the first season.</p></div><div class="vyx-guide-status is-planned"><b>Planned</b><p>NFT releases, additional room-creation benefits and a future token. The whitepaper is in preparation. Final mint pricing, launch dates and token distribution terms will be announced separately.</p></div><button class="secondary" data-action="leaderboard">View the leaderboard</button>`:`<p>Your NFT eligibility uses confirmed lifetime VP and registered referrals:</p><ul class="vyx-guide-list"><li><b>50,000+ VP and 3 referrals:</b> free NFT.</li><li><b>50,000+ VP:</b> 50% off.</li><li><b>Below 50,000 VP:</b> full mint price.</li></ul><p>See your own progress privately in your profile. A referral counts when a new account registers through your personal invitation link; inviting existing accounts does not count.</p><p class="vyx-planned-note">NFTs are not minting yet. Creating rooms is open during beta. The plan is to require additional NFTs to create rooms later; the activation rules and mint price are not final.</p><button class="primary vyx-primary" data-action="${data.user?'profile':'signin'}">${data.user?'View my NFT eligibility':'Sign in to view my progress'}</button>`}</div>`);
}
function vyxRoomProgressHTML(id){
 const f=farmRooms.get(id),feedback=vyxSendFeedback.get(id),validFeedback=feedback?.owner===data.user?.id?feedback:null,info=f||data.farming;
 if(!data.user||!roomInfo?.joined)return '';
 const last=f?.room?.drops?.find(d=>Number(d.own)>0),count=f?.room?.activity?.own;
 return `<section id="vyx-room-progress" class="vyx-room-progress" aria-label="Your room contribution"><div class="vyx-room-progress-line"><span class="vyx-live-dot"></span>${info?.status==='active'&&info.current?`<span>Round closes in <b data-farm-end="${e(info.current.endsAt)}">${farmCountdown(info.current.endsAt)}</b></span>`:'<span>Room rewards</span>'}<span>${count==null?'Loading your contribution…':`${fmt(count)} eligible ${count===1?'message':'messages'} this round`}</span><button class="text-link" data-room-action="details">Details</button></div>${validFeedback?`<p class="vyx-send-feedback ${validFeedback.counted?'is-counted':''}" role="status"><strong>${validFeedback.counted?'✓ Message counted for VP.':'Message delivered; no VP contribution.'}</strong> ${e(validFeedback.reason||'')} <button class="text-link" data-vyx-guide="rewards">Why?</button></p>`:`<p class="vyx-send-feedback">${count>0?'Your contribution is recorded for this round. Keep the conversation going.':'Share an original idea or reply. Your next eligible message starts your contribution.'}</p>`}${last?`<small>Last confirmed room drop: +${fmt(last.own)} VP · ${utcTime(last.ends_at)}</small>`:'<small>No confirmed reward in the recent room drops. Receipts appear after processing.</small>'}</section>`;
}
function vyxUpdateRoomProgress(){const node=$('#vyx-room-progress');if(node&&activeRoom)node.outerHTML=vyxRoomProgressHTML(activeRoom);}

const vyxOriginalWelcome=socialWelcome,vyxOriginalFeed=socialFeed,vyxOriginalRail=socialRail;
socialWelcome=vyxWelcomeHTML;
socialFeed=function(){return vyxOriginalFeed().replace('<div class="feed-tabs"',`${vyxOfficialHTML(true)}<div class="feed-tabs"`);};
socialRail=function(){return vyxOriginalRail().replace('<div class="quiet-rail">',`<div class="quiet-rail">${vyxRewardSummaryHTML()}`);};
const vyxOriginalDirectory=socialChatDirectory;
socialChatDirectory=function(){return vyxOriginalDirectory().replace('<form id="room-search-form"',`<section class="vyx-mobile-start" aria-label="Get started with VYX"><span class="vyx-section-label">SOCIALFI · LIVE BETA</span><h2>Talk. Connect. Earn VP.</h2><p>Join a community room. Eligible conversations earn points in four-hour rounds.</p><div class="vyx-mobile-actions"><button class="primary vyx-primary" data-vyx-start>Get started</button><button class="text-link" data-vyx-guide="rewards">How points work</button></div><div class="vyx-round-teaser">${vyxRoundHTML()}</div></section><form id="room-search-form"`);};
const vyxOriginalThread=renderRoomThread;
renderRoomThread=function(){return vyxOriginalThread().replace('<div class="room-history-tools">',`${vyxRoomProgressHTML(activeRoom)}<div class="room-history-tools">`);};
rulesModal=()=>vyxGuideModal('overview');
const vyxOriginalRoomWrite=roomWrite;
roomWrite=async function(action,input){
 const owner=data.user?.id,result=await vyxOriginalRoomWrite(action,input);
 if(result&&owner===data.user?.id){
  if(action==='room-join'||action==='room-create')vyxJourneyOnce('first_room_join',owner);
  if(action==='room-send'){
   vyxJourneyOnce('first_room_message',owner);
   vyxSendFeedback.set(input.id,{...result.farming,owner,reason:result.farming?.reason||'Attachments and ordinary replies may not qualify for VP.'});
   if(result.farming?.counted)vyxJourneyOnce('first_vp_contribution',owner);
   if(activeRoom===input.id)vyxUpdateRoomProgress();
  }
 }
 return result;
};
const vyxOriginalRefreshFarm=refreshRoomFarming;
refreshRoomFarming=async function(force=false){const id=activeRoom,owner=data.user?.id,before=farmRooms.get(id);await vyxOriginalRefreshFarm(force);if(id===activeRoom&&owner===data.user?.id&&farmRooms.get(id)!==before)vyxUpdateRoomProgress();};
const vyxOriginalGlobalFarm=refreshGlobalFarming;
refreshGlobalFarming=async function(){const before=data.farming;await vyxOriginalGlobalFarm();if(before!==data.farming){const node=$('.vyx-reward-summary');if(node)node.outerHTML=vyxRewardSummaryHTML();}};
const vyxOriginalRender=render;
render=function(){vyxOriginalRender();vyxMeasureVisit();};
window.addEventListener('vyx-auth-changed',()=>{vyxSendFeedback.clear();});
window.addEventListener('vyx-analytics-choice',()=>vyxMeasureVisit());
document.addEventListener('click',async ev=>{
 const b=ev.target.closest('button');if(!b)return;
 if(b.hasAttribute('data-vyx-start')){trackProduct('getting_started');vyxStartModal();}
 if(b.dataset.vyxInterest){vyxInterest=vyxInterests.includes(b.dataset.vyxInterest)?b.dataset.vyxInterest:vyxInterests[0];vyxStartModal();}
 if(b.dataset.vyxGuide)vyxGuideModal(b.dataset.vyxGuide);
 if(b.dataset.vyxOpen){closeModal();await openRoom(b.dataset.vyxOpen);}
});
vyxMeasureVisit();

if(loaded)render();
