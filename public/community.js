'use strict';
let data={user:null,members:[],posts:[],quests:[],calendar:{label:'Connecting…'},authReady:false};
let page=location.hash.slice(1)||'rooms',feedTab='all',taskTab='all',feedPosts=[],profilePosts=[],chats=[],chatMessages=[],activeChat=null,busy=false,loaded=false,signInQueued=false;
let theme='auto',modalFocus=null,homeRooms=[],collectionFilter='all';
try{theme=localStorage.getItem('vyx-theme')||'auto';}catch{}
if(!nav.some(n=>n[0]===page))page='rooms';
const e=escapeHTML;
const currentSeason=()=>theme==='auto'?autoSeason():theme;
const season=()=>seasons[currentSeason()]||seasons.halloween;
const points=()=>data.user?.points||0;
const inventory=()=>data.user?.inventory||[0,0,0,0];
const date=s=>new Date(s).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const avatar=(u,extra='')=>`<span class="avatar ${u?.is_system?'sage':'me-avatar'} ${extra}" aria-hidden="true">${u?.avatar_url?`<img src="${e(u.avatar_url)}" alt="" referrerpolicy="no-referrer" loading="lazy">`:e((u?.name||'✦').slice(0,1))}</span>`;
const findPerson=id=>data.members.find(u=>u.id===id)||profileCache.get(id)||data.posts.find(p=>p.author.id===id)?.author||(data.user?.id===id?data.user:null);
async function api(action,body,params={}){
 const url=new URL('/api/vyx',location.origin);url.searchParams.set('action',action);for(const [k,v] of Object.entries(params))if(v!=null)url.searchParams.set(k,v);
 const res=await fetch(url,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const result=await res.json().catch(()=>({error:'The service could not be reached.'}));
 if(!res.ok){if(res.status===401)data.user=null;throw new Error(result.error||'Please try again.');}return result;
}
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),4500);}
function showModal(html,{keepDropAudio=false}={}){if(!keepDropAudio&&typeof stopWonderAudio==='function')stopWonderAudio();if(typeof pauseMedia==='function')pauseMedia($('#modal'));$('#modal').classList.remove('is-wonder');if($('#modal-backdrop').hidden)modalFocus=document.activeElement;$('.app-shell').inert=true;$('#sidebar').inert=true;$('#modal').innerHTML=`<button class="modal-close" data-action="close" aria-label="Close">×</button>${html}`;$('#modal-backdrop').hidden=false;document.body.style.overflow='hidden';$('.modal-close').focus();if(typeof restoreMediaComposers==='function')restoreMediaComposers();}
function closeModal(){if(typeof socialModalEpoch!=='undefined')socialModalEpoch++;if(typeof stopWonderAudio==='function')stopWonderAudio();if(typeof activeChestReveal!=='undefined')activeChestReveal=null;if(typeof pauseMedia==='function')pauseMedia($('#modal'));revealToken++;activeDropReveal=null;$('#modal-backdrop').hidden=true;$('.app-shell').inert=false;$('#sidebar').inert=false;document.body.style.overflow='';if(modalFocus?.isConnected)modalFocus.focus();}
function signin(){if(!loaded){signInQueued=true;toast('Connecting to your circle…');return;}signInQueued=false;rememberSocialContext();showModal(`<div class="person-modal"><span class="big-spark">✦</span><h2 id="modal-title">Welcome to the club.</h2><p class="modal-subtitle">Connect with X to join rooms, meet people and keep your collection in one place.</p>${data.authReady?'<a class="primary auth-link" href="/api/auth/x'+referralAuthQuery()+'">Continue with X ↗</a>':'<div class="info-panel">X sign-in is being connected. You can explore VYX while setup is completed.</div>'}<p class="modal-subtitle auth-note">VYX reads your X identity to sign you in. VYX does not post to X or read your X direct messages.<br><a href="/privacy.html">Privacy & data</a></p></div>`);}
function requireUser(){if(!data.user){signin();return false;}return true;}
async function refresh(){
 const [stateResult,roomsResult]=await Promise.all([api('state'),api('rooms').catch(()=>({rooms:[]}))]);if(data.user?.id!==stateResult.user?.id){memberPreferences=null;preferencesError='';exploreState=null;exploreStatus='idle';exploreEpoch++;socialModalEpoch++;profileCache.clear();}data=stateResult;if(typeof syncMediaOwner==='function')syncMediaOwner(data.user?.id||null);if(dropOwner!==data.user?.id){dropData=null;inboxData=null;dropOwner=null;resetRoomWonder();}homeRooms=roomsResult.rooms;syncHalloweenClock(data.event);syncFarmClock(data.farming);loaded=true;feedStatus='ready';feedPosts=feedTab==='all'?data.posts:(await api('feed',undefined,{filter:feedTab})).posts;
 if(page==='profile'&&data.user){profileStatus='loading';try{profilePosts=(await api('feed',undefined,{author:data.user.id})).posts;profileStatus='ready';}catch(err){profileStatus='error';throw err;}}
 render();loadProduct();if(signInQueued)signin();
}
async function write(action,body){
 if(!requireUser()||busy)return null;busy=true;document.body.classList.add('saving');
 try{const result=await api(action,body);trackProduct(({follow:'follow',post:'post_published',comment:'comment_sent'})[action]);try{await refresh();}catch{toast('Saved. Refresh the page to update the view.');}return result;}
 catch(err){toast(err.message);return null;}
 finally{busy=false;document.body.classList.remove('saving');}
}
function renderNav(){socialNav();}

