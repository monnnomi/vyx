'use strict';
const mediaDrafts=new Map(),mediaRequests=new Map();let mediaOwner=null,mediaEpoch=0;
const mediaAccept='image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/webm,video/quicktime';
const mediaClip='<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9"/><path d="m8 12 6-6"/></svg>';
function syncMediaOwner(id){if(mediaOwner===id)return;mediaOwner=id;mediaEpoch++;closeMediaViewer();for(const files of mediaDrafts.values())for(const f of files){f.controller?.abort();URL.revokeObjectURL(f.preview);}mediaDrafts.clear();mediaRequests.clear();}
function mediaDraftIds(key){return (mediaDrafts.get(key)||[]).filter(f=>f.status==='ready').map(f=>f.id);}
function mediaHasDraft(key){return (mediaDrafts.get(key)||[]).length>0;}
function mediaSendIds(key){const files=mediaDrafts.get(key)||[];if(files.some(f=>f.status==='uploading'))throw new Error('Wait for your attachments to finish uploading.');if(files.some(f=>f.status==='error'))throw new Error('Remove the failed attachment and choose it again.');return files.map(f=>f.id);}
function clearMediaDraft(key){for(const f of mediaDrafts.get(key)||[]){f.controller?.abort();URL.revokeObjectURL(f.preview);}mediaDrafts.delete(key);mediaRequests.delete(key);mediaChanged(key);}
function mediaRequestId(key,body,ids){const signature=JSON.stringify([body,ids]),old=mediaRequests.get(key);if(old?.signature===signature)return old.id;const id=crypto.randomUUID();mediaRequests.set(key,{signature,id});return id;}
function restoreMediaComposers(){for(const key of new Set([...document.querySelectorAll('form[data-media-form]')].map(f=>f.dataset.mediaForm)))mediaChanged(key);}
function mediaComposerHTML(key,scope,target=null){
 if(!data.user||!data.mediaReady)return '';
 const destination=`data-media-input="${e(key)}" data-media-scope="${scope}" ${target?`data-media-target="${target}"`:''}`;
 return `<div class="media-tools"><button class="media-attach icon-button" type="button" data-media-choose="${e(key)}" aria-label="Attach photos or video" title="Photos and GIFs up to 10 MB · video up to 50 MB">${mediaClip}</button><input type="file" accept="${mediaAccept}" multiple hidden ${destination}>${scope==='room'?`<button class="media-gif-button" type="button" data-media-gif-choose="${e(key)}" aria-label="Attach a GIF" title="Choose your GIF · up to 10 MB"><span>GIF</span></button><input type="file" accept="image/gif,.gif" multiple hidden data-media-gif-only ${destination}>`:''}<span class="media-hint">Photo / video</span></div>`;
}
function mediaDraftHTML(key){return `<div class="media-draft" data-media-key="${e(key)}">${(mediaDrafts.get(key)||[]).map(f=>`<figure data-media-asset="${e(f.id||'')}" class="media-preview ${f.status==='error'?'has-error':''}">${f.kind==='image'?`<img src="${e(f.preview)}" alt="${f.contentType==='image/gif'?'Selected GIF':'Selected photo'}">${f.contentType==='image/gif'?'<span class="media-gif-label">GIF</span>':''}`:`<video src="${e(f.preview)}" muted playsinline preload="metadata" aria-label="Selected video"></video><span class="media-video-label">VIDEO</span>`}<button type="button" data-media-remove="${f.key}" data-media-draft="${e(key)}" aria-label="Remove attachment">×</button><figcaption>${f.status==='uploading'?(f.progress===100?'Finishing…':`Uploading ${f.progress}%`):f.status==='error'?e(f.error):'Ready'}</figcaption>${f.status==='uploading'?`<progress max="100" value="${f.progress}" aria-label="Upload progress"></progress>`:''}</figure>`).join('')}</div>`;}
function mediaChanged(key){
 for(const slot of document.querySelectorAll('.media-draft[data-media-key]'))if(slot.dataset.mediaKey===key)slot.outerHTML=mediaDraftHTML(key);
 for(const form of document.querySelectorAll('form[data-media-form]'))if(form.dataset.mediaForm===key){
  const field=form.querySelector('textarea,input:not([type=file]):not([type=hidden])'),files=mediaDrafts.get(key)||[],pending=files.some(f=>f.status!=='ready');
  if(field){field.required=!files.length;if(field.id==='post-input')field.minLength=files.length?0:20;}
  const button=form.querySelector('button[type=submit],button.primary:not([type=button])');if(button)button.disabled=pending;
 }
 if(key.startsWith('room:')&&typeof activeRoom!=='undefined'&&key==='room:'+activeRoom&&typeof saveRoomDraft==='function')saveRoomDraft();
}
async function mediaAPI(action,value){const r=await fetch('/api/media?action='+action,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});const result=await r.json();if(!r.ok)throw new Error(result.error||'The attachment could not be uploaded.');return result;}
async function normalizeMediaFile(file){
 const unnamedGIF=(!file.type||file.type==='application/octet-stream')&&/\.gif$/i.test(file.name);
 if(file.type!=='image/gif'&&!unnamedGIF)return file;
 if(file.size>10*1024*1024)throw new Error('GIFs can be up to 10 MB.');
 if(!/^GIF8[79]a$/.test(await file.slice(0,6).text()))throw new Error('Choose a valid GIF file.');
 return unnamedGIF?new File([file],file.name,{type:'image/gif',lastModified:file.lastModified}):file;
}
async function chooseMedia(input,files=null){
 if(!data.user)return;const owner=data.user.id,epoch=mediaEpoch,key=input.dataset.mediaInput,scope=input.dataset.mediaScope,targetId=input.dataset.mediaTarget||null,selection=[...(files||input.files)];if(!files)input.value='';if(!selection.length)return;
 const selected=await Promise.all(selection.map(normalizeMediaFile));
 if(epoch!==mediaEpoch||data.user?.id!==owner)return;
 if('mediaGifOnly' in input.dataset&&selected.some(f=>f.type!=='image/gif'))throw new Error('Choose GIF files, or use the paperclip for photos and videos.');
 const existing=mediaDrafts.get(key)||[],types=mediaAccept.split(',');
 if(selected.some(f=>!types.includes(f.type)))throw new Error('Use JPG, PNG, WebP, GIF, AVIF, MP4, WebM or MOV.');
 const all=[...existing,...selected.map(f=>({kind:f.type.startsWith('image/')?'image':'video'}))];
 if(all.length>4||all.some(f=>f.kind==='video')&&all.length!==1)throw new Error('Choose up to 4 photos, or share 1 video at a time.');
 if(selected.some(f=>f.size<1||f.size>(f.type.startsWith('image/')?10:50)*1024*1024))throw new Error('Photos can be up to 10 MB; videos up to 50 MB.');
 const queued=selected.map(file=>({file,entry:{key:crypto.randomUUID(),kind:file.type.startsWith('image/')?'image':'video',contentType:file.type,preview:URL.createObjectURL(file),status:'uploading',progress:0,controller:new AbortController()}}));
 mediaDrafts.set(key,[...existing,...queued.map(q=>q.entry)]);mediaChanged(key);
 for(const {file,entry} of queued){
  if(epoch!==mediaEpoch||data.user?.id!==owner)break;
  if(!(mediaDrafts.get(key)||[]).includes(entry))continue;
  try{
   const prepared=await mediaAPI('prepare',{scope,targetId,contentType:file.type,size:file.size});
   if(epoch!==mediaEpoch||data.user?.id!==owner)continue;
   entry.id=prepared.id;mediaChanged(key);
   const chunkSize=data.mediaLimits?.chunkBytes||2*1024*1024;
   for(let offset=0,part=1;offset<file.size;offset+=chunkSize,part++){
    if(entry.controller.signal.aborted)throw new DOMException('Upload cancelled.','AbortError');
    const end=Math.min(file.size,offset+chunkSize),chunk=file.slice(offset,end);let uploaded=false;
    for(let attempt=0;attempt<2&&!uploaded;attempt++){
     try{
      const response=await fetch('/api/media?action=part&id='+prepared.id+'&part='+part,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/octet-stream'},body:chunk,signal:AbortSignal.any([entry.controller.signal,AbortSignal.timeout(120000)])});
      const result=await response.json().catch(()=>({error:'The connection was interrupted. Please try again.'}));
      if(!response.ok){const error=new Error(result.error||'This file part could not be uploaded.');error.retryable=response.status>=500;throw error;}uploaded=true;
     }catch(error){if(attempt===1||entry.controller.signal.aborted||error.retryable===false)throw error;}
    }
    entry.progress=Math.round(end/file.size*100);if(epoch===mediaEpoch)mediaChanged(key);
   }
   if(epoch!==mediaEpoch||data.user?.id!==owner)continue;
   await mediaAPI('complete',{id:prepared.id});entry.status='ready';entry.progress=100;
  }catch(err){entry.status='error';entry.error=err.name==='AbortError'?'Upload cancelled.':err.message;}
  if(epoch===mediaEpoch&&data.user?.id===owner)mediaChanged(key);
 }
}
function mediaHTML(items=[]){
 const files=items.filter(m=>/^[0-9a-f-]{36}$/i.test(m.id)&&['image','video'].includes(m.kind));if(!files.length)return '';
 return `<div class="media-gallery media-count-${files.length}">${files.map(m=>{const url='/api/media?action=file&id='+m.id,gif=m.content_type==='image/gif';return m.kind==='image'?`<button class="media-photo ${gif?'is-gif':''}" type="button" data-media-view="${m.id}" data-media-kind="${gif?'gif':'image'}" aria-label="Open ${gif?'GIF':'photo'}"><img src="${url}" alt="${gif?'Animated GIF':'Photo attachment'}" loading="lazy" decoding="async">${gif?'<span class="media-gif-label">GIF</span>':''}</button>`:`<div class="media-video"><video controls playsinline preload="metadata" src="${url}" data-media-id="${m.id}" aria-label="Video attachment"></video><button type="button" data-media-view="${m.id}" data-media-kind="video" class="media-expand" aria-label="Open video in large view">↗</button></div>`;}).join('')}</div>`;
}
function pauseMedia(root){root?.querySelectorAll('video').forEach(v=>v.pause());}
// Keep unchanged message elements in place so incoming messages do not restart a playing video.
function patchMediaLog(box,html){
 const template=document.createElement('template');template.innerHTML=html;
 const key=n=>n.nodeType===1&&(n.dataset.roomMessage||n.dataset.dmMessage),old=new Map([...box.children].map(n=>[key(n),n]).filter(([k])=>k));
 const incoming=[...template.content.childNodes],keys=new Set(incoming.map(key).filter(Boolean));
 for(const [k,n] of old)if(!keys.has(k)){pauseMedia(n);n.remove();old.delete(k);}
 let cursor=box.firstChild;
 for(const fresh of incoming){const prior=old.get(key(fresh)),node=prior&&prior.outerHTML===fresh.outerHTML?prior:cursor?.isEqualNode(fresh)?cursor:fresh;if(node===cursor)cursor=cursor.nextSibling;else box.insertBefore(node,cursor);}
 while(cursor){const next=cursor.nextSibling;pauseMedia(cursor.nodeType===1?cursor:null);cursor.remove();cursor=next;}
}
document.addEventListener('click',ev=>{
 const choose=ev.target.closest('[data-media-choose],[data-media-gif-choose]');if(choose){const form=choose.closest('form');if(typeof busy!=='undefined'&&busy||typeof roomBusy!=='undefined'&&roomBusy)return;form?.querySelector(choose.hasAttribute('data-media-gif-choose')?'[data-media-gif-only]':'[data-media-input]:not([data-media-gif-only])')?.click();}
 const remove=ev.target.closest('[data-media-remove]');if(remove){const key=remove.dataset.mediaDraft,files=mediaDrafts.get(key)||[],entry=files.find(f=>f.key===remove.dataset.mediaRemove);entry?.controller.abort();if(entry)URL.revokeObjectURL(entry.preview);mediaDrafts.set(key,files.filter(f=>f!==entry));mediaChanged(key);}
 if(ev.target.closest('[data-media-close]')||ev.target.id==='media-viewer-backdrop')closeMediaViewer();
 const view=ev.target.closest('[data-media-view]');if(view){const id=view.dataset.mediaView;if(!/^[0-9a-f-]{36}$/i.test(id))return;openMediaViewer(id,view.dataset.mediaKind==='video',view.dataset.mediaKind==='gif');}
});
document.addEventListener('change',ev=>{if(ev.target.matches('[data-media-input]'))chooseMedia(ev.target).catch(err=>toast(err.message));});
document.addEventListener('paste',ev=>{
 if(!ev.target.matches?.('#room-message-input')||!data.user||!data.mediaReady||typeof roomBusy!=='undefined'&&roomBusy)return;
 const files=[...(ev.clipboardData?.files||[])].filter(f=>mediaAccept.split(',').includes(f.type)||(!f.type||f.type==='application/octet-stream')&&/\.gif$/i.test(f.name));
 const input=ev.target.closest('form')?.querySelector('[data-media-input]:not([data-media-gif-only])');if(!files.length||!input)return;
 ev.preventDefault();chooseMedia(input,files).catch(err=>toast(err.message));
});
window.addEventListener('vyx-auth-changed',()=>syncMediaOwner(data.user?.id||null));

let mediaReturnFocus=null,mediaOldOverflow='';
function openMediaViewer(id,video,gif=false){
 const overlay=document.querySelector('#media-viewer-backdrop');if(!overlay)return;
 mediaReturnFocus=document.activeElement;mediaOldOverflow=document.body.style.overflow;pauseMedia(document.querySelector('#main-content'));pauseMedia(document.querySelector('#modal'));
 overlay.innerHTML=`<section class="media-lightbox" role="dialog" aria-modal="true" aria-labelledby="media-viewer-title"><h2 id="media-viewer-title" class="sr-only">${video?'Video':gif?'GIF':'Photo'}</h2><button type="button" data-media-close aria-label="Close media viewer">×</button>${video?`<video controls playsinline preload="metadata" src="/api/media?action=file&id=${id}" aria-label="Full video"></video>`:`<img src="/api/media?action=file&id=${id}" alt="${gif?'Full animated GIF':'Full photo'}">`}</section>`;
 overlay.hidden=false;document.querySelector('.app-shell').inert=true;document.querySelector('#sidebar').inert=true;document.querySelector('#modal-backdrop').inert=true;document.body.style.overflow='hidden';overlay.querySelector('button').focus();
}
function closeMediaViewer(){const overlay=document.querySelector('#media-viewer-backdrop');if(!overlay||overlay.hidden)return;pauseMedia(overlay);overlay.hidden=true;overlay.innerHTML='';const modal=document.querySelector('#modal-backdrop');modal.inert=false;const active=!modal.hidden;document.querySelector('.app-shell').inert=active;document.querySelector('#sidebar').inert=active;document.body.style.overflow=mediaOldOverflow;if(mediaReturnFocus?.isConnected)mediaReturnFocus.focus();}
document.addEventListener('keydown',ev=>{const overlay=document.querySelector('#media-viewer-backdrop');if(!overlay||overlay.hidden)return;if(ev.key==='Escape'){ev.preventDefault();ev.stopImmediatePropagation();closeMediaViewer();}if(ev.key==='Tab'){const items=[...overlay.querySelectorAll('button,video')],first=items[0],last=items.at(-1);if(ev.shiftKey&&document.activeElement===first){ev.preventDefault();last.focus();}else if(!ev.shiftKey&&document.activeElement===last){ev.preventDefault();first.focus();}}},true);
window.addEventListener('hashchange',closeMediaViewer);
