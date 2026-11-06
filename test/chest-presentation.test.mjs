import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const files=await Promise.all(['drop-scene.js','wonder.js','product.js','community.js'].map(n=>readFile(new URL('../public/'+n,import.meta.url),'utf8')));
const modalSource=files[3].slice(files[3].indexOf('function showModal('),files[3].indexOf('function signin('));
const receipt={id:'2026-11-01T00:00:00.000Z',amount:1250,finalizedAt:'2026-11-01T04:00:00Z',revealedAt:'2026-11-01T05:00:00Z',activity:2,rooms:[{name:'Local test room',activity:2,roomActivity:2,amount:1250}]};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup(saved){
 const listeners={},timers=[],sources=[],contexts=[],nodes={},storage=new Map(saved===undefined?[]:[['vyx-drop-sound',saved]]);let now=0,modalWrites=0;
 for(const name of ['#modal','#modal-backdrop','.app-shell','#sidebar','.drop-arrival .sky-scene','[data-drop-reveal]','.modal-close'])nodes[name]={hidden:false,isConnected:true,dataset:{},classList:{add(){},remove(){}},focus(){}};
 Object.defineProperty(nodes['#modal'],'innerHTML',{set(v){this.html=v;modalWrites++;},get(){return this.html||'';}});
 const doc={hidden:false,body:{dataset:{},style:{},classList:{toggle(){}}},addEventListener:(name,fn)=>(listeners[name]??=[]).push(fn),querySelector:s=>nodes[s]||null,querySelectorAll:()=>[]};
 class Audio {
  constructor(){this.state='suspended';this.currentTime=0;this.destination={};contexts.push(this);}
  resume(){this.state='running';return Promise.resolve();}
  decodeAudioData(){return Promise.resolve({duration:4.2});}
  createGain(){return {gain:{value:.6,setValueAtTime(){},linearRampToValueAtTime(){},cancelScheduledValues(){}},connect(){},disconnect(){}};}
  createBufferSource(){const s={connect(){},disconnect(){},start(...args){this.started=args;},stop(...args){this.stopped=args;}};sources.push(s);return s;}
 }
 const c=vm.createContext({console,document:doc,window:{AudioContext:Audio},performance:{now:()=>now},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},fetch:async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)}),setTimeout:(fn,delay)=>timers.push({fn,at:now+delay}),setInterval(){},requestAnimationFrame(){},matchMedia:()=>({matches:false}),Image:class{},Date,Map,Math,
  $:s=>nodes[s]||null,$$:()=>[],data:{user:{id:'alice',points:10}},modalFocus:null,fmt:String,e:String,utcTime:()=> 'UTC',icon:()=>'',page:'feed',toast(){},requireUser:()=>true,api:async()=>receipt});
 for(const source of files.slice(0,3))vm.runInContext(source,c);vm.runInContext(modalSource,c);
 return {c,doc,nodes,sources,contexts,storage,run:s=>vm.runInContext(s,c),writes:()=>modalWrites,advance:ms=>{now+=ms;for(const t of timers.splice(0)){if(t.at<=now)t.fn();else timers.push(t);}},emit:name=>{for(const fn of listeners[name]||[])fn();}};
}
test('sound is on for new users, respects saved mute and never plays merely while preloading',async()=>{
 const h=setup();assert.equal(h.run('wonderSound'),true);await h.c.prepareWonderAudio();assert.equal(h.sources.length,0);
 const muted=setup('off');muted.c.playWonderOpening();await flush();assert.equal(muted.contexts.length,0);assert.equal(muted.sources.length,0);
});
test('opening plays one bounded voice; closing or hiding stops it',async()=>{
 const h=setup();h.c.playWonderOpening();await flush();assert.equal(h.sources.length,1);assert.equal(h.doc.body.dataset.dropAudio,'playing');
 h.c.closeModal();assert.ok(h.sources[0].stopped);assert.equal(h.doc.body.dataset.dropAudio,'idle');
 h.nodes['#modal-backdrop'].hidden=false;h.c.playWonderOpening();await flush();h.doc.hidden=true;h.emit('visibilitychange');assert.ok(h.sources[1].stopped);
});
test('late audio decoding after cancellation cannot start a hidden sound',async()=>{
 const h=setup();let finish;h.c.fetch=()=>new Promise(resolve=>finish=resolve);h.c.playWonderOpening();h.c.stopWonderAudio();finish({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)});await flush();assert.equal(h.sources.length,0);
});
test('room reveal waits for the confirmed receipt, then skip stops sound and never acknowledges twice',async()=>{
 const h=setup();let finish,calls=0;h.c.api=()=>{calls++;return new Promise(resolve=>finish=resolve);};
 const pending=h.c.revealResult(receipt.id);await flush();assert.equal(h.sources.length,0);finish(receipt);await pending;await flush();assert.equal(h.nodes['.drop-arrival .sky-scene'].dataset.skyState,'opening');assert.equal(h.sources.length,1);
 await h.c.revealResult(receipt.id,true);assert.ok(h.sources[0].stopped);assert.match(h.nodes['#modal'].html,/1250/);const writes=h.writes();h.advance(4000);assert.equal(h.writes(),writes);assert.equal(calls,1);assert.equal(h.c.data.user.points,10);
});
test('closing while acknowledgement is pending cannot resurrect a reveal or play sound',async()=>{
 const h=setup();let finish;h.c.api=()=>new Promise(resolve=>finish=resolve);const pending=h.c.revealResult(receipt.id);h.c.closeModal();finish(receipt);await pending;await flush();h.advance(4000);assert.equal(h.nodes['#modal-backdrop'].hidden,true);assert.equal(h.sources.length,0);assert.equal(h.writes(),0);
});
test('a previous account cannot present a receipt after account switching',async()=>{
 const h=setup();let finish;h.c.api=()=>new Promise(resolve=>finish=resolve);const pending=h.c.revealResult(receipt.id);h.c.data.user={id:'bob',points:0};finish(receipt);await pending;await flush();assert.equal(h.sources.length,0);assert.equal(h.writes(),0);assert.equal(h.c.data.user.points,0);
});
test('collectible preview can skip once without a second result or any allocation',async()=>{
 const h=setup();h.c.presentChestOpening('<h2>Confirmed result</h2>',2,'alice',h.run('revealToken'));await flush();assert.match(h.nodes['#modal'].html,/wonder-collectible/);h.c.stopWonderAudio();h.run('activeChestReveal.finish()');const writes=h.writes();h.advance(4000);assert.equal(h.writes(),writes);assert.match(h.nodes['#modal'].html,/Confirmed result/);assert.equal(h.c.data.user.points,10);
});
test('reduced motion goes straight to the same result with only a short sound cue',async()=>{
 const h=setup();h.run("motion='reduced'");await h.c.revealResult(receipt.id);await flush();assert.match(h.nodes['#modal'].html,/1250/);assert.equal(h.sources[0].started[2],.48);assert.equal(h.c.data.user.points,10);
});
test('original audio is finite stereo PCM with a quiet start, a clear release and a clean ending',async()=>{
 const wav=await readFile(new URL('../public/assets/audio/chest-open.wav',import.meta.url));assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.readUInt16LE(22),2);const rate=wav.readUInt32LE(24),frames=(wav.length-44)/4;assert.ok(Math.abs(frames/rate-4.2)<.001);
 let peak=0;for(let p=44;p<wav.length;p+=2)peak=Math.max(peak,Math.abs(wav.readInt16LE(p))/32768);assert.ok(peak>.7&&peak<.8);
 const rms=(a,b)=>{let sum=0,count=0;for(let i=Math.floor(a*rate);i<Math.floor(b*rate);i++){const n=wav.readInt16LE(44+i*4)/32768;sum+=n*n;count++;}return Math.sqrt(sum/count);};
 assert.ok(rms(1.3,1.65)>rms(.7,.95)*3);assert.ok(rms(4.15,4.2)<rms(1.3,1.65)*.05);
});