function applyTheme(){applyAppearance();document.body.dataset.season=currentSeason();$('#sidebar-season').textContent=season().label;$('.season-icon').textContent=season().symbol;}
function chestCards(filter=collectionFilter){
 const visible=tiers.map((t,i)=>({t,i})).filter(({i})=>filter!=='owned'||inventory()[i]);
 return visible.length?`<div class="chest-grid">${visible.map(({t,i})=>`<article class="chest-card rarity-${i}"><div class="chest-card-top"><span class="edition-number">EDITION 0${i+1}</span>${inventory()[i]?`<span class="owned">${inventory()[i]} owned</span>`:'<span class="chest-edition-status">Upcoming</span>'}</div><button class="chest-art-button" data-chest-details="${i}" aria-label="View ${t.name} chest">${chestSVG(i,'card')}</button><div class="chest-card-copy"><div class="rarity-line"><span class="rarity">${t.rarity}</span>${rarityScale(i)}</div><h3>${t.name}</h3><p class="range">${fmt(t.min)}–${fmt(t.max)} <span>VP</span></p><button class="chest-open ${inventory()[i]?'ready':''}" ${inventory()[i]?`data-open="${i}"`:`data-chest-details="${i}"`}>${inventory()[i]?'Open chest':'View edition'} ${icon('arrowup')}</button></div></article>`).join('')}</div>`:empty('Your collection is waiting. Chests you own will appear here.');
}
function chestDetails(tier){const t=tiers[tier];showModal(`<div class="edition-detail rarity-${tier}"><div class="eyebrow">VYX COLLECTION / EDITION 0${tier+1}</div>${chestSVG(tier,'detail')}<div class="rarity-line"><span class="rarity">${t.rarity}</span>${rarityScale(tier)}</div><h2 id="modal-title">${t.name}</h2><p class="edition-reward">${fmt(t.min)}–${fmt(t.max)} <span>VP</span></p><p class="modal-subtitle">${['A small discovery. A good place to start.','A rarer find, with a little more inside.','A distinctive edition for your collection.','The highest rarity in the VYX chest collection.'][tier]} Every whole number in the displayed range has an equal chance.</p>${inventory()[tier]?`<button class="primary" data-open="${tier}">Open your chest ${icon('arrowup')}</button>`:'<button class="secondary" disabled>Chest distribution coming soon</button>'}<small class="edition-note">Four editions. A different discovery in each. Chests cannot be purchased.</small></div>`);}

