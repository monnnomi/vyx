import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../public/farming.js',import.meta.url),'utf8');
function harness(){
 let monotonic=0,wall=100000,calls=0,rail=0,main=0;
 const start=Date.parse('2026-11-02T11:59:50Z'),old={serverNow:new Date(start).toISOString(),status:'active',current:{endsAt:'2026-11-02T12:00:00Z'}};
 const next={serverNow:'2026-11-02T12:00:01Z',status:'active',current:{endsAt:'2026-11-02T16:00:00Z'},balance:null};
 const nodes={'.drop-strip':{outerHTML:'old timer'},'#right-rail':{},'#header-points':{textContent:'0'}};
 class ClockDate extends Date{static now(){return wall;}}
 const c=vm.createContext({Date:ClockDate,performance:{now:()=>monotonic},document:{hidden:false,addEventListener(){},querySelector:s=>nodes[s]||null,querySelectorAll:()=>[]},setInterval(){},page:'feed',activeRoom:null,roomInfo:null,data:{user:null,farming:old},fetch:async()=>{calls++;return {ok:true,json:async()=>next};},dropStrip:()=>'<new timer>',renderRail:()=>rail++,render:()=>main++});
 vm.runInContext(source,c);vm.runInContext('syncFarmClock(data.farming)',c);
 return {c,next,nodes,advance:n=>{monotonic+=n;wall+=n;},refresh:()=>vm.runInContext('refreshGlobalFarming()',c),counts:()=>({calls,rail,main}),setFetch:fn=>{c.fetch=async(...args)=>{calls++;return fn(...args);};}};
}
test('public round timer waits for server time, refreshes at the boundary and preserves the feed draft',async()=>{
 const h=harness();await h.refresh();assert.equal(h.counts().calls,0);
 h.advance(11000);await h.refresh();assert.equal(h.c.data.farming.current.endsAt,'2026-11-02T16:00:00Z');
 assert.equal(h.nodes['.drop-strip'].outerHTML,'<new timer>');assert.deepEqual(h.counts(),{calls:1,rail:1,main:0});
 h.advance(21000);await h.refresh();assert.equal(h.counts().calls,1);
});
test('boundary requests are deduplicated and a result from a previous account is discarded',async()=>{
 const h=harness();let done;h.c.data.user={id:'alice'};h.setFetch(()=>new Promise(r=>done=r));h.advance(11000);
 const first=h.refresh();h.advance(21000);await h.refresh();assert.equal(h.counts().calls,1);
 h.c.data.user={id:'bob'};done({ok:true,json:async()=>({...h.next,balance:{points:999,all_points:999}})});await first;
 assert.equal(h.c.data.farming.current.endsAt,'2026-11-02T12:00:00Z');assert.equal(h.c.data.user.points,undefined);
});
test('a failed boundary read retains activity and retries after a bounded delay without displaying an award',async()=>{
 const h=harness();h.setFetch(async()=>({ok:false,json:async()=>({error:'Temporarily unavailable'})}));h.advance(11000);await h.refresh();await h.refresh();
 assert.equal(h.counts().calls,1);assert.equal(h.nodes['.drop-strip'].outerHTML,'old timer');assert.equal(h.c.data.farming.current.endsAt,'2026-11-02T12:00:00Z');
 h.advance(20000);await h.refresh();assert.equal(h.counts().calls,2);assert.equal(h.counts().main,0);
});

test('NFT rules explicitly allow stacked copies and multipliers above 100%; rates remain unannounced',()=>{
 const h=harness();let shown='';h.c.showModal=html=>shown=html;vm.runInContext('farmRulesModal()',h.c);
 assert.match(shown,/Bonuses stack.*multiple copies/);assert.match(shown,/no personal multiplier ceiling/);assert.match(shown,/Exact bonuses.*announced before activation/);
 assert.doesNotMatch(shown,/Duplicate copies.*do not stack|Maximum coefficient is always/);
 assert.equal(vm.runInContext("farmPercent('5000000')",h.c),'500');assert.equal(vm.runInContext("farmPercent('1000000')",h.c),'100');
 assert.equal(vm.runInContext("farmPercent('900719925474099300000')",h.c),'90,071,992,547,409,930');
});
