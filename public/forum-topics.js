'use strict';
let topicsState=null,topicState=null,topicsQuery='',topicBusy=false;
let topicRequest=0,topicReply=null,topicDraft="",topicScrollBottom=true,topicKeepAnchor=false;
const topicId=()=>new URL(location.href).searchParams.get('topic');

async function loadTopics(append=false){
 const request=++topicRequest;
 const id=topicId();
 if(id){
  const previous=append&&topicState?.topic.id===id?topicState:null;
  const result=await api('topic',undefined,{id,offset:previous?.messages.length});
  if(request!==topicRequest)return;
  if(topicState?.topic.id!==id){topicReply=null;topicDraft="";topicScrollBottom=true;}
  topicState=previous?{...result,messages:[...previous.messages,...result.messages]}:result;
 }else{
  const previous=append?topicsState:null;
  const result=await api('topics',undefined,{q:topicsQuery,offset:previous?.topics.length});
  if(request!==topicRequest)return;
  topicsState=previous?{...result,topics:[...previous.topics,...result.topics]}:result;
 }
}

function forumTopicUrl(id){
 const url=new URL(location.pathname,location.origin);
 if(id)url.searchParams.set('topic',id);
 url.hash='topics';
 return url.pathname+url.search+url.hash;
}

function forumTopicFields(topic={}){
 return `<label>Title <input name="title" required minlength="3" maxlength="90" value="${e(topic.title||'')}"></label>
  <label>Description <textarea name="description" maxlength="500">${e(topic.description||'')}</textarea></label>`;
}

function topicMessageHTML(message,topic){
 const own=message.author_id===data.user?.id;
 const canReply=Boolean(data.user&&(topic.owner||topic.replies_open));
 const attachments=message.media||[];
 const reactions=Array.isArray(message.reactions)?message.reactions:[];
 const quote=message.reply_id?`<button class="topic-quote" data-topic-jump="${e(message.reply_id)}"><strong>${e(message.reply_name)}</strong><span>${e(message.reply_body||'Attachment')}</span></button>`:'';
 const chips=reactions.map(r=>`<button type="button" class="topic-reaction" data-topic-react="${e(message.id)}" data-emoji="${e(r.emoji)}" aria-pressed="${Boolean(r.mine)}" ${data.user?'':'disabled'}>${e(r.emoji)} ${fmt(r.count)}</button>`).join('');
 return `<article id="topic-message-${e(message.id)}" class="topic-bubble ${own?'is-own':''}" tabindex="-1">
  ${avatar({name:message.name,avatar_url:message.avatar_url})}
  <div class="topic-bubble-content"><header><strong>${e(message.name)}</strong>
  <time datetime="${e(message.created_at)}">${e(date(message.created_at))}</time></header>
  ${quote}${attachments.length?mediaHTML(attachments):''}${message.body?`<p class="topic-text">${e(message.body)}</p>`:''}
  ${message.edited_at?'<small>Edited</small>':''}
  <div class="topic-message-actions">
   ${chips}
   ${data.user?`<details class="topic-reaction-picker"><summary aria-label="Add reaction" title="Add reaction">☺＋</summary><div class="topic-emoji-grid">${messageReactionOptions.map(([emoji,label])=>`<button type="button" data-topic-react="${e(message.id)}" data-emoji="${e(emoji)}" aria-label="${e(label)}" aria-pressed="${reactions.some(r=>r.emoji===emoji&&r.mine)}">${e(emoji)}</button>`).join('')}</div></details>`:''}
   ${canReply?`<button type="button" class="text-link" data-topic-reply="${e(message.id)}">Reply</button>`:''}
   ${data.curatedFeed&&data.user?.is_admin&&message.homepage_version?`<button type="button" class="text-link" data-blog-select="${e(message.id)}" data-blog-version="${e(message.homepage_version)}" data-blog-published="${Boolean(message.homepage_published)}">${message.homepage_published?'Remove from homepage':'Publish to homepage'}</button>`:''}
   ${own||topic.owner?`<details class="topic-message-menu"><summary aria-label="Message options">⋯</summary>
    ${own?`<form data-topic-action="topic-message-edit" data-message-id="${e(message.id)}">
     <label>Message <textarea name="body" ${attachments.length?'':'required'} maxlength="3500">${e(message.body)}</textarea></label><button class="secondary">Save edit</button></form>`:''}
    <button class="text-link" data-topic-remove="${e(message.id)}">Remove</button>
   </details>`:''}
  </div></div>
 </article>`;
}