function heroHTML(){const s=season();return `<section class="hero" aria-label="Current season"><img class="hero-art" src="assets/halloween-hero.webp" alt="A glowing jack-o-lantern in the night mist"><span class="hero-decor" aria-hidden="true">${s.decor}</span><div class="hero-content"><span class="season-tag"><i></i>${e(data.calendar.label.toUpperCase())} · ${s.label.toUpperCase()}</span><h2>${s.headline}</h2><p>${s.text}</p><button class="primary" data-action="${data.user?'tasks':'signin'}">${data.user?'Explore your quests':'Join your circle'} ${icon('arrow')}</button></div><span class="hero-end"><i></i>Every season, a new story</span></section>`;}
function postHTML(p){return `<article class="post" id="post-${p.id}"><div class="post-top"><button class="icon-button" data-person="${p.author.id}" aria-label="Profile ${e(p.author.name)}">${avatar(p.author)}</button><div><button class="post-name text-link" data-person="${p.author.id}" style="color:var(--text)">${e(p.author.name)}${p.author.is_system?'<span class="verified" title="Official VYX account">✦</span>':''}</button><span class="post-handle">${compactHandle(p.author.handle)} · ${date(p.created_at)}</span></div></div>${p.media?.length?mediaHTML(p.media):''}<p class="post-text">${socialText(p.body)}</p><div class="post-actions"><button class="${p.liked?'liked':''}" data-like="${p.id}" aria-label="Like" aria-pressed="${p.liked}">${icon('heart')}${fmt(p.likes)}</button><button data-comment="${p.id}" aria-label="Comments">${icon('comment')}${fmt(p.comments)}</button><button data-share="${p.id}" aria-label="Copy post link">${icon('link')}</button><button class="${p.saved?'saved':''}" data-save="${p.id}" aria-label="Save" aria-pressed="${p.saved}">${icon('bookmark')}</button>${data.user&&p.author.id!==data.user.id?`<button data-report-kind="post" data-report-id="${p.id}" aria-label="Report post">${icon('more')}</button>`:''}</div></article>`;}
function composerHTML(){if(!data.user)return `<div class="composer guest-composer"><div><strong>A new circle is taking shape.</strong><p>Be one of the first voices here.</p></div><button class="primary" data-action="signin">Continue with X ↗</button></div>`;return `<form class="composer" id="post-form" data-media-form="post"><div class="composer-top">${avatar(data.user)}<textarea id="post-input" placeholder="Share something with your circle…" aria-label="New post" minlength="20" maxlength="1500" required>${e(socialPostDraft)}</textarea></div>${typeof mediaDraftHTML==='function'?mediaDraftHTML('post'):''}<div class="composer-bottom">${typeof mediaComposerHTML==='function'?mediaComposerHTML('post','post'):''}<span class="post-count" id="post-counter">${socialPostDraft.length} / 1,500</span><button class="primary" type="submit">Post ${icon('arrowup')}</button></div></form>`;}
function empty(message){return `<div class="empty-state">${icon('people')}<p>${e(message)}</p></div>`;}
function renderFeed(){return `<div class="edition-header"><span>THE VYX JOURNAL</span><span>${e(data.calendar.label)} <i class="live-dot"></i></span></div><section class="editorial-hero"><div class="hero-text"><div class="eyebrow">A LITTLE MORE CONNECTED</div><h1>Good company.<br><em>Great finds.</em></h1><p>Meet in rooms. Share what you're working on.<br>Collect this season's rewards.</p><div class="hero-actions"><button class="primary" data-action="rooms">Find your room ${icon('arrowup')}</button><button class="text-link" data-action="rewards">Explore the collection</button></div><div class="hero-footnote"><span class="hero-footnote-symbol">↗</span><span>Conversations worth joining.<br>A collection worth keeping.</span></div></div><button class="hero-object" data-chest-details="3" aria-label="Explore Radiance legendary chest"><span class="object-caption">THE COLLECTION / 04 EDITIONS</span>${chestSVG(3,'hero')}<span class="object-bottom"><span><b>Radiance</b><small>Legendary edition</small></span>${rarityScale(3)}</span></button></section><section class="home-room-section"><div class="section-title"><div><span class="eyebrow">COME ON IN</span><h2>A room for your people.</h2></div><button class="text-link" data-action="rooms">All rooms ${icon('arrowup')}</button></div>${homeRooms.length?`<div class="home-room-grid">${homeRooms.slice(0,2).map(r=>roomCard(r,true)).join('')}</div>`:`<div class="home-room-empty"><span class="journal-flower" aria-hidden="true">✳</span><div><h3>Start a conversation.</h3><p>Open a room around something you care about.</p></div><button class="secondary" data-action="rooms">Explore rooms ${icon('arrowup')}</button></div>`}</section>${farmingHomeHTML()}<section class="home-collection"><div class="section-title"><div><span class="eyebrow">COLLECT THE UNEXPECTED</span><h2>Four editions. Your next find.</h2></div><button class="text-link" data-action="rewards">Full collection ${icon('arrowup')}</button></div>${chestCards('all')}</section><section aria-label="Community feed" class="journal-feed"><div class="section-title"><div><span class="eyebrow">FROM THE CLUB</span><h2>The conversation.</h2></div></div><div class="feed-tabs" role="tablist" aria-label="Feed filter">${[['all','Latest'],['following','Following'],['saved','Saved']].map(([id,label])=>`<button class="feed-tab ${id===feedTab?'active':''}" role="tab" aria-selected="${id===feedTab}" data-feedtab="${id}">${label}</button>`).join('')}<button class="text-link refresh-feed" data-action="refresh">Refresh ↻</button></div>${composerHTML()}<div id="posts-list">${feedPosts.length?feedPosts.map(postHTML).join(''):empty('Stories from your circle will appear here.')}</div>${feedPosts.length>=30?'<button class="secondary load-more" data-action="moreposts">Load more stories ↓</button>':''}</section>`;}

