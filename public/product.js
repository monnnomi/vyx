'use strict';
let activeDropReveal=null;
let dropData=null,dropOwner=null,dropError='',inboxData=null,inboxFilter='all',exploreQuery='',productLoading=false,revealToken=0;
let appearance='light',motion='auto';
try{appearance=localStorage.getItem('vyx-appearance')||'light';motion=localStorage.getItem('vyx-motion')||'auto';}catch{}
function applyAppearance(){document.body.dataset.appearance=appearance;document.body.dataset.motion=motion;document.querySelector('meta[name="theme-color"]')?.setAttribute('content',appearance==='light'?'#fcfbf8':'#171e2a');}
applyAppearance();
function reduceMotion(){return motion==='reduced'||matchMedia('(prefers-reduced-motion: reduce)').matches;}
function roundLabel(id){const start=Date.parse('2026-11-01T00:00:00Z');return 'ROUND '+String(Math.floor((Date.parse(id)-start)/14400000)+1).padStart(3,'0');}
function dropStrip(){const f=data.farming,cur=f?.current,ready=dropData?.summary.unopened||0;return `<div class="drop-strip"><span class="signal-dot"></span><div><b>${ready?'Your drop is ready':'The next drop'}</b><small>${ready?'Recorded. Ready when you are.':'Your presence matters. Your contribution counts.'}</small></div><strong ${cur?`data-farm-end="${e(cur.endsAt)}"`:''}>${cur?farmCountdown(cur.endsAt):!f?'Connecting…':f.status==='upcoming'?'Coming soon':'Season closed'}</strong><button class="text-link" data-action="drops">${ready?'View drop':'View rounds'} ${icon('arrow')}</button></div>`;}
function renderHome(){return socialFeed();}
function renderDrops(){
 if(!data.user)return clubGuestDrops();
 if(!dropData)return `<div class="product-heading"><span class="eyebrow">YOUR CONTRIBUTION, RECORDED</span><h1>Drops</h1></div><div class="info-panel" role="status">${dropError?e(dropError):'Loading your rounds…'}${dropError?'<button class="secondary" data-product-action="reload">Try again</button>':''}</div>`;
 const d=dropData,cur=d.current,ready=d.nextUnopened?{id:d.nextUnopened}:d.results.find(r=>!r.revealedAt);
 return `<header class="product-heading"><div><span class="eyebrow">YOUR CONTRIBUTION, RECORDED</span><h1>Every conversation<br><span>counts.</span></h1><p>One round. All your rooms. Your share.</p></div><button class="secondary" data-farm-action="rules">How it works ${icon('arrowup')}</button></header><section class="drop-metrics"><div><span>Confirmed room VP</span><strong>${fmt(d.summary.total)} <small>VP</small></strong><small>Confirmed across both seasons</small></div><div><span>Earned today</span><strong>${fmt(d.summary.today)} <small>VP</small></strong><small>Rounds ending today · UTC</small></div><div><span>Your activity this round</span><strong>${fmt(cur?.ruleVersion===2?d.activity.weight:d.activity.eligible)} <small>${cur?.ruleVersion===2?'weight':'eligible'}</small></strong><small>${cur?.ruleVersion===2?`${d.activity.used} / 10 slots used · `:''}Across ${fmt(d.activity.rooms)} ${d.activity.rooms===1?'room':'rooms'}</small></div></section><section class="current-round"><div><span class="eyebrow">${cur?roundLabel(cur.startsAt):'CURRENT ROUND'}</span><h2>${d.activity.eligible?'You’re in this round.':'Make your contribution.'}</h2><p>${d.activity.eligible?'Your eligible messages are recorded. Final points are calculated after the round closes.':'Thoughtful messages count. Simply being online doesn’t earn VP.'}</p></div><div class="round-timing"><span>Round closes in</span><strong ${cur?`data-farm-end="${e(cur.endsAt)}"`:''}>${cur?farmCountdown(cur.endsAt):'Season ended'}</strong>${cur?`<small title="${e(utcTime(cur.endsAt))}">${e(date(cur.endsAt))} · your time<br>${e(utcTime(cur.endsAt))}</small>`:''}<small>Estimated VP: ${fmt(d.estimate)} VP · may change</small>${cur?.ruleVersion===2?`<small>${fmt(d.activity.releasedBudget)} VP available · ${fmt(d.activity.participants)} active accounts across VYX</small>`:''}</div></section>${farmPolicyNotice(d)}<div class="drop-dashboard compact-drop"><section class="drop-feature"><div class="drop-feature-copy"><span class="pill-label ${ready?'gold':''}">${ready?'DROP READY':cur?'ROUND ACTIVE':'SEASON COMPLETE'}</span><h2>${ready?'A moment<br>you made happen.':'The next drop<br>starts with you.'}</h2><p>${ready?'Your points are already recorded. Open to reveal your result.':'Join the conversation. Eligible room messages build your share.'}</p>${ready?`<button class="primary gold-button" data-drop-open="${e(ready.id)}">Open your drop ${icon('arrow')}</button>`:'<button class="primary" data-action="rooms">Go to rooms '+icon('arrow')+'</button>'}<small>${ready?roundLabel(ready.id):cur?roundLabel(cur.startsAt):'Thanks for being part of VYX'}</small></div>${dropSceneHTML('still')}</section></div>${d.summary.pending?'<p class="info-panel" role="status">Round closed. Your result is being calculated. Your activity is retained.</p>':''}<section class="drop-history"><div class="section-title"><div><span class="eyebrow">NOTHING MISSED</span><h2>Your drop history</h2></div><button class="text-link" data-product-action="reload">Refresh ${icon('repeat')}</button></div>${d.results.length?d.results.map(r=>`<article class="drop-history-row"><span class="drop-history-icon">${icon('chest')}</span><div><b>${roundLabel(r.id)}</b><small>${utcTime(r.endsAt)} · ${r.rooms} ${r.rooms===1?'room':'rooms'} · ${r.activity} eligible</small></div><strong>+${fmt(r.amount)} <small>VP</small></strong><button class="${r.revealedAt?'secondary':'primary'}" ${r.revealedAt?`data-drop-detail="${e(r.id)}"`:`data-drop-open="${e(r.id)}"`}>${r.revealedAt?'View result':'Open drop'}</button></article>`).join(''):empty('No finalized room drops yet. Join a room and contribute during an active round.')} ${d.nextBefore?`<button class="secondary load-more" data-drop-more="${e(d.nextBefore)}">Earlier rounds ↓</button>`:''}</section><p class="product-note">VP are in-app points with no monetary value. Opening a drop reveals an existing result; it never triggers another payout.</p><div class="drop-collection-link"><span>Looking for your collectible chests?</span><button class="text-link" data-action="rewards">Open collection ${icon('arrowup')}</button></div>`;
}
function resultHTML(r){return `<div class="drop-result"><span class="pill-label gold">FINALIZED · ${roundLabel(r.id)}</span><div class="result-art" aria-hidden="true"><img src="/assets/wonder/reliquary-open.webp" width="450" height="300" alt=""></div><h2 id="modal-title">Look what you<br>made <em>happen.</em></h2><div class="drop-result-number">+${fmt(r.amount)} <span>VP</span></div><p class="modal-subtitle">Recorded ${utcTime(r.finalizedAt)}<br>Already included in your balance.</p><div class="result-room-list">${r.rooms.map(x=>`<div><span><b>${e(x.name)}</b><small>${x.activity} of ${x.roomActivity} eligible messages</small></span><strong>+${fmt(x.amount)} VP</strong></div>`).join('')}</div>${r.ruleVersion===2?`<p class="product-note">${fmt(r.weight)} contribution weight${r.effectiveWeight!==r.weight?` · ${fmt(r.effectiveWeight)} reward weight`:""} · ${fmt(r.releasedBudget)} VP available across VYX · ${fmt(r.participants)} active accounts</p>`:''}<p class="product-note">${r.activity} eligible messages · ${r.rooms.length} ${r.rooms.length===1?'room':'rooms'} · One personal result</p><button class="primary" data-action="close">Back to your circle ${icon('arrow')}</button></div>`;}
async function openDrop(id,details=false){
 if(!requireUser())return;
 const owner=data.user.id,token=++revealToken;activeDropReveal=null;preloadWonder();
 showModal('<h2 id="modal-title">Retrieving your drop…</h2><p class="modal-subtitle">Checking the confirmed round result.</p>');
 try{
  const r=await api('drop-result',undefined,{id});
  if(token!==revealToken||data.user?.id!==owner||$('#modal-backdrop').hidden)return;
  if(details||r.revealedAt){showWonder(resultHTML(r));return;}
  const reduced=reduceMotion();
  showWonder(`<div class="drop-arrival"><div class="wonder-modal-top"><span class="pill-label gold">${roundLabel(r.id)} · FINALIZED</span>${wonderSoundButton()}</div><h2 id="modal-title">Some moments<br>are made <em>together.</em></h2><p class="wonder-arrival-note">Your circle made this one happen.</p>${dropSceneHTML(reduced?'ready':'arriving')}<div class="wonder-arrival-bottom"><p class="modal-subtitle">Your points are recorded.<br>A little wonder is waiting inside.</p><button class="primary gold-button" data-drop-reveal="${e(id)}" ${reduced?'':'disabled'}>${reduced?'Open your drop':'Your drop is arriving…'} ${icon('arrow')}</button><button class="text-link drop-skip" data-drop-skip="${e(id)}">Skip the moment · show result</button></div></div>`);
  if(!reduced)setTimeout(()=>{if(token!==revealToken||$('#modal-backdrop').hidden||data.user?.id!==owner||activeDropReveal?.id===id)return;const scene=$('.drop-arrival .sky-scene'),button=$('[data-drop-reveal]');if(scene)scene.dataset.skyState='ready';if(button){button.disabled=false;button.innerHTML='Open your drop '+icon('arrow');}},DROP_SCENE_TIMING.arrival);

 }catch(err){if(token===revealToken&&!$('#modal-backdrop').hidden)showModal(`<h2 id="modal-title">Drop unavailable</h2><p class="modal-subtitle">${e(err.message)}</p><button class="secondary" data-action="close">Close</button>`);}
}
async function revealResult(id,skip=false){
 if(activeDropReveal?.id===id&&activeDropReveal.owner===data.user?.id){
  if(skip){stopWonderAudio();activeDropReveal.skip=true;if(activeDropReveal.result){const r=activeDropReveal.result;revealToken++;activeDropReveal=null;showWonder(resultHTML(r));}}
  return;
 }
 const token=++revealToken,owner=data.user?.id;if(!skip)prepareWonderAudio();else stopWonderAudio();
 const pending={id,token,owner,skip,result:null};activeDropReveal=pending;
 const open=$('[data-drop-reveal]');if(open){open.disabled=true;open.textContent='Checking your result…';}
 try{
  // Acknowledgement never changes the ledger. Skip can be requested while it is pending.
  const r=await api('drop-reveal',{id});
  if(token!==revealToken||$('#modal-backdrop').hidden||data.user?.id!==owner||activeDropReveal!==pending)return;
  pending.result=r;acknowledgeRoomWonder(r);
  const scene=$('.drop-arrival .sky-scene');
  const finish=()=>{if(token!==revealToken||$('#modal-backdrop').hidden||data.user?.id!==owner)return;activeDropReveal=null;showWonder(resultHTML(r),!pending.skip);};
  if(pending.skip||reduceMotion()){finish();if(!pending.skip)playWonderChime();}
  else {if(scene)scene.dataset.skyState='opening';if(open?.isConnected)open.textContent='A little wonder…';playWonderOpening();setTimeout(finish,DROP_SCENE_TIMING.opening);}
  if(dropData){const row=dropData.results.find(x=>x.id===id);if(row)row.revealedAt=r.revealedAt;dropData.summary.unopened=Math.max(0,dropData.summary.unopened-1);dropData.nextUnopened=dropData.results.find(x=>!x.revealedAt)?.id||null;renderProductBadge();if(page==='drops')render();loadProduct();}
 }catch(err){if(activeDropReveal===pending)activeDropReveal=null;if(open?.isConnected){open.disabled=false;open.innerHTML='Open your drop '+icon('arrow');}toast(err.message);}
}

