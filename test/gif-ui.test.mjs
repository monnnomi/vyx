import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

const source=await readFile(new URL('../public/media.js',import.meta.url),'utf8');
const gif=await readFile(new URL('fixtures/room-hello.gif',import.meta.url));
function setup(){
 const events=new Map(),calls=[],parts=[];
 const doc={addEventListener(name,fn){if(!events.has(name))events.set(name,[]);events.get(name).push(fn);},querySelector:()=>null,querySelectorAll:()=>[]};
 const ctx=vm.createContext({document:doc,window:{addEventListener(){}},data:{user:{id:'alice'},mediaReady:true},File,Blob,Map,Set,Promise,AbortController,AbortSignal,DOMException,
  URL:{createObjectURL:()=> 'blob:fixture',revokeObjectURL(){}},crypto:{randomUUID},e:s=>String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;'),toast(){},
  fetch:async(url,options)=>{parts.push({url,bytes:Buffer.from(await options.body.arrayBuffer())});return {ok:true,json:async()=>({ok:true})};}
 });
 vm.runInContext(source,ctx);ctx.syncMediaOwner('alice');
 ctx.mediaAPI=async(action,value)=>{calls.push({action,value});return action==='prepare'?{id:randomUUID()}:{};};
 const input={dataset:{mediaInput:'room:circle',mediaScope:'room',mediaTarget:'circle'},files:[],value:'selected'};
 return {ctx,events,calls,parts,input};
}
const ids=ctx=>Array.from(vm.runInContext('mediaSendIds("room:circle")',ctx));

test('GIFs with no MIME type are verified and uploaded unchanged, previewed and sendable without text',async()=>{
 const {ctx,calls,parts,input}=setup();
 await ctx.chooseMedia(input,[new File([gif],'hello.GIF')]);
 assert.equal(calls[0].value.contentType,'image/gif');assert.equal(calls[0].value.scope,'room');assert.equal(calls[0].value.targetId,'circle');
 assert.deepEqual(parts[0].bytes,gif);assert.equal(calls.at(-1).action,'complete');assert.equal(ids(ctx).length,1);
 assert.match(ctx.mediaDraftHTML('room:circle'),/Selected GIF/);assert.match(ctx.mediaDraftHTML('room:circle'),/>GIF</);
 const html=ctx.mediaHTML([{id:ids(ctx)[0],kind:'image',content_type:'image/gif'}]);
 assert.match(html,/aria-label="Open GIF"/);assert.match(html,/alt="Animated GIF"/);assert.match(html,/data-media-kind="gif"/);
 assert.doesNotMatch(html,/<video|\.blob\.vercel/);
});

test('renamed or oversized GIFs are rejected before upload and the dedicated chooser only accepts GIFs',async()=>{
 const {ctx,calls,input}=setup();input.dataset.mediaGifOnly='';
 await assert.rejects(ctx.chooseMedia(input,[new File(['not an image'],'renamed.gif')]),/valid GIF/);
 await assert.rejects(ctx.chooseMedia(input,[{name:'huge.gif',type:'image/gif',size:10*1024*1024+1}]),/10 MB/);
 await assert.rejects(ctx.chooseMedia(input,[new File(['png'],'photo.png',{type:'image/png'})]),/Choose GIF files/);
 assert.equal(calls.length,0);assert.equal(ids(ctx).length,0);
});

test('GIF inspection cannot carry a selected file into a different account',async()=>{
 const {ctx,calls,input}=setup();let finish;
 const file={name:'slow.gif',type:'image/gif',size:gif.length,slice:()=>({text:()=>new Promise(r=>{finish=r;})})};
 const pending=ctx.chooseMedia(input,[file]);ctx.data.user={id:'bob'};ctx.syncMediaOwner('bob');finish('GIF89a');await pending;
 assert.equal(calls.length,0);assert.equal(ids(ctx).length,0);
});

test('concurrent GIF selections share the four-image limit rather than overwriting a draft',async()=>{
 const {ctx,calls,input}=setup();const file=()=>new File([gif],'hello.gif',{type:'image/gif'});
 await Promise.all([ctx.chooseMedia(input,[file(),file()]),ctx.chooseMedia(input,[file(),file()])]);
 assert.equal(ids(ctx).length,4);assert.equal(calls.filter(c=>c.action==='prepare').length,4);
 await assert.rejects(ctx.chooseMedia(input,[file()]),/up to 4/);
});

test('room clipboard files go through the upload path while ordinary pasted text is untouched',async()=>{
 const {ctx,events,input,parts}=setup();let prevented=0;
 const target={matches:s=>s==='#room-message-input',closest:()=>({querySelector:()=>input})},handler=events.get('paste')[0];
 handler({target,clipboardData:{files:[]},preventDefault(){prevented++;}});assert.equal(prevented,0);
 handler({target,clipboardData:{files:[new File([gif],'paste.gif',{type:'image/gif'})]},preventDefault(){prevented++;}});
 for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));
 assert.equal(prevented,1);assert.equal(ids(ctx).length,1);assert.deepEqual(parts[0].bytes,gif);
});