function renderTasks(){return `<div class="page-intro"><div class="eyebrow">YOUR NEXT CHAPTER</div><h1>Quests</h1></div><section class="quests-soon" aria-label="Quests coming soon"><span class="quests-soon-symbol" aria-hidden="true">${icon('clock')}</span><h2>Coming soon</h2></section>`;}
function renderRewards(){return `<header class="collection-heading"><div class="eyebrow">OBJECTS OF A GOOD SEASON</div><h1>The <em>collection.</em></h1><p>Four chest editions, each with its own character.<br>Find your rarity. Keep your discoveries.</p><div class="collection-heading-meta"><span>04 CHEST EDITIONS</span><span>${chestCount()} IN YOUR INVENTORY</span></div></header><div class="collection-toolbar"><div class="subtabs"><button data-collection-filter="all" class="${collectionFilter==='all'?'active':''}">All editions</button><button data-collection-filter="owned" class="${collectionFilter==='owned'?'active':''}">My chests <span>${chestCount()}</span></button></div><button class="text-link" data-action="rules">Rarity & reward guide ${icon('arrowup')}</button></div>${chestCards()}<p class="collection-note">Chest distribution is coming soon. Previously earned chests remain available to open.</p>${data.event?.minted?`<div class="section-title"><div><span class="eyebrow">A MOMENT TO KEEP</span><h2>Seasonal keepsakes.</h2></div></div>${halloweenHTML(true)}`:''}<section class="history"><div class="section-title"><h2>Your reward journal.</h2><span class="history-balance">${fmt(points())} VP this season</span></div>${data.user?.history.length?data.user.history.map(h=>`<div class="history-row"><div><strong>${rewardName(h)}</strong><small>${date(h.created_at)} · ${e(h.season)}</small></div><b>+${fmt(h.amount)} VP</b></div>`).join(''):empty('Your room drops and chest rewards will be recorded here.')}</section>`;}

function renderLeaderboard(){return socialLeaderboard()+referralLeaderboardHTML();}

function guestPage(title){return `<div class="page-intro"><div class="eyebrow">MAKE YOURSELF AT HOME</div><h1>${title}</h1></div><div class="info-panel"><h3>Your people are waiting.</h3><p>Sign in with X to join VYX and make this space yours.</p><button class="primary" data-action="signin">Continue with X ↗</button></div>`;}
function renderProfile(){return socialProfile()+referralInviteHTML();}

function bubbles(){return chatMessages.map(m=>`<div class="bubble ${m.sender_id===data.user?.id?'mine':''}" data-dm-message="${m.id}">${m.media?.length?mediaHTML(m.media):''}<p>${e(m.body)}</p><small>${date(m.created_at)}</small>${messageReactionsHTML(m,'dm')}${m.sender_id!==data.user?.id?`<button class="text-link" data-report-kind="message" data-report-id="${m.id}">Report</button>`:''}</div>`).join('')||'<div class="chat-date">The start of your story</div>';}
function renderMessages(){return socialDirect();}

function renderRail(){$('#right-rail').innerHTML=socialRail();}

