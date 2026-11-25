'use strict';
let forumGiveaways=null;
let giveawayBusy=false;

async function loadGiveaways(append=false){
 const next=await api('giveaways',undefined,{cursor:append?forumGiveaways.posts.at(-1)?.created_at:null});
 forumGiveaways=append?{
  posts:[...forumGiveaways.posts,...next.posts],results:[...forumGiveaways.results,...next.results],more:next.posts.length===30
 }:{...next,more:next.posts.length===30};
}

function renderGiveaways(){
 const g=forumGiveaways;
 const cards=g?.posts.map(post=>{
  const result=g.results.find(row=>row.post_id===post.id);
  return `<section class="forum-giveaway">
   <div class="forum-giveaway-meta"><strong>${post.audience==='bloggers'?'For VYX bloggers':'For forum members'}</strong>
   <span>${result?'Drawn':'Open'}</span></div>
   ${postHTML(post)}
   ${result?`<div class="forum-draw-result"><strong>Winner · ${e(result.winner_name)}</strong><span>${fmt(result.eligible_count)} eligible participants</span></div>`:
    `<div class="forum-draw-result"><span>Reply to enter. One entry per member.</span>${data.user?.is_admin?`<button class="secondary" data-giveaway-draw="${e(post.id)}">Draw winner</button>`:''}</div>`}
  </section>`;
 }).join('');
 return `<div class="social-feed forum-giveaways">
  <header class="forum-intro"><h1>Giveaways</h1><p>Small giveaways for forum members and people who write on VYX.</p></header>
  ${data.user?.is_admin?`<details class="forum-giveaway"><summary>Create giveaway</summary><form data-giveaway-create>
   <label>Who can enter <select name="audience"><option value="members">Forum members</option><option value="bloggers">Members with a blog post</option></select></label>
   <label>Prize and rules <textarea name="body" minlength="20" maxlength="1470" required placeholder="Describe the prize, deadline and delivery."></textarea></label>
   <button class="primary">Publish giveaway</button></form></details>`:''}
  ${!g?loadingPanel('Loading giveaways…'):cards||'<div class="state-panel"><h2>No giveaways yet</h2><p>New giveaways will appear here.</p></div>'}
  ${g?.more?'<button class="secondary" data-giveaway-more>Show more</button>':''}
 </div>`;
}

document.addEventListener('submit',async event=>{
 const form=event.target;
 if(!form.matches('[data-giveaway-create]')||giveawayBusy)return;
 event.preventDefault();
 const {audience,body}=Object.fromEntries(new FormData(form));
 if(!['members','bloggers'].includes(audience)||body.trim().length<20)return;
 giveawayBusy=true;
 try{
  if(await write('post',{body:`[giveaway:${audience}] ${body.trim()}`})){
   await loadGiveaways();
   if(page==='giveaways')render();
   toast('Giveaway published.');
  }
 }catch(error){toast(error.message);}
 finally{giveawayBusy=false;}
});

document.addEventListener('click',async event=>{
 const button=event.target.closest('[data-giveaway-draw],[data-giveaway-more]');
 if(!button||giveawayBusy)return;
 if(button.dataset.giveawayDraw&&!confirm('Draw and publish one winner from eligible replies now?'))return;
 giveawayBusy=true;
 button.disabled=true;
 try{
  if(button.dataset.giveawayDraw)await api('giveaway-draw',{id:button.dataset.giveawayDraw});
  await loadGiveaways(button.hasAttribute('data-giveaway-more'));
  if(page==='giveaways')render();
 }catch(error){toast(error.message);}
 finally{giveawayBusy=false;button.disabled=false;}
});
