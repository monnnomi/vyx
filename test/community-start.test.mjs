import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/community-start.js',import.meta.url),'utf8');
function setup({consent='denied',storage=new Map(),storageUnavailable=false}={}){
 storage.set('vyx-analytics-consent-v1',consent);
 const session=new Map(),events=[],listeners={},nodes={};let displayed='',writer=async()=>({farming:{counted:true,reason:'Accepted original contribution.'}});
 const store=m=>({getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v))});
 const escape=s=>String(s??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
 const local=storageUnavailable?{getItem(){throw Error('Storage unavailable');},setItem(){throw Error('Storage unavailable');}}:store(storage);
 const c=vm.createContext({Map,Set,Date,URL,localStorage:local,sessionStorage:store(session),location:{href:'https://joinvyx.com/?utm_source=x&ref=SECRET'},window:{VYX_ANALYTICS:{enabled:true},addEventListener:(n,f)=>listeners[n]=f},document:{referrer:'https://t.co/private?code=SECRET',addEventListener:(n,f)=>listeners['document:'+n]=f},data:{user:{id:'alice',all_points:0},farming:{status:'active',current:{endsAt:'2026-11-08T04:00Z'}}},loaded:false,page:'rooms',activeRoom:'room-a',roomInfo:{joined:true},roomList:[],roomMessages:[],farmRooms:new Map(),trackProduct:e=>events.push(e),fmt:n=>String(n||0),points:()=>0,e:escape,icon:()=>'',farmCountdown:()=> '01:00:00',utcTime:x=>String(x),socialRoomAvatar:()=>'',socialChatDirectory:()=>'<form id="room-search-form">',socialWelcome:()=>'',socialFeed:()=>'<div class="feed-tabs">',socialRail:()=>'<div class="quiet-rail">',renderRoomThread:()=>'<div class="room-history-tools">',rulesModal(){},roomWrite:(...a)=>writer(...a),refreshRoomFarming:async()=>{},refreshGlobalFarming:async()=>{},render(){},$:s=>nodes[s],showModal:html=>displayed=html,closeModal(){},openRoom:async()=>{}});
 vm.runInContext(source,c);
 return {c,events,storage,session,nodes,listeners,shown:()=>displayed,writer:f=>writer=f,run:s=>vm.runInContext(s,c)};
}
test('journey events require consent, deduplicate visits and keep account/query data out of events',()=>{
 const h=setup();assert.deepEqual(h.events,[]);
 h.storage.set('vyx-analytics-consent-v1','granted');h.listeners['vyx-analytics-choice']();h.run('vyxMeasureVisit()');
 assert.deepEqual(h.events,['visit_started','visit_from_x','signed_in_visit']);assert.ok(!JSON.stringify(h.events).includes('SECRET'));assert.ok(!JSON.stringify(h.events).includes('alice'));
 h.c.data.user={id:'bob',all_points:12};h.run('vyxMeasureVisit()');assert.equal(h.events.filter(e=>e==='signed_in_visit').length,2);assert.equal(h.events.at(-1),'first_reward_seen');
});
test('next-day return is a consented once-only browser signal, not a repeat hit on each render',()=>{
 const h=setup({consent:'granted'}),yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
 h.storage.set('vyx-journey-v1:alice:first-day',JSON.stringify(yesterday));h.run('vyxMeasureVisit();vyxMeasureVisit()');assert.equal(h.events.filter(e=>e==='return_next_day').length,1);
});
test('room send feedback comes from the server and an account switch discards late responses',async()=>{
 const h=setup({consent:'granted'});let resolve;h.writer(()=>new Promise(r=>resolve=r));
 const first=h.c.roomWrite('room-send',{id:'room-a'});h.c.data.user={id:'bob'};resolve({farming:{counted:true,reason:'Alice private feedback'}});await first;
 assert.ok(!h.run("vyxRoomProgressHTML('room-a')").includes('Alice private feedback'));assert.ok(!h.events.includes('first_room_message'));
 h.writer(async()=>({farming:{counted:false,reason:'Too short <script>bad</script>'}}));await h.c.roomWrite('room-send',{id:'room-a'});
 let html=h.run("vyxRoomProgressHTML('room-a')");assert.match(html,/Message delivered; no VP contribution/);assert.match(html,/&lt;script&gt;/);assert.ok(!html.includes('<script>'));
 h.writer(async()=>({farming:{counted:true,reason:'Recorded'}}));await h.c.roomWrite('room-send',{id:'room-a'});html=h.run("vyxRoomProgressHTML('room-a')");assert.match(html,/Message counted for VP/);assert.equal(h.events.filter(e=>e==='first_room_message').length,1);assert.equal(h.events.filter(e=>e==='first_vp_contribution').length,1);
});
test('starter uses existing member rooms, safely renders names, and keeps NFT creation requirements planned',()=>{
 const h=setup();h.c.roomsLoaded=true;h.c.roomList=[{id:'real-room',name:'<script>Crypto</script>',description:'A user-owned room',member_count:3}];h.run('vyxStartModal()');
 assert.match(h.shown(),/data-vyx-open="real-room"/);assert.match(h.shown(),/&lt;script&gt;Crypto/);assert.ok(!h.shown().includes('<script>'));
 h.run("vyxGuideModal('nft')");assert.match(h.shown(),/Creating rooms is open during beta/);assert.match(h.shown(),/plan is to require additional NFTs/);assert.match(h.shown(),/50,000\+ VP and 3 referrals/);
});
test('ordinary timer polls do not replace conversation UI or steal focus',async()=>{
 const h=setup();let writes=0;h.nodes['#vyx-room-progress']={set outerHTML(_){writes++;}};
 await h.c.refreshRoomFarming();await h.c.refreshRoomFarming();assert.equal(writes,0);
});
test('VP panel hides and restores in place, remembers the choice across rooms and reloads',async()=>{
 const h=setup(),attrs={},classes=new Set();let replacements=0;
 h.nodes['#vyx-room-progress']={classList:{toggle:(name,on)=>on?classes.add(name):classes.delete(name)},set outerHTML(_){replacements++;}};
 h.nodes['#vyx-room-progress-content']={hidden:false};
 h.nodes['[data-vyx-progress-label]']={textContent:'Hide'};
 const button=h.nodes['[data-vyx-progress-toggle]']={hasAttribute:n=>n==='data-vyx-progress-toggle',dataset:{},setAttribute:(k,v)=>attrs[k]=v};
 const log=h.nodes['.room-chat-log']={scrollHeight:1200,scrollTop:800,clientHeight:400};
 const click=()=>h.listeners['document:click']({target:{closest:()=>button}});
 assert.match(h.run("vyxRoomProgressHTML('room-a')"),/aria-expanded="true"/);
 await click();assert.equal(attrs['aria-expanded'],'false');assert.equal(attrs['aria-label'],'Show VP panel');assert.equal(h.nodes['#vyx-room-progress-content'].hidden,true);assert.ok(classes.has('is-collapsed'));assert.equal(log.scrollTop,1200);assert.equal(replacements,0);
 const reloaded=setup({storage:h.storage});
 reloaded.c.activeRoom='room-b';assert.match(reloaded.run("vyxRoomProgressHTML('room-b')"),/id="vyx-room-progress-content" hidden/);
 h.c.farmRooms.set('room-a',{room:{activity:{own:3}}});
 await h.c.refreshRoomFarming();assert.match(h.run("vyxRoomProgressHTML('room-a')"),/id="vyx-room-progress-content" hidden/);
 log.scrollTop=200;await click();assert.equal(attrs['aria-expanded'],'true');assert.equal(h.nodes['#vyx-room-progress-content'].hidden,false);assert.equal(log.scrollTop,200);assert.equal(replacements,0);
 assert.doesNotMatch(setup({storage:h.storage}).run("vyxRoomProgressHTML('room-a')"),/id="vyx-room-progress-content" hidden/);
});
test('VP panel remains usable without browser storage and is absent for guests or non-members',()=>{
 const h=setup({storageUnavailable:true});
 h.run('vyxSetRoomProgressCollapsed(true)');assert.match(h.run("vyxRoomProgressHTML('room-a')"),/aria-expanded="false"/);
 h.run('vyxSetRoomProgressCollapsed(false)');assert.match(h.run("vyxRoomProgressHTML('room-a')"),/aria-expanded="true"/);
 h.c.roomInfo={joined:false};assert.equal(h.run("vyxRoomProgressHTML('room-a')"),'');
 h.c.roomInfo={joined:true};h.c.data.user=null;assert.equal(h.run("vyxRoomProgressHTML('room-a')"),'');
});