function render(){
 if(typeof pauseMedia==='function')pauseMedia($('#main-content'));
 const draft=$('#post-input')?.value,searchDraft=$('#room-search')?.value,searchFocused=document.activeElement?.id==='room-search';document.body.dataset.page=page;document.body.classList.toggle('in-room',page==='rooms'&&Boolean(activeRoom));document.body.classList.toggle('in-direct',page==='messages'&&Boolean(activeChat));applyTheme();renderNav();$('#header-points').textContent=fmt(points());
 $('.header-actions .me-avatar').textContent=data.user?data.user.name.slice(0,1):'X';
 $('#top-title').innerHTML=`${nav.find(n=>n[0]===page)?.[2]||'Feed'} `;
 $('#main-content').innerHTML=({feed:renderHome,explore:renderExplore,drops:renderDrops,notifications:renderNotifications,settings:renderSettings,tasks:renderTasks,rewards:renderRewards,leaderboard:renderLeaderboard,profile:renderProfile,messages:renderMessages,rooms:renderRooms}[page]||renderFeed)();
 renderProductBadge();if(draft&&$('#post-input'))$('#post-input').value=draft;if(searchDraft!==undefined&&$('#room-search')){$('#room-search').value=searchDraft;if(searchFocused)$('#room-search').focus();}renderRail();if(typeof restoreMediaComposers==='function')restoreMediaComposers();
 const box=$('.chat-bubbles');if(box)box.scrollTop=box.scrollHeight;
}
async function loadPage(){
 try{
  if(['drops','notifications'].includes(page))await loadProduct();
  if(page==='profile'&&data.user){profileStatus='loading';try{profilePosts=(await api('feed',undefined,{author:data.user.id})).posts;profileStatus='ready';}catch(err){profileStatus='error';throw err;}}
  if(page==='messages'&&data.user){chats=(await api('conversations')).conversations;if(!activeChat&&chats.length)activeChat=chats[0].id;if(activeChat)chatMessages=(await api('messages',undefined,{id:activeChat})).messages;}
  if(['profile','leaderboard'].includes(page))await loadReferrals();
  if(page==='settings'&&data.user){await loadMemberPreferences();}
  if(page==='explore')await searchExplore();
  if(page==='rooms'){await loadRooms();return;}
  render();
 }catch(err){if(page==='profile')profileStatus='error';render();toast(err.message);}
}
function go(id){if(!nav.some(n=>n[0]===id))return;closeModal();if(page===id){loadPage();return;}location.hash=id;}
window.addEventListener('hashchange',()=>{page=location.hash.slice(1);if(page==='profile')profileStatus='loading';if(!nav.some(n=>n[0]===page))page='rooms';render();loadPage();window.scrollTo({top:0,behavior:'instant'});});
async function personModal(id){
 if(id===data.user?.id){go('profile');return;}
 const owner=data.user?.id,token=++socialModalEpoch;showModal('<h2 id="modal-title">Profile</h2>'+loadingPanel('Loading this profile…'));
 try{const result=await api('member-profile',undefined,{id});if(token!==socialModalEpoch||owner!==data.user?.id||$('#modal-backdrop').hidden)return;profileCache.set(id,result.person);trackProduct('profile_view');showModal(memberProfileHTML(result));}
 catch(err){if(token===socialModalEpoch&&!$('#modal-backdrop').hidden)showModal('<h2 id="modal-title">Profile unavailable</h2>'+errorPanel(err.message,`data-person="${id}"`));}
}

function editProfile(onboarding=false){if(!requireUser())return;const u=data.user;showModal(`<h2 id="modal-title">${onboarding?'A name your people will remember.':'Make it yours.'}</h2><p class="modal-subtitle">Your name, bio and interests are public. Choose a short username so people can find you.</p><form id="profile-form"><label class="modal-field">Name<input name="name" value="${e(u.name)}" minlength="2" maxlength="32" required></label><label class="modal-field">Username<input name="handle" id="profile-handle" value="${e(u.handle)}" minlength="3" maxlength="24" pattern="[a-zA-Z0-9_.]{3,24}" required aria-describedby="handle-status"></label><p id="handle-status" class="field-help" role="status">3–24 letters, numbers, dots or underscores.</p><label class="modal-field">Bio <span>(optional)</span><textarea name="bio" maxlength="180" placeholder="What do you like talking about?">${e(u.bio||'')}</textarea></label><label class="modal-field">Interests <span>(optional)</span><input name="interests" maxlength="120" value="${e(u.interests||'')}" placeholder="Design, music, building communities…"></label><button class="primary">Save profile ${icon('check')}</button>${onboarding?'<button type="button" class="text-link" data-onboarding-skip>Skip for now</button>':''}</form>`);}

