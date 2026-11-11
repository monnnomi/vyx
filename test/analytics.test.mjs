import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/analytics.js',import.meta.url),'utf8');
function browser({enabled=true,saved=null,pathname='/'}={}){
 const scripts=[],nodes=new Map(),events={},documentEvents={},storage=new Map(saved?[['vyx-analytics-consent-v1',saved]]:[]);
 const location={origin:'https://new-vyx.example',pathname,hash:'#rooms',search:'?room=private-room&code=oauth-secret'};
 const document={referrer:'https://t.co/private-path?token=secret',head:{appendChild(el){scripts.push(el);}},body:{appendChild(el){nodes.set(el.id,el);}},createElement(){return {dataset:{},setAttribute(){},remove(){nodes.delete(this.id);}};},getElementById:id=>nodes.get(id),addEventListener:(name,fn)=>documentEvents[name]=fn};
 const window={VYX_ANALYTICS:{enabled,vercel:true,googleMeasurementId:'G-TEST1234',yandexCounterId:'114067415'},addEventListener:(name,fn)=>events[name]=fn};
 const localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
 vm.runInNewContext(source,{window,document,location,localStorage,URL,Date,Set,Number,Object});
 const choose=value=>documentEvents.click({target:{closest:()=>({hasAttribute:()=>false,dataset:{analyticsChoice:value}})}});
 const navigate=hash=>{location.hash=hash;events.hashchange?.();};
 const ready=()=>scripts.forEach(s=>s.onload());
 const views=()=>({vercel:(window.vaq||[]).filter(args=>args[0]==='pageview'),google:(window.dataLayer||[]).filter(args=>args[0]==='event'&&args[1]==='page_view'),yandex:(window.ym?.a||[]).filter(args=>args[1]==='hit')});
 return {window,scripts,nodes,location,choose,navigate,ready,views};
}
test('No analytics scripts or consent UI on previews, admin or sign-in endpoints',()=>{
 for(const options of [{enabled:false},{pathname:'/admin'},{pathname:'/api/auth/x'}]){
  const b=browser(options);assert.equal(b.scripts.length,0);assert.equal(b.nodes.size,0);
 }
});
test('Analytics waits for permission, measures sections once and excludes private URLs',()=>{
 const b=browser();assert.equal(b.scripts.length,0);assert.ok(b.nodes.has('analytics-consent'));
 b.choose('denied');assert.equal(b.scripts.length,0);
 b.choose('granted');assert.equal(b.scripts.length,3);b.ready();
 let views=b.views();for(const list of Object.values(views))assert.equal(list.length,1);
 assert.equal(views.google[0][2].page_location,'https://new-vyx.example/#rooms');
 assert.equal(views.google[0][2].page_referrer,'https://t.co/');
 assert.equal(views.yandex[0][2],'https://new-vyx.example/#rooms');
 const before=b.window.vaq.find(args=>args[0]==='beforeSend')[1];
 assert.equal(before({type:'pageview',url:'https://old.example/?room=private'}).url,'https://new-vyx.example/#rooms');
 b.navigate('#rooms');for(const list of Object.values(b.views()))assert.equal(list.length,1);
 b.navigate('#profile');views=b.views();for(const list of Object.values(views))assert.equal(list.length,2);
 assert.equal(views.google[1][2].page_referrer,'https://new-vyx.example/#rooms');
 assert.equal(JSON.stringify(views).includes('private-room'),false);assert.equal(JSON.stringify(views).includes('oauth-secret'),false);
 b.choose('denied');b.navigate('#feed');for(const list of Object.values(b.views()))assert.equal(list.length,2);
 assert.equal(b.window['ga-disable-G-TEST1234'],true);assert.equal(before({url:'anything'}),null);
 assert.ok(b.window.ym.a.some(args=>args[1]==='destruct'));
});
test('Declining while vendor scripts load prevents late initialization and hits',()=>{
 const b=browser({saved:'granted'});assert.equal(b.scripts.length,3);b.choose('denied');b.ready();
 for(const list of Object.values(b.views()))assert.equal(list.length,0);
 assert.equal((b.window.ym.a||[]).some(args=>args[1]==='init'),false);
});
test('journey goals are queued until ready, use only approved fields and stop after consent withdrawal',()=>{
 const b=browser();b.window.VYXAnalytics.track('first_room_message');assert.equal(b.scripts.length,0);
 b.choose('granted');b.window.VYXAnalytics.track('first_room_message','private-room-SECRET');b.window.VYXAnalytics.track('unapproved_SECRET');b.ready();
 const ga=b.window.dataLayer.filter(a=>a[0]==='event'&&a[1]==='first_room_message');
 assert.equal(ga.length,1);assert.equal(ga[0][2].outcome,'success');assert.equal(ga[0][2].page_location,'https://new-vyx.example/#rooms');
 assert.ok(b.window.ym.a.some(a=>a[1]==='reachGoal'&&a[2]==='first_room_message'));
 assert.ok(!JSON.stringify(ga).includes('SECRET'));assert.ok(!JSON.stringify(ga).includes('private-room'));
 b.choose('denied');b.window.VYXAnalytics.track('first_vp_contribution');assert.ok(!b.window.dataLayer.some(a=>a[1]==='first_vp_contribution'));
});
test('news visits measure only the section, with no story or source-account identifiers',()=>{
 const b=browser({saved:'granted'});b.ready();b.location.search='?story=PRIVATE-STORY';b.navigate('#news');
 const hit=b.views().google.at(-1);assert.equal(hit[2].page_location,'https://new-vyx.example/#news');assert.ok(!JSON.stringify(b.views()).includes('PRIVATE-STORY'));
});