function renderExplore(){return exploreHTML();}

function renderNotifications(){if(!data.user)return guestPage('Notifications');const items=(inboxData?.items||[]).filter(n=>inboxFilter==='all'||n.category===inboxFilter);return `<header class="product-heading"><div><span class="eyebrow">STAY IN THE LOOP</span><h1>Notifications</h1><p>People, conversations and confirmed drops.</p></div><button class="secondary" data-product-action="read">Mark all read ${icon('check')}</button></header><div class="subtabs inbox-tabs">${[['all','All'],['social','Social'],['system','System']].map(([id,name])=>`<button data-inbox-filter="${id}" class="${inboxFilter===id?'active':''}">${name}</button>`).join('')}</div><div class="inbox-list">${items.map(n=>`<button class="inbox-item ${n.unread?'unread':''}" ${n.kind==='drop'?`data-drop-open="${e(new Date(n.target).toISOString())}"`:n.kind==='room-mention'?`data-room-open="${e(n.target)}"`:n.kind==='follow'?`data-person="${e(n.target)}"`:`data-notice-post="${e(n.target)}"`}><span class="inbox-icon">${icon(n.kind==='drop'?'chest':n.kind==='follow'?'people':'comment')}</span><span><b>${e(n.title)}</b><p>${e(n.body)}</p><small>${date(n.created_at)}</small></span>${n.unread?'<i class="signal-dot"></i>':''}</button>`).join('')||empty(inboxData?'You’re all caught up.':dropError||'Loading notifications…')}</div><p class="product-note">The latest 50 mentions, follow, comment and room-drop events. Room drops stay available in your full drop history.</p>`;}
function renderSettings(){return `<header class="product-heading"><div><span class="eyebrow">MAKE YOURSELF AT HOME</span><h1>Your settings</h1><p>A space that feels right for you.</p></div></header><section class="settings-panel"><div><h2>Appearance</h2><p>Switch between graphite and a quiet, light canvas.</p></div><div class="appearance-choices">${[['dark','Graphite'],['light','Light']].map(([id,label])=>`<button class="appearance-choice ${appearance===id?'selected':''}" data-appearance="${id}" aria-pressed="${appearance===id}"><span class="theme-swatch ${id}"><i></i><i></i><i></i></span>${label}${appearance===id?icon('check'):''}</button>`).join('')}</div><label class="setting-toggle"><span><b>Reduce animation</b><small>Show drop results with minimal movement. Your device preference is always respected.</small></span><input id="reduce-motion" type="checkbox" ${motion==='reduced'?'checked':''}></label><div class="setting-item"><span><b>Drop sound</b><small>A short sound when you open a chest. No background audio.</small></span>${wonderSoundButton()}</div><div class="setting-item"><span><b>Seasonal detail</b><small>Change the seasonal accent independently of your farming season.</small></span><button class="secondary" data-action="seasons">${e(season().displayName)} ↗</button></div><div class="setting-item"><span><b>Your profile</b><small>${data.user?'Your VYX username: @'+e(data.user.handle):'Connect with X to participate in VYX.'}</small></span><button class="secondary" data-action="${data.user?'editprofile':'signin'}">${data.user?'Edit profile':'Connect with X'}</button></div>${window.VYXAnalytics?`<div class="setting-item"><span><b>Analytics</b><small id="analytics-preference">${window.VYXAnalytics.preference()}</small></span><button class="secondary" data-analytics-settings>Change choice</button></div>`:''}${preferenceSettingsHTML()}<div class="setting-item"><span><b>Your data</b><small>See what VYX stores and how to request removal.</small></span><div><a class="text-link" href="/privacy.html">Privacy & data ↗</a>${data.user?'<button class="secondary" data-request-deletion>Request account deletion</button>':''}</div></div>${data.user?.is_admin?'<div class="setting-item"><span><b>Administration</b><small>Accounts, mints, activity and drop receipts.</small></span><a class="secondary" href="/admin">Open admin ↗</a></div>':''}${data.user?'<button class="text-link settings-signout" data-action="logout">Sign out</button>':''}</section><p class="product-note">Appearance and motion preferences are saved in this browser.</p>`;}
async function loadProduct(append=null){
 if(!data.user){dropData=null;inboxData=null;dropOwner=null;resetRoomWonder();renderProductBadge();return;}
 if(productLoading)return;
 const owner=data.user.id;productLoading=true;
 if(dropOwner!==owner){dropData=null;inboxData=null;}dropOwner=owner;
 try{
  const [d,n]=await Promise.all([api('drops',undefined,append?{before:append}:{}),api('notifications')]);
  if(data.user?.id!==owner)return;
  dropData=append&&dropData?{...d,results:[...dropData.results,...d.results]}:d;inboxData=n;dropError='';
  syncFarmClock(d);if(d.summary.unopened)preloadWonder();hydrateRoomWonder(d,owner);if(d.balance){data.user.points=d.balance.points;data.user.all_points=d.balance.all_points;$('#header-points').textContent=fmt(d.balance.points);}
  renderProductBadge();const strip=$('.drop-strip');if(strip)strip.outerHTML=dropStrip();if(['drops','notifications'].includes(page))render();
 }catch(err){dropError=err.message;if(['drops','notifications'].includes(page)){toast(err.message);render();}}finally{productLoading=false;}
}
function renderProductBadge(){const ready=data.user?dropData?.summary.unopened||0:0,unread=data.user?inboxData?.items.filter(n=>n.unread).length||0:0;
 $$('[data-product-badge]').forEach(n=>n.remove());
 if(ready)$$('a[href="#drops"]').forEach(a=>a.insertAdjacentHTML('beforeend',`<span class="nav-badge" data-product-badge>${ready}</span>`));
 const bell=$('.notification-button');if(bell){bell.classList.toggle('has-unread',unread>0);bell.setAttribute('aria-label',unread?`Notifications, ${unread} unread`:'Notifications');}
}
document.addEventListener('click',async ev=>{
 const b=ev.target.closest('button,a');if(!b)return;const d=b.dataset;
 try{
  if(d.dropOpen)await openDrop(d.dropOpen);
  if(d.dropDetail)await openDrop(d.dropDetail,true);
  if(d.dropReveal)await revealResult(d.dropReveal);
  if(d.dropSkip)await revealResult(d.dropSkip,true);
  if(d.dropMore)await loadProduct(d.dropMore);
  if(d.productAction==='menu')showModal(`<h2 id="modal-title">Your VYX</h2><div class="more-menu">${nav.map(([id,i,label])=>`<button data-action="${id}">${icon(i)} ${label} ${icon('arrowup')}</button>`).join('')}${data.user?.is_admin?'<a href="/admin">Admin dashboard ↗</a>':''}</div>`);
  if(d.productAction==='reload'){await loadProduct();render();}
  if(d.productAction==='read'&&requireUser()){await api('notifications-read',{});await loadProduct();}
  if(d.inboxFilter){inboxFilter=d.inboxFilter;render();}
  if(d.noticePost){go('feed');toast('Opening the post’s comments.');await commentsModal(d.noticePost);}
  if(d.appearance){appearance=d.appearance;try{localStorage.setItem('vyx-appearance',appearance);}catch{}applyAppearance();render();}
 }catch(err){toast(err.message);}
});
document.addEventListener('change',ev=>{if(ev.target.id==='reduce-motion'){motion=ev.target.checked?'reduced':'auto';try{localStorage.setItem('vyx-motion',motion);}catch{}applyAppearance();}});
document.addEventListener('submit',ev=>{if(ev.target.id==='explore-form'){ev.preventDefault();exploreQuery=new FormData(ev.target).get('query')||'';searchExplore();}});
setInterval(()=>{if(!document.hidden&&typeof data!=='undefined'&&data.user&&!busy&&$('#modal-backdrop').hidden)loadProduct();},60000);