function seasonModal(){showModal(`<h2 id="modal-title">Every season has<br>its own mood.</h2><p class="modal-subtitle">Choose a theme or follow the calendar. Visual themes do not change your points or farming season.</p><div class="season-choices">${Object.entries(seasons).map(([id,s])=>`<button class="season-choice ${currentSeason()===id?'selected':''}" data-season="${id}"><span>${s.decor}</span><span><b>${s.displayName}</b><small>${s.label}</small></span></button>`).join('')}</div><label class="toggle-row">Change themes with the calendar<input id="auto-theme" type="checkbox" ${theme==='auto'?'checked':''}></label>`);}
function rulesModal(){showModal(`<h2 id="modal-title">Find your people.<br>Start a conversation.</h2><p class="modal-subtitle">Join community rooms, share what interests you, and get to know the people behind the posts.</p><ol class="rules-list"><li><strong>Find a room.</strong> Look at its topic, language and host. Anyone signed in can join; members can read the full conversation history.</li><li><strong>Say hello and reply.</strong> Ask a question, share a find or join an existing discussion. Short replies are welcome, even when they do not qualify for VP.</li><li><strong>Keep in touch.</strong> Follow authors you enjoy. Once you follow each other you can exchange direct messages.</li></ol><button class="primary" data-action="explore">Explore rooms</button><details class="guide-details"><summary>Seasonal rewards & collections</summary><p>Eligible room contributions can earn VP in four-hour rounds. VP are in-app points with no monetary value and do not promise tokens. Opening a drop reveals a result already recorded.</p><button class="secondary" data-farm-action="rules">Read the reward rules</button><p>The Halloween 2026 keepsake mint has closed. New collectible distributions and quests are coming soon.</p><table class="odds-table"><tr><th>Chest</th><th>VP range</th><th>Chance per value</th></tr>${tiers.map(t=>`<tr><td>${t.name}</td><td>${fmt(t.min)}–${fmt(t.max)}</td><td>1 / ${t.max-t.min+1}</td></tr>`).join('')}</table></details>`);}

async function openChest(tier){
 if(!requireUser()||busy)return;if(!inventory()[tier]){go('tasks');return;}
 const owner=data.user.id,token=++revealToken;prepareWonderAudio();
 let requestId;try{requestId=sessionStorage.getItem('vyx-open-'+tier);}catch{}
 if(!requestId){requestId=crypto.randomUUID();try{sessionStorage.setItem('vyx-open-'+tier,requestId);}catch{}}
 const result=await write('open',{tier,requestId});if(!result||data.user?.id!==owner||token!==revealToken)return;
 try{sessionStorage.removeItem('vyx-open-'+tier);}catch{}
 presentChestOpening(`<div class="reward-modal reward-reveal"><div class="reward-tier">${tiers[result.tier].rarity} · ${tiers[result.tier].name}</div><h2 id="modal-title">Your season just got brighter.</h2>${chestSVG(result.tier,'result')}<div class="reward-number">+${fmt(result.amount)} <span>VP</span></div><p class="reward-caption">Added to ${e(result.season)}</p><button class="primary" data-action="close">Enjoy the moment ${icon('spark')}</button></div>`,result.tier,owner,token);
}
async function commentsModal(id){
 const owner=data.user?.id,token=++socialModalEpoch;showModal('<h2 id="modal-title">Conversation</h2>'+loadingPanel('Loading the post and its replies…'));
 try{const [detail,result]=await Promise.all([api('post-detail',undefined,{id}),api('comments',undefined,{id})]);if(token!==socialModalEpoch||owner!==data.user?.id||$('#modal-backdrop').hidden)return;
 showModal(`<h2 id="modal-title">Conversation</h2><div class="discussion-parent">${postHTML(detail.post)}</div><h3 class="discussion-label">Replies · ${result.comments.length}</h3><div class="comments-list">${result.comments.length?result.comments.map(c=>`<article class="comment-line"><button class="text-link" data-person="${c.user_id}"><b>${e(c.name)}</b></button>${c.media?.length?mediaHTML(c.media):''}<p>${e(c.body)}</p><small>${date(c.created_at)}</small>${data.user&&c.user_id!==data.user.id?`<button class="text-link" data-report-kind="comment" data-report-id="${c.id}">Report</button>`:''}</article>`).join(''):'<p class="modal-subtitle">No replies yet. Add your perspective.</p>'}</div>${data.user?`<form id="comment-form" data-id="${id}" data-media-form="comment:${id}"><label class="modal-field">Your reply<textarea name="body" maxlength="500" required></textarea></label>${mediaDraftHTML('comment:'+id)}${mediaComposerHTML('comment:'+id,'comment',id)}<button class="primary">Send reply ${icon('send')}</button></form>`:'<button class="primary" data-action="signin">Join the conversation</button>'}`);
 }catch(err){if(token===socialModalEpoch&&!$('#modal-backdrop').hidden)showModal('<h2 id="modal-title">Could not load the conversation</h2>'+errorPanel(err.message,`data-comment="${id}"`));}
}

