'use strict';
let newsCommentRows=[],newsCommentNext=null,newsCommentTotal=0,newsCommentStatus='idle',newsCommentStory=null,newsCommentOwner=null,newsCommentEpoch=0,newsCommentBusy=false,newsCommentEdit=null;
const newsCommentDrafts=new Map();
const newsCommentKey=(id,edit='new',owner=data.user?.id)=>`${owner||'guest'}:${id}:${edit}`;
function newsCommentsLink(a){return `<div class="news-card-discussion"><button class="text-link" data-news-comments="${e(a.id)}" aria-label="Comments (${Number(a.comments)||0})">${icon('comment')}<span>${fmt(a.comments||0)} comments</span>${icon('arrow')}</button></div>`;}
function newsCommentForm(id,comment=null){
 const key=newsCommentKey(id,comment?.id),draft=newsCommentDrafts.get(key)?.body??comment?.body??'';
 return `<form class="news-comment-form ${comment?'is-edit':''}" data-news-comment-form data-news-id="${e(id)}" ${comment?`data-comment-id="${e(comment.id)}"`:''}><label for="news-comment-${comment?.id||'new'}">${comment?'Edit your comment':'Join the conversation'}</label><textarea id="news-comment-${comment?.id||'new'}" name="body" rows="3" maxlength="2000" placeholder="Add to the conversation…" required ${newsCommentBusy?'disabled':''}>${e(draft)}</textarea><div class="news-comment-form-actions"><span>Keep it thoughtful.</span>${comment?'<button type="button" class="secondary" data-news-comment-cancel '+(newsCommentBusy?'disabled':'')+'>Cancel</button>':''}<button class="primary" type="submit" ${newsCommentBusy?'disabled':''}>${newsCommentBusy?'Saving…':comment?'Save changes':'Post comment'} ${icon('send')}</button></div></form>`;
}
function newsCommentHTML(c){return `<article class="news-comment" id="news-comment-row-${c.id}"><button class="icon-button news-comment-avatar" data-person="${c.author.id}" aria-label="Profile ${e(c.author.name)}">${avatar(c.author)}</button><div class="news-comment-content"><div class="news-comment-byline"><button class="text-link" data-person="${c.author.id}">${e(c.author.name)}</button><span>@${e(c.author.handle)}</span></div>${newsCommentEdit===c.id?newsCommentForm(newsCommentStory,c):`<p class="news-comment-body" dir="auto">${e(c.body)}</p>`}<div class="news-comment-meta"><time datetime="${e(c.createdAt)}">${date(c.createdAt)}</time>${c.editedAt?'<span>Edited</span>':''}${c.canEdit?`<button class="text-link" data-news-comment-edit="${c.id}" ${newsCommentBusy?'disabled':''}>Edit</button>`:''}${c.canDelete?`<button class="text-link danger-text" data-news-comment-delete="${c.id}" ${newsCommentBusy?'disabled':''}>Delete</button>`:''}</div></div></article>`;}
function renderNewsComments(){
 const current=newsCommentStory===newsStory?.id&&newsCommentOwner===(data.user?.id||null),ready=current&&newsCommentStatus==='ready';
 return `<section class="news-discussion" id="news-comments" aria-labelledby="news-comments-heading"><header class="news-discussion-heading"><div><span class="eyebrow">YOUR PERSPECTIVE</span><h2 id="news-comments-heading">Comments <span>${fmt(ready?newsCommentTotal:newsStory?.comments||0)}</span></h2></div><button class="icon-button" data-news-comment-refresh aria-label="Refresh comments" ${newsCommentBusy?'disabled':''}>${icon('repeat')}</button></header>${ready?`${newsCommentNext?'<button class="text-link news-earlier-comments" data-news-comment-more '+(newsCommentBusy?'disabled':'')+'>Earlier comments ↑</button>':''}<div class="news-comment-list">${newsCommentRows.length?newsCommentRows.map(newsCommentHTML).join(''):'<p class="news-comment-empty">No comments yet. Be the first to share a thought.</p>'}</div>`:current&&newsCommentStatus==='loading'?loadingPanel('Loading comments…'):errorPanel('Comments could not be loaded.','data-news-comment-refresh')}${data.user?newsCommentForm(newsStory.id):'<div class="news-comment-signin"><p>Sign in with X to add your perspective.</p><button class="primary" data-action="signin">Join the conversation</button></div>'}</section>`;
}
function renderNewsDiscussion(){
 if(page!=='news'||!newsStory)return;
 const section=document.getElementById('news-comments');if(!section)return;
 const focus=section.contains(document.activeElement)&&document.activeElement.tagName==='TEXTAREA'?{id:document.activeElement.id,start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd}:null;
 section.outerHTML=renderNewsComments();if(focus){const field=document.getElementById(focus.id);field?.focus({preventScroll:true});field?.setSelectionRange(focus.start,focus.end);}
}
async function loadNewsComments(append=false){
 const id=newsStory?.id,owner=data.user?.id||null,epoch=++newsCommentEpoch;if(!id)return;
 if(newsCommentStory!==id||newsCommentOwner!==owner){newsCommentRows=[];newsCommentNext=null;newsCommentEdit=null;}
 newsCommentStory=id;newsCommentOwner=owner;newsCommentStatus='loading';
 try{
  const u=new URL('/api/news',location.origin);u.searchParams.set('action','comments');u.searchParams.set('id',id);if(append&&newsCommentNext)u.searchParams.set('before',newsCommentNext);
  const r=await fetch(u.href,{credentials:'same-origin'}),result=await r.json();if(!r.ok)throw Error(result.error);
  if(epoch!==newsCommentEpoch||id!==newsStory?.id||owner!==(data.user?.id||null))return;
  newsCommentRows=append?[...new Map([...result.comments,...newsCommentRows].map(c=>[c.id,c])).values()]:result.comments;
  newsCommentNext=result.next;newsCommentTotal=result.total;newsCommentStatus='ready';newsSetCommentCount(id,result.total);
 }catch(error){if(epoch===newsCommentEpoch&&id===newsStory?.id&&owner===(data.user?.id||null))newsCommentStatus='error';}
}
function newsSetCommentCount(id,total){if(newsStory?.id===id)newsStory.comments=total;const card=newsRows.find(a=>a.id===id);if(card)card.comments=total;}
async function sendNewsComment(input){
 const r=await fetch('/api/news',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
 const result=await r.json().catch(()=>({error:'The service could not be reached. Please try again.'}));if(!r.ok)throw Error(result.error||'Your comment could not be saved.');return result;
}
document.addEventListener('input',ev=>{
 const form=ev.target.closest('[data-news-comment-form]');if(!form||ev.target.name!=='body')return;
 newsCommentDrafts.set(newsCommentKey(form.dataset.newsId,form.dataset.commentId),{body:ev.target.value});
});
document.addEventListener('click',async ev=>{
 const button=ev.target.closest('button');if(!button)return;
 if(button.dataset.newsComments){
  newsSetStory(button.dataset.newsComments);const pending=loadNews();if(page==='news')render();await pending;if(page==='news'){render();document.getElementById('news-comments')?.scrollIntoView({behavior:'smooth',block:'start'});}return;
 }
 if(!newsStory||newsCommentBusy)return;
 if(button.hasAttribute('data-news-comment-refresh')||button.hasAttribute('data-news-comment-more')){
  const pending=loadNewsComments(button.hasAttribute('data-news-comment-more'));renderNewsDiscussion();await pending;renderNewsDiscussion();return;
 }
 const c=newsCommentRows.find(c=>c.id===(button.dataset.newsCommentEdit||button.dataset.newsCommentDelete));
 if(button.dataset.newsCommentEdit&&c?.canEdit){newsCommentEdit=c.id;renderNewsDiscussion();document.getElementById('news-comment-'+c.id)?.focus();}
 if(button.hasAttribute('data-news-comment-cancel')){newsCommentDrafts.delete(newsCommentKey(newsStory.id,newsCommentEdit));newsCommentEdit=null;renderNewsDiscussion();}
 if(button.dataset.newsCommentDelete&&c?.canDelete)showModal(`<h2 id="modal-title">Delete this comment?</h2><p class="modal-subtitle">It will be removed from this conversation.</p><form data-news-comment-delete-form data-news-id="${newsStory.id}" data-comment-id="${c.id}"><div class="news-comment-confirm"><button type="button" class="secondary" data-action="close">Cancel</button><button class="primary" type="submit">Delete comment</button></div></form>`);
});
document.addEventListener('submit',async ev=>{
 const form=ev.target.closest('[data-news-comment-form],[data-news-comment-delete-form]');if(!form)return;ev.preventDefault();
 if(!requireUser()||newsCommentBusy)return;
 const id=form.dataset.newsId,commentId=form.dataset.commentId,owner=data.user.id,isDelete=form.hasAttribute('data-news-comment-delete-form'),key=newsCommentKey(id,commentId,owner),body=isDelete?null:form.elements.body.value;
 if(!isDelete&&!body.trim()){toast('Write a comment first.');return;}
 const draft=newsCommentDrafts.get(key);const requestId=draft?.body===body&&draft.requestId?draft.requestId:crypto.randomUUID();
 if(!isDelete)newsCommentDrafts.set(key,{body,requestId});
 newsCommentBusy=true;for(const b of form.querySelectorAll('button'))b.disabled=true;renderNewsDiscussion();
 try{
  const result=await sendNewsComment({action:isDelete?'comment-delete':commentId?'comment-edit':'comment-add',newsId:id,id:commentId,body,requestId});
  if(owner!==data.user?.id)return;
  newsCommentDrafts.delete(key);
  if(isDelete&&form.isConnected)closeModal();
  if(newsStory?.id===id&&newsCommentOwner===owner){
   if(isDelete){newsCommentRows=newsCommentRows.filter(c=>c.id!==commentId);newsCommentTotal=Math.max(0,newsCommentTotal-1);newsSetCommentCount(id,newsCommentTotal);if(newsCommentEdit===commentId)newsCommentEdit=null;}
   else if(commentId){const c=newsCommentRows.find(c=>c.id===commentId);if(c){c.body=body.trim();c.editedAt=result.editedAt;}newsCommentEdit=null;}
   else await loadNewsComments();
  }
  toast(isDelete?'Comment deleted.':commentId?'Comment updated.':'Comment added.');
 }catch(error){toast(error.message);}
 finally{newsCommentBusy=false;for(const b of form.querySelectorAll('button'))b.disabled=false;renderNewsDiscussion();}
});
