/* Only named app sections are measured. No room, person, post or receipt identifiers. */
'use strict';
(()=>{
 const config=window.VYX_ANALYTICS||{};
 if(!config.enabled||location.pathname!=='/'&&location.pathname!=='/index.html')return;
 const sections=new Set(['rooms','feed','explore','notifications','profile','messages','drops','rewards','leaderboard','settings','tasks']);
 const titles={rooms:'Chats',feed:'Feed',explore:'Explore',notifications:'Activity',profile:'Profile',messages:'Direct messages',drops:'Drops',rewards:'Collection',leaderboard:'Leaderboard',settings:'Settings',tasks:'Quests'};
 const key='vyx-analytics-consent-v1';
 let choice='unset';try{choice=localStorage.getItem(key)||'unset';}catch{}
 if(!['granted','denied'].includes(choice))choice='unset';
 const loaded={},active={},last={};
 const ga=/^G-[A-Z0-9]{4,20}$/.test(config.googleMeasurementId||'')?config.googleMeasurementId:null;
 const ym=/^[1-9]\d{4,11}$/.test(String(config.yandexCounterId||''))?Number(config.yandexCounterId):null;
 const route=()=>sections.has(location.hash.slice(1))?location.hash.slice(1):'rooms';
 const pageURL=()=>location.origin+'/#'+route();
 const referer=()=>{try{return document.referrer?new URL(document.referrer).origin+'/':'';}catch{return '';}};
 function script(name,src,ready){
  if(loaded[name]===true){ready();return;}
  if(loaded[name]==='loading')return;
  loaded[name]='loading';const el=document.createElement('script');el.src=src;el.async=true;el.referrerPolicy='origin';el.dataset.analyticsVendor=name;
  if(name==='vercel')el.dataset.disableAutoTrack='1';
  el.onload=()=>{loaded[name]=true;el.dataset.analyticsState='loaded';if(choice==='granted')ready();};
  el.onerror=()=>{loaded[name]=false;el.dataset.analyticsState='unavailable';};
  document.head.appendChild(el);
 }
 function send(name){
  if(choice!=='granted'||!active[name])return;
  const url=pageURL();if(last[name]===url)return;
  const previous=last[name]||referer(),title='VYX · '+titles[route()];last[name]=url;
  if(name==='vercel')window.va('pageview',{route:'/#'+route(),path:'/#'+route()});
  if(name==='google'){
   window.gtag('set',{page_location:url,page_referrer:previous,page_title:title});
   window.gtag('event','page_view',{send_to:ga,page_location:url,page_referrer:previous,page_title:title});
  }
  if(name==='yandex')window.ym(ym,'hit',url,{title,referer:previous});
 }
 function start(){
  if(choice!=='granted')return;
  if(config.vercel){
   window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments);};
   window.va('beforeSend',event=>choice==='granted'?{...event,url:pageURL()}:null);
   script('vercel','/_vercel/insights/script.js',()=>{active.vercel=true;send('vercel');});
  }
  if(ga){
   window['ga-disable-'+ga]=false;window.dataLayer=window.dataLayer||[];
   window.gtag=window.gtag||function(){window.dataLayer.push(arguments);};
   script('google','https://www.googletagmanager.com/gtag/js?id='+ga,()=>{
    if(!active.google){
     window.gtag('consent','default',{analytics_storage:'granted',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
     window.gtag('js',new Date());
     window.gtag('config',ga,{send_page_view:false,page_location:pageURL(),page_referrer:referer(),allow_google_signals:false,allow_ad_personalization_signals:false,cookie_flags:'SameSite=Lax;Secure',cookie_domain:'auto'});
     active.google=true;
    }send('google');
   });
  }
  if(ym){
   window.ym=window.ym||function(){(window.ym.a=window.ym.a||[]).push(arguments);};window.ym.l=window.ym.l||Date.now();
   script('yandex','https://mc.yandex.ru/metrika/tag.js?id='+ym,()=>{
    if(!active.yandex){window.ym(ym,'init',{defer:true,webvisor:false,clickmap:false,trackLinks:false,trackHash:false,accurateTrackBounce:false,ecommerce:false,url:pageURL(),referrer:referer()});active.yandex=true;}send('yandex');
   });
  }
 }
 function choose(value){
  choice=value;try{localStorage.setItem(key,value);}catch{}
  document.getElementById('analytics-consent')?.remove();
  if(value==='granted')start();
  else{
   if(ga)window['ga-disable-'+ga]=true;
   if(active.yandex){window.ym(ym,'destruct');active.yandex=false;}
   Object.keys(last).forEach(name=>delete last[name]);
  }
  const label=document.getElementById('analytics-preference');if(label)label.textContent=preference();
 }
 function preference(){return choice==='granted'?'Allowed':choice==='denied'?'Off':'Not chosen';}
 function open(){
  if(document.getElementById('analytics-consent'))return;
  const box=document.createElement('aside');box.id='analytics-consent';box.className='analytics-consent';box.setAttribute('aria-label','Analytics preferences');box.setAttribute('role','region');
  box.innerHTML='<strong>Help us understand VYX.</strong><p>Allow Google Analytics, Yandex Metrica and Vercel Analytics to measure visits and app sections. We do not send your messages or profile details. <a href="/privacy.html#analytics">Privacy</a></p><div><button class="secondary" data-analytics-choice="denied">No thanks</button><button class="primary" data-analytics-choice="granted">Allow analytics</button></div>';
  document.body.appendChild(box);
 }
 window.VYXAnalytics={open,preference};
 document.addEventListener('click',ev=>{const button=ev.target.closest('[data-analytics-choice],[data-analytics-settings]');if(!button)return;if(button.hasAttribute('data-analytics-settings'))open();else choose(button.dataset.analyticsChoice);});
 window.addEventListener('hashchange',()=>Object.keys(active).forEach(send));
 window.addEventListener('storage',ev=>{if(ev.key===key)choose(ev.newValue==='granted'?'granted':'denied');});
 if(choice==='granted')start();else if(choice==='unset')open();
})();