async function copy(value){try{await navigator.clipboard.writeText(value);toast('Copied ✦');}catch{showModal(`<h2 id="modal-title">Copy and share.</h2><label class="modal-field"><textarea readonly>${e(value)}</textarea></label>`);}}
document.addEventListener('click',async ev=>{
 const b=ev.target.closest('button,a');if(!b)return;const d=b.dataset;
 try{
  if(d.action){
   const a=d.action;if(nav.some(n=>n[0]===a)){go(a);return;}
   if(a==='close')closeModal();if(a==='signin')signin();if(a==='seasons')seasonModal();if(a==='rules')rulesModal();if(a==='editprofile')editProfile();
   if(a==='invite')showModal('<h2 id="modal-title">Bring your circle together.</h2><p class="modal-subtitle">Share VYX with your people. Referral rewards are not active.</p><button class="primary" data-action="copyinvite">Copy invite link ↗</button>');
   if(a==='copyinvite')await copy(location.origin+'/');
   if(a==='notifications'){if(!requireUser())return;showModal(`<h2 id="modal-title">Your discoveries.</h2><p class="modal-subtitle">Recent rewards</p>${data.user.history.slice(0,10).map(h=>`<div class="history-row"><span>${rewardName(h)}<br><small>${date(h.created_at)}</small></span><b>+${fmt(h.amount)} VP</b></div>`).join('')||'<p class="modal-subtitle">Your first discoveries are ahead.</p>'}`);}
   if(a==='refresh')await refresh();
   if(a==='claim-halloween')await claimHalloweenChest();
   if(a==='open-halloween')openHalloweenChest();
   if(a==='mint-receipt')mintReceiptModal();
   if(a==='copy-mint'&&data.event?.mintId)await copy('VYX Halloween mint: '+data.event.mintId+' · '+data.event.mintedAt);
   if(a==='moreposts'){const next=(await api('feed',undefined,{filter:feedTab,cursor:feedPosts.at(-1)?.created_at})).posts;feedPosts.push(...next);render();if(!next.length)toast('You are all caught up.');}
   if(a==='logout'){if(await write('logout',{})){closeModal();data.user=null;activeChat=null;dmDrafts.clear();socialPostDraft='';chats=[];chatMessages=[];clearRoomState();await refresh();toast('Signed out.');window.dispatchEvent(new Event('vyx-auth-changed'));}}
   if(a==='hashtag'||a==='mood'){const field=$('#post-input');if(field){field.value+=(field.value?' ':'')+(a==='hashtag'?'#VYX':'✨');field.focus();}}
  }
  if(d.chestDetails!==undefined)chestDetails(Number(d.chestDetails));
  if(d.collectionFilter){collectionFilter=d.collectionFilter;render();}
  if(d.feedtab){if(d.feedtab!=='all'&&!requireUser())return;feedTab=d.feedtab;feedStatus='loading';render();try{const selected=feedTab,result=await api('feed',undefined,{filter:selected});if(selected===feedTab){feedPosts=result.posts;feedStatus='ready';render();}}catch(err){feedStatus='error';render();throw err;}}
  if(d.tasktab){taskTab=d.tasktab;render();}
  if(d.open!==undefined)await openChest(Number(d.open));
  if(d.claim)toast('Quests are coming soon.');
  if(d.like)await write('react',{id:d.like});if(d.save)await write('save',{id:d.save});
  if(d.comment)await commentsModal(d.comment);
  if(d.share)await copy(location.origin+'/?post='+d.share+'#feed');
  if(d.person)await personModal(d.person);
  if(d.follow){if(await write('follow',{id:d.follow}))personModal(d.follow);}
  if(d.dm){if(!requireUser())return;activeChat=d.dm;chatMessages=[];go('messages');}
  if(d.chat){activeChat=d.chat;await loadPage();}
  if(d.season){theme=d.season;try{localStorage.setItem('vyx-theme',theme);}catch{}render();seasonModal();}
  if(d.jump){await commentsModal(d.jump);$('#search-results').hidden=true;}
 }catch(err){toast(err.message);}
});
document.addEventListener('submit',async ev=>{
 const f=ev.target;ev.preventDefault();const values=Object.fromEntries(new FormData(f));
 if(f.id==='post-form'){try{const field=$('#post-input'),content=field.value,ids=mediaSendIds('post');const r=await write('post',{body:content,mediaIds:ids,requestId:mediaRequestId('post',content,ids)});if(r){if(socialPostDraft===content){socialPostDraft='';if($('#post-input'))$('#post-input').value='';}clearMediaDraft('post');toast('Your story is live ✦');}}catch(err){toast(err.message);}}
 if(f.id==='profile-form'&&await write('profile',values)){closeModal();trackProduct('onboarding_saved');toast('Profile saved ✦');}
 if(f.id==='comment-form'){try{const key='comment:'+f.dataset.id,ids=mediaSendIds(key);if(await write('comment',{id:f.dataset.id,body:values.body,mediaIds:ids,requestId:mediaRequestId(key,values.body,ids)})){clearMediaDraft(key);await commentsModal(f.dataset.id);restoreMediaComposers();toast('Comment added.');}}catch(err){toast(err.message);}}
 if(f.id==='chat-form'){
  const peer=activeChat,key='message:'+peer,input=$('#chat-input'),message=input.value;
  try{const ids=mediaSendIds(key);if(await write('message',{id:peer,body:message,mediaIds:ids,requestId:mediaRequestId(key,message,ids)})){dmDrafts.delete(peer);clearMediaDraft(key);await loadPage();$('#chat-input')?.focus();}else if(activeChat===peer&&$('#chat-input'))$('#chat-input').value=message;}catch(err){toast(err.message);}
 }
});
document.addEventListener('change',ev=>{if(ev.target.id==='auto-theme'){theme=ev.target.checked?'auto':currentSeason();try{localStorage.setItem('vyx-theme',theme);}catch{}render();}});
document.addEventListener('keydown',ev=>{if(ev.key==='Escape'){closeModal();$('#search-results').hidden=true;}if(ev.key==='Tab'&&!$('#modal-backdrop').hidden){const items=$$('button,a[href],input,textarea,select', $('#modal')).filter(el=>!el.disabled);if(!items.length)return;const first=items[0],last=items.at(-1);if(ev.shiftKey&&document.activeElement===first){ev.preventDefault();last.focus();}else if(!ev.shiftKey&&document.activeElement===last){ev.preventDefault();first.focus();}}});
$('#modal-backdrop').addEventListener('click',ev=>{if(ev.target===$('#modal-backdrop'))closeModal();});
$('#global-search').addEventListener('input',ev=>globalCommunitySearch(ev.target.value));
document.addEventListener('click',ev=>{if(!ev.target.closest('.search-wrap,.search-results'))$('#search-results').hidden=true;});
$('#search-icon').innerHTML=icon('search');$('#bell-icon').innerHTML=icon('bell');$('.notification-button i')?.remove();
render();$('#main-content').insertAdjacentHTML('afterbegin','<p class="service-status" role="status">Connecting to your circle…</p>');
async function init(){try{await refresh();await loadPage();const sharedPost=new URL(location.href).searchParams.get('post');if(sharedPost)await commentsModal(sharedPost);const auth=new URL(location.href).searchParams.get('auth');if(auth){history.replaceState({},'',location.pathname+location.hash);if(auth==='success'){toast('Welcome to your circle ✦');trackProduct('signin_returned');await resumeRoomAfterSignIn();await restoreSocialContext();if(!data.user?.profile_completed&&!new URL(location.href).searchParams.has('post'))editProfile(true);}else if(auth==='setup')signin();else toast('X sign-in could not be completed. Please try again.');}}catch(err){$('#main-content').innerHTML=`<div class="page-intro"><h1>Your circle will be right back.</h1><p>${e(err.message)}</p><button class="primary" data-action="refresh">Try again ↻</button></div>`;}}
init();
setInterval(async()=>{if(page==='messages'&&data.user&&activeChat&&!document.hidden&&!busy){try{const owner=data.user.id,peer=activeChat,result=await api('messages',undefined,{id:peer});if(owner!==data.user?.id||peer!==activeChat||page!=='messages')return;chatMessages=result.messages;const box=$('.chat-bubbles');if(box){const bottom=box.scrollHeight-box.scrollTop-box.clientHeight<70;if(typeof patchMediaLog==='function')patchMediaLog(box,bubbles());else box.innerHTML=bubbles();if(bottom)box.scrollTop=box.scrollHeight;}}catch{}}},15000);