function renderForumTopic(){
 const view=topicState;
 if(!view||view.topic.id!==topicId())return loadingPanel('Loading topic…');
 const {topic,messages,more}=view;
 const settings=topic.owner?`<details class="topic-settings"><summary>Manage topic</summary>
  <form data-topic-action="topic-settings">${forumTopicFields(topic)}
  <label class="topic-checkbox"><input type="checkbox" name="repliesOpen" ${topic.replies_open?'checked':''}> Allow replies</label>
  <button class="secondary">Save settings</button></form></details>`:'';
 const mediaKey='topic:'+topic.id;
 const composer=data.user&&(topic.owner||topic.replies_open)?`<form class="topic-composer" data-topic-action="topic-message" data-media-form="${mediaKey}">
  ${topicReply?`<div class="topic-reply-preview"><div><strong>Replying to ${e(topicReply.name)}</strong><span>${e(topicReply.body.slice(0,140)||'Attachment')}</span></div><button type="button" class="text-link" data-topic-cancel-reply aria-label="Cancel reply">×</button></div>`:''}
  <label class="sr-only" for="topic-compose-text">Message</label>
  <textarea id="topic-compose-text" name="body" rows="2" required maxlength="3500" placeholder="${topic.owner&&!topicReply?'Write an update…':'Write a reply…'}">${e(topicDraft)}</textarea>
  ${mediaDraftHTML(mediaKey)}
  ${mediaComposerHTML(mediaKey,'topic',topic.id)}
  <button type="submit" class="primary">Send</button></form>`:'';
 const lastScroll=document.querySelector('.topic-transcript');
 const prior=lastScroll?{top:lastScroll.scrollTop,height:lastScroll.scrollHeight}:null;
 requestAnimationFrame(()=>{
  const list=document.querySelector('.topic-transcript');
  if(!list)return;
  if(topicScrollBottom){list.scrollTop=list.scrollHeight;topicScrollBottom=false;}
  else if(prior)list.scrollTop=prior.top+(topicKeepAnchor?list.scrollHeight-prior.height:0);
  topicKeepAnchor=false;
 });
 return `<div class="social-feed topic-page topic-chat forum-giveaway">
  <header class="topic-chat-header">
   <a href="${forumTopicUrl(null)}" class="text-link">← All topics</a>
   <h1>${e(topic.title)}</h1><p>${e(topic.name)} · @${e(topic.handle)}</p>
   ${topic.description?`<details class="topic-about"><summary>About this topic</summary><p class="topic-text">${e(topic.description)}</p></details>`:''}
   ${settings}
  </header>
  <div class="topic-transcript" role="log" aria-label="Topic messages">
   ${more?'<button class="secondary" data-topics-more>Load older messages</button>':''}
   ${[...messages].reverse().map(message=>topicMessageHTML(message,topic)).join('')||'<div class="state-panel"><h2>No messages yet</h2></div>'}
  </div>
  ${!topic.replies_open?'<p class="topic-closed">Replies are closed.</p>':''}
  ${!data.user&&topic.replies_open?'<button class="secondary" data-action="signin">Sign in with X to reply</button>':''}
  ${composer}
 </div>`;
}

function renderTopics(){
 if(topicId())return renderForumTopic();
 const state=topicsState;
 const create=state&&data.user&&!state.ownId?`<details class="forum-giveaway"><summary>Create your topic</summary>
  <form data-topic-action="topic-create">${forumTopicFields()}<button class="primary">Create topic</button></form></details>`:'';
 return `<div class="social-feed forum-giveaways topic-page">
  <header class="forum-intro"><h1>Topics</h1><p>Follow a member’s crypto research or start a topic of your own.</p></header>
  ${state?.ownId?`<a class="text-link" href="${forumTopicUrl(state.ownId)}">Open your topic →</a>`:create}
  ${!data.user?'<button class="secondary" data-action="signin">Sign in with X</button>':''}
  <form class="topic-search" data-topic-search><label>Search topics <input type="search" name="q" maxlength="100" value="${e(topicsQuery)}" placeholder="Topic title or username"></label><button class="secondary">Search</button></form>
  ${!state?loadingPanel('Loading topics…'):state.topics.map(topic=>`<article class="forum-giveaway topic-directory-item">
   <h2><a href="${forumTopicUrl(topic.id)}">${e(topic.title)}</a></h2>
   <p>${e(topic.name)} · @${e(topic.handle)} · ${fmt(topic.message_count)} messages</p>
   ${topic.description?`<p class="topic-text">${e(topic.description)}</p>`:''}</article>`).join('')||'<div class="state-panel"><h2>No topics found</h2></div>'}
  ${state?.more?'<button class="secondary" data-topics-more>Show more topics</button>':''}
 </div>`;
}

