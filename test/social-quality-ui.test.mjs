import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {messageReactionEmojis} from '../server/message-reactions.js';
const names=['app','halloween','farming','rooms','room-messenger','drop-scene','product','wonder','club','social-shell','social-quality','message-reactions','message-views','referrals','nft-selection','nft-whitelist','x-tasks','community'];
const sources=await Promise.all(names.map(n=>readFile(new URL('../public/'+n+'.js',import.meta.url),'utf8')));
function setup(){
 const node={classList:{add(){},remove(){},toggle(){}},dataset:{},style:{},value:'',hidden:true,setAttribute(){},addEventListener(){},querySelectorAll(){return []},querySelector(){return node},insertAdjacentHTML(){},remove(){},focus(){}};
 const document={body:node,head:node,activeElement:node,querySelector:()=>node,querySelectorAll:()=>[],getElementById:()=>node,addEventListener(){},createElement:()=>node};
 const ctx=vm.createContext({console,document,window:{addEventListener(){}},location:{hash:'#rooms',href:'http://localhost/',origin:'http://localhost',pathname:'/'},localStorage:{getItem:()=>null,setItem(){}},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},history:{replaceState(){}},navigator:{},matchMedia:()=>({matches:false}),performance:{now:()=>1},setTimeout:()=>1,clearTimeout(){},setInterval(){},Date,URL,Map,Set,Intl,crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000001'},fetch:async()=>{throw new Error('Unexpected fetch');}});
 sources.forEach((s,i)=>{if(names[i]==='community')s=s.slice(0,s.indexOf("render();$('#main-content').insertAdjacentHTML"));vm.runInContext(s,ctx,{filename:names[i]+'.js'});});
 vm.runInContext(`data={user:{id:'alice',name:'Alice',handle:'alice',bio:'',interests:'Design',points:0,all_points:0,history:[],inventory:[],posts:0,following:0,followers:0},members:[],posts:[],calendar:{label:'November',season:'season-1'},event:null,farming:null};loaded=true;`,ctx);
 return ctx;
}
test('all scripts initialize in page order and empty feeds explain the actual action',()=>{
 const c=setup();vm.runInContext("feedTab='saved'",c);assert.match(c.socialFeed(),/Tap the bookmark/);assert.doesNotMatch(c.socialFeed(),/Start a conversation with/);
 vm.runInContext("feedTab='following'",c);assert.match(c.socialFeed(),/Your feed starts with people/);
});

test('message counters sit next to reactions and all 24 picker options match the server',()=>{
 const c=setup(),html=c.messageReactionsHTML({id:'message-fixture',view_count:12,reactions:[{emoji:'🚀',count:3,mine:true}]},'room');
 assert.match(html,/12 unique views/);assert.match(html,/message-view-number">12/);assert.match(html,/data-emoji="🚀"/);assert.match(html,/aria-pressed="true"/);assert.doesNotMatch(html,/viewers-list|user_id/);
 const options=vm.runInContext('messageReactionOptions.map(([emoji])=>emoji)',c);assert.deepEqual(Array.from(options),messageReactionEmojis);assert.equal(options.length,24);
});
test('loaded profiles and room threads do not flash false empty states while pending',()=>{
 const c=setup();assert.match(c.socialProfile(),/Loading your posts/);assert.doesNotMatch(c.socialProfile(),/Your first post starts/);
 vm.runInContext('roomLoading=true',c);assert.match(c.roomBubbles(),/Loading the conversation/);assert.doesNotMatch(c.roomBubbles(),/Be the first/);
 vm.runInContext("roomLoading=false;roomLoadError='Offline'",c);assert.match(c.roomBubbles(),/Try again/);
});
test('text decoding preserves apostrophes and escapes entity-encoded markup',()=>{
 const c=setup();assert.equal(vm.runInContext("escapeHTML('It&#39;s a good day')",c),'It&#39;s a good day');
 const x=vm.runInContext("escapeHTML('&lt;script&gt;alert(1)&lt;/script&gt;')",c);assert.equal(x,'&lt;script&gt;alert(1)&lt;/script&gt;');assert.doesNotMatch(x,/<script>/);
 assert.equal(vm.runInContext("displayText('It&#39;s &quot;fine&quot; 👋')",c),'It\'s "fine" 👋');
});
test('discovery shows explicit empty search and profile preserves messaging requirements',()=>{
 const c=setup();vm.runInContext("exploreQuery='nothing';exploreStatus='ready';exploreState={people:[],rooms:[],posts:[]}",c);
 assert.match(c.renderExplore(),/No matches for/);assert.match(c.renderExplore(),/Browse rooms and people/);
 const html=c.memberProfileHTML({person:{id:'bob',name:'Bob',handle:'bob',bio:'',followers:0,post_count:0},posts:[],rooms:[],controls:{}});assert.match(html,/Direct messages open when you follow each other/);assert.match(html,/<button class="secondary" disabled>Message/);
});
test('confirmed balance and current round precede the decorative chest; own posts precede collection',()=>{
 const c=setup();vm.runInContext(`dropData={summary:{total:100,today:20,unopened:0,pending:0},current:{startsAt:'2026-11-06T08:00:00Z',endsAt:'2026-11-06T12:00:00Z',ruleVersion:2},activity:{used:1,eligible:1,weight:1,rooms:1,releasedBudget:100,participants:1},results:[],estimate:20};profileStatus='ready';data.event={minted:true};`,c);
 const drops=c.renderDrops();assert.ok(drops.indexOf('Confirmed room VP')<drops.indexOf('drop-feature'));assert.ok(drops.indexOf('current-round')<drops.indexOf('drop-feature'));assert.match(drops,/Estimated VP: 20 VP · may change/);
 const profile=c.socialProfile();assert.ok(profile.indexOf('account-posts')<profile.indexOf('account-collection'));
});

test('apostrophes are not interpreted as hashtags and links remain safe',()=>{
 const c=setup();const html=c.socialText("It&#39;s a #VYX story with https://example.com/?a=1&b=2 and <img src=x onerror=alert(1)>");
 assert.match(html,/It&#39;s/);assert.doesNotMatch(html,/>#39</);assert.match(html,/<span class="hashtag">#VYX<\/span>/);assert.doesNotMatch(html,/<img/);assert.match(html,/rel="noopener noreferrer"/);
});

test('NFT status explains missing requirements and appears only on the owner profile',()=>{
 const c=setup();
 assert.match(c.nftEligibilityHTML(),/Checking your confirmed VP/);
 vm.runInContext(`nftSelectionOwner='alice';nftSelectionState='ready';nftSelectionData={tier:'full-price',confirmedVP:49000,invitedReferrals:1,vpRemaining:1000,referralsRemaining:2,rules:{vp:50000,referrals:3}}`,c);
 assert.match(c.socialProfile(),/Your NFT eligibility/);assert.match(c.nftEligibilityHTML(),/Earn 1,000 more confirmed VP/);assert.match(c.nftEligibilityHTML(),/2 more invitations/);
 const other=c.memberProfileHTML({person:{id:'bob',name:'Bob',handle:'bob',bio:'',followers:0,post_count:0},posts:[],rooms:[],controls:{}});assert.doesNotMatch(other,/Your NFT eligibility|Full price|50% off|Free NFT/);
 vm.runInContext(`nftSelectionData.tier='half-price';nftSelectionData.vpRemaining=0`,c);assert.match(c.nftEligibilityHTML(),/You qualify for 50% off/);
 vm.runInContext(`nftSelectionData.tier='free';nftSelectionData.referralsRemaining=0`,c);assert.match(c.nftEligibilityHTML(),/meet both requirements/);
 vm.runInContext(`data.user={id:'bob'}`,c);assert.match(c.nftEligibilityHTML(),/Checking your confirmed VP/);assert.doesNotMatch(c.nftEligibilityHTML(),/meet both requirements/);
});

test('late private eligibility responses are discarded after an account change',async()=>{
 const c=setup();let finish;c.api=()=>new Promise(resolve=>finish=resolve);
 const pending=c.loadNftSelection();vm.runInContext(`data.user={id:'bob'}`,c);finish({tier:'free'});await pending;
 assert.equal(vm.runInContext('nftSelectionData',c),null);assert.doesNotMatch(c.nftEligibilityHTML(),/meet both requirements/);
});

test('X quests show the fixed 8500 VP campaign, verified state and explicit read-only connection',()=>{
 const c=setup();
 vm.runInContext(`xTaskOwner='alice';xTaskData={connected:false,earned:0,tasks:[{id:'test-task',title:'Follow VYX',amount:1000,url:'https://x.com/vyxsocial',status:'not-verified',detail:'Complete the action on X.'}]}`,c);
 const pending=c.renderTasks();assert.match(pending,/8,500 VP/);assert.match(pending,/Connect X for verification/);assert.match(pending,/read your follows, likes and posts/);assert.match(pending,/\/api\/auth\/x\?returnTo=%2Ftasks/);assert.match(pending,/disabled>Check/);
 vm.runInContext(`xTaskData.connected=true;xTaskData.earned=1000;xTaskData.tasks[0].status='awarded'`,c);
 const done=c.renderTasks();assert.match(done,/Verified · VP added/);assert.doesNotMatch(done,/data-x-task-open/);
 vm.runInContext(`data.user={id:'bob'}`,c);assert.doesNotMatch(c.renderTasks(),/Verified · VP added/);
});

test('whitelist shows qualified tiers with profile links and keeps personal progress owner-bound',()=>{
 const c=setup();
 vm.runInContext(`whitelistState='ready';whitelistData={counts:{free:1,halfPrice:1,total:2},pagination:{page:1,pages:1},members:[{id:'alice',name:'Alice',handle:'alice',tier:'free'},{id:'bob',name:'Bob',handle:'bob',tier:'half-price'}]};nftSelectionOwner='alice';nftSelectionState='ready';nftSelectionData={tier:'free'}`,c);
 const html=c.renderWhitelist();assert.match(html,/You’re on the Free NFT list/);assert.match(html,/data-person="bob"/);assert.match(html,/data-whitelist-filter="half-price"/);assert.match(html,/NFT minting is not open yet/);assert.doesNotMatch(html,/vpRemaining|referralsRemaining/);
 vm.runInContext(`data.user={id:'carol'};whitelistData.members=[];whitelistFilter='free'`,c);
 const other=c.renderWhitelist();assert.doesNotMatch(other,/You’re on the Free NFT list/);assert.match(other,/The first free places are waiting/);
 vm.runInContext(`whitelistState='error'`,c);assert.match(c.renderWhitelist(),/The whitelist could not be loaded/);
 assert.match(c.communityRankingsNav('whitelist'),/href="#whitelist" aria-current="page"/);
});
