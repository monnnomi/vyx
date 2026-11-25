'use strict';
let topicsState=null,topicState=null,topicsQuery='',topicBusy=false;
let topicRequest=0;
const topicId=()=>new URL(location.href).searchParams.get('topic');

async function loadTopics(append=false){
 const request=++topicRequest;
 const id=topicId();
 if(id){
  const previous=append&&topicState?.topic.id===id?topicState:null;
  const result=await api('topic',undefined,{id,offset:previous?.messages.length});
  if(request!==topicRequest)return;
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

function renderForumTopic(){
 const view=topicState;
 if(!view||view.topic.id!==topicId())return loadingPanel('Loading topic…');
 const {topic,messages,more}=view;
 const settings=topic.owner?`<details class="forum-giveaway"><summary>Manage your topic</summary>
  <form data-topic-action="topic-settings">${forumTopicFields(topic)}
  <label class="topic-checkbox"><input type="checkbox" name="repliesOpen" ${topic.replies_open?'checked':''}> Allow replies</label>
  <button class="secondary">Save settings</button></form></details>`:'';
 const composer=data.user&&(topic.owner||topic.replies_open)?`<section class="forum-giveaway">
  <form data-topic-action="topic-message"><label>${topic.owner?'Post an update':'Write a reply'}
  <textarea name="body" required maxlength="3500"></textarea></label>
  <button class="primary">${topic.owner?'Publish update':'Post reply'}</button></form></section>`:'';
 return `<div class="social-feed forum-giveaways topic-page">
  <a href="${forumTopicUrl(null)}" class="text-link">← All topics</a>
  <header class="forum-intro"><h1>${e(topic.title)}</h1><p>${e(topic.name)} · @${e(topic.handle)}</p>
  ${topic.description?`<p class="topic-text">${e(topic.description)}</p>`:''}
  ${!topic.replies_open?'<p>Replies are closed.</p>':''}</header>
  ${settings}${composer}
  ${!data.user&&topic.replies_open?'<button class="secondary" data-action="signin">Sign in with X to reply</button>':''}
  ${messages.map(message=>{
   const own=message.author_id===data.user?.id;
   return `<article class="forum-giveaway topic-message"><header class="forum-giveaway-meta">
    <div><strong>${e(message.name)}</strong> <span>@${e(message.handle)} · ${message.kind==='update'?'Update':'Reply'}</span></div>
    <time datetime="${e(message.created_at)}">${e(date(message.created_at))}</time></header>
    <p class="topic-text">${e(message.body)}</p>
    ${message.edited_at?'<small>Edited</small>':''}
    ${own?`<details><summary>Edit</summary><form data-topic-action="topic-message-edit" data-message-id="${e(message.id)}">
     <label>Message <textarea name="body" required maxlength="3500">${e(message.body)}</textarea></label><button class="secondary">Save edit</button></form></details>`:''}
    ${own||topic.owner?`<button class="text-link" data-topic-remove="${e(message.id)}">Remove ${message.kind==='update'?'update':'reply'}</button>`:''}
   </article>`;
  }).join('')||'<div class="state-panel"><h2>No messages yet</h2></div>'}
  ${more?'<button class="secondary" data-topics-more>Load older messages</button>':''}
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
 void performTopicAction(form.querySelector('button'),async()=>{
  const input=Object.fromEntries(new FormData(form));
  if(form.hasAttribute('data-topic-search'))topicsQuery=input.q.trim();
  else{
   const action=form.dataset.topicAction;
   const result=await api(action,{...input,topicId:topicId(),messageId:form.dataset.messageId,
    repliesOpen:input.repliesOpen==='on'});
   if(action==='topic-create')history.replaceState({},'',forumTopicUrl(result.id));
  }
  await loadTopics();
 });
});

document.addEventListener('click',event=>{
 const button=event.target.closest('[data-topic-remove],[data-topics-more]');
 if(!button)return;
 const messageId=button.dataset.topicRemove;
 if(messageId&&!confirm('Remove this message from the topic?'))return;
 void performTopicAction(button,async()=>{
  if(messageId)await api('topic-message-delete',{topicId:topicId(),messageId});
  await loadTopics(!messageId);
 });
});