async function performTopicAction(button,callback){
 if(topicBusy)return;
 topicBusy=true;
 button.disabled=true;
 try{await callback();if(page==='topics')render();}
 catch(error){toast(error.message);}
 finally{topicBusy=false;button.disabled=false;}
}

document.addEventListener('submit',event=>{
 const form=event.target;
 if(!form.matches('[data-topic-action],[data-topic-search]'))return;
 event.preventDefault();
 const button=form.querySelector('button[type=submit],button.primary,button.secondary');
 const sending=form.dataset.topicAction==='topic-message';
 if(topicBusy)return;
 if(sending)form.inert=true;
 void performTopicAction(button,async()=>{
  const input=Object.fromEntries(new FormData(form));
  if(form.hasAttribute('data-topic-search'))topicsQuery=input.q.trim();
  else{
   const action=form.dataset.topicAction;
   const id=topicId();
   const key=form.dataset.mediaForm;
   const replyTo=sending?topicReply?.id:undefined;
   const attachments=sending?mediaSendIds(key):undefined;
   const requestId=sending?mediaRequestId(key,JSON.stringify([input.body,replyTo]),attachments):undefined;
   const result=await api(action,{...input,topicId:id,messageId:form.dataset.messageId,replyTo,mediaIds:attachments,requestId,
    repliesOpen:input.repliesOpen==='on'});
   if(sending){
    clearMediaDraft(key);
    if(topicId()===id){topicReply=null;topicDraft='';topicScrollBottom=true;}
   }
   if(action==='topic-create')history.replaceState({},'',forumTopicUrl(result.id));
  }
  await loadTopics();
 }).finally(()=>{if(sending)form.inert=false;});
});

function nextTopicReactions(previous,emoji,enabled){
 const next=(Array.isArray(previous)?previous:[]).map(r=>{
  const mine=r.emoji===emoji&&enabled?true:r.mine&&r.emoji!==emoji&&!enabled;
  return {...r,mine,count:r.count+Number(mine)-Number(r.mine)};
 });
 if(enabled&&!next.some(r=>r.emoji===emoji))next.push({emoji,count:1,mine:true});
 return next.filter(r=>r.count>0);
}

document.addEventListener('input',event=>{
 if(event.target.id==='topic-compose-text')topicDraft=event.target.value;
});
document.addEventListener('click',event=>{
 const selection=event.target.closest('[data-blog-select]');
 if(selection){
  if(!data.user?.is_admin)return;
  void performTopicAction(selection,async()=>{
   const published=selection.dataset.blogPublished!=='true';
   const response=await fetch('/api/admin',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action:'blog-curation-select',messageId:selection.dataset.blogSelect,version:selection.dataset.blogVersion,published})});
   const result=await response.json();
   if(!response.ok)throw Error(result.error||'The homepage could not be updated.');
   if(page==='topics')await loadTopics();
   await refresh();
   toast(published?'Published to the homepage.':'Removed from the homepage.');
  });
  return;
 }
 const button=event.target.closest('[data-topic-remove],[data-topics-more],[data-topic-reply],[data-topic-cancel-reply],[data-topic-react],[data-topic-jump]');
 if(!button||page!=='topics')return;
 if(button.hasAttribute('data-topic-reply')||button.hasAttribute('data-topic-cancel-reply')){
  topicReply=topicState?.messages.find(m=>m.id===button.dataset.topicReply)||null;
  render();
  document.getElementById('topic-compose-text')?.focus({preventScroll:true});
  return;
 }
 if(button.dataset.topicJump){
  const message=document.getElementById('topic-message-'+button.dataset.topicJump);
  if(message){message.scrollIntoView({block:'center'});message.focus({preventScroll:true});}
  else toast('Load older messages to see this reply.');
  return;
 }
 const messageId=button.dataset.topicRemove;
 if(messageId&&!confirm('Remove this message from the topic?'))return;
 void performTopicAction(button,async()=>{
  if(button.dataset.topicReact){
   await api('topic-reaction',{topicId:topicId(),messageId:button.dataset.topicReact,emoji:button.dataset.emoji,
    enabled:button.getAttribute('aria-pressed')!=='true'});
   const message=topicState?.messages.find(m=>m.id===button.dataset.topicReact);
   if(message)message.reactions=nextTopicReactions(message.reactions,button.dataset.emoji,button.getAttribute('aria-pressed')!=='true');
   return;
  }
  if(messageId)await api('topic-message-delete',{topicId:topicId(),messageId});
  else if(topicId())topicKeepAnchor=true;
  await loadTopics(!messageId);
 });
});
