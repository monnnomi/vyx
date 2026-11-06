import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const names=['app','halloween','farming','rooms','room-messenger','drop-scene','product','wonder','club','social-shell','social-quality','message-reactions','community'];
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
