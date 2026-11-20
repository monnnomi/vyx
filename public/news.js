'use strict';
let newsCategory='all',newsRows=[],newsNext=null,newsStatus='loading',newsStory=null,newsEpoch=0,newsWriterId=null;
const newsLabels={all:'All stories',reviews:'Project reviews',updates:'Updates',ecosystem:'Ecosystem',events:'Events',security:'Security',markets:'Market views'};
function newsDate(value){return new Date(value).toLocaleString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});}
function newsURL(id){const u=new URL('/#news',location.origin);u.searchParams.set('story',id);return u.href;}
function newsSource(article){
 if(!article.source?.url)return '';
 if(article.manual)return `<a class="news-source" href="${e(article.source.url)}" target="_blank" rel="noopener noreferrer">View source ${icon('arrowup')}</a>`;
 return `<a class="news-source" href="${e(article.source.url)}" target="_blank" rel="noopener noreferrer">@${e(article.source.username)} on X ${icon('arrowup')}</a>`;}
function newsByline(article){
 if(article.manual&&article.publisher.handle)return `<span class="news-publisher"><span><b>${e(article.publisher.name)}</b><small>@${e(article.publisher.handle)}</small></span></span>`;
 return `<span class="news-publisher"><img src="/assets/vyx-mark-96-v1.png" width="28" height="28" alt=""><span><b>VYX</b><small>Newsroom</small></span></span>`;}
function newsKind(article){return article.kind==='market-view'?'Market view':newsLabels[article.category]||'Updates';}
function newsPhotoURL(image,small=false){const url=new URL(image.url,location.origin);if(url.hostname==='pbs.twimg.com')url.searchParams.set('name',small?'small':'large');return url.href;}
function newsPhotoImage(image,index,small=false){return `<img data-news-image src="${e(newsPhotoURL(image,small))}" alt="${e(image.alt||'Image '+(index+1)+' from the original X post')}" ${image.width&&image.height?`width="${image.width}" height="${image.height}"`:''} loading="lazy" decoding="async" referrerpolicy="no-referrer">`;}
function newsCover(article){const photo=article.media?.[0];return photo?`<div class="news-cover">${newsPhotoImage(photo,0,true)}${article.media.length>1?`<span class="news-image-count">${article.media.length} photos</span>`:''}</div>`:'';}
function newsPhotosHTML(article){return article.media?.length?`<div class="news-photos"><div class="news-photo-grid ${article.media.length===1?'is-single':''}">${article.media.map((image,i)=>`<figure class="news-photo"><a href="${e(image.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open original image ${i+1} of ${article.media.length}">${newsPhotoImage(image,i)}</a></figure>`).join('')}</div><p class="news-photo-credit">Images from the original post · ${newsSource(article)}</p></div>`:'';}
document.addEventListener('error',ev=>{const image=ev.target;if(image?.matches?.('img[data-news-image]')){const frame=image.closest('.news-cover,.news-photo');if(frame)frame.hidden=true;}},true);
function renderNews(){
 const header=`<header class="news-heading"><div><h1>News</h1><p>News and project reviews from VYX and community authors.</p></div><div class="news-heading-actions">${newsWriterId&&newsWriterId===data.user?.id?'<button class="primary" data-story-compose>Write a story</button>':''}<button class="icon-button" data-news-refresh aria-label="Refresh news">${icon('repeat')}</button><button class="icon-button mobile-app-more" data-social-more aria-label="More">${icon('more')}</button></div></header>`;
 if(newsStory)return `<section class="news-page">${header}<button class="text-link news-back" data-news-back>← All stories</button><article class="news-article" lang="en"><span class="news-category">${e(newsKind(newsStory))}</span><h2>${e(newsStory.title)}</h2><div class="news-article-byline">${newsByline(newsStory)}<div class="news-meta"><time datetime="${e(newsStory.publishedAt)}">${newsDate(newsStory.publishedAt)} · UTC</time>${newsStory.source?.url?`<span class="news-source-caption">Source: ${newsSource(newsStory)}</span>`:''}</div></div><p class="news-standfirst">${e(newsStory.summary)}</p>${newsPhotosHTML(newsStory)}${newsStory.highlights?.length?`<aside class="news-highlights" aria-label="Key points"><h3>At a glance</h3><ul>${newsStory.highlights.map(p=>`<li>${e(p)}</li>`).join('')}</ul></aside>`:''}${newsStory.paragraphs.map((p,i)=>`<section class="news-content-block">${newsStory.headings?.[i]?`<h3>${e(newsStory.headings[i])}</h3>`:''}<p>${e(p)}</p></section>`).join('')}${newsStory.kind==='market-view'?`<p class="news-market-note">This is the source author’s market view, not a confirmed outcome or a VYX trading recommendation.</p>`:''}<footer class="news-article-footer">${!newsStory.manual?'<span>AI-assisted brief · checked against the linked source. Source claims are attributed, not independently confirmed.</span>':''}${newsStory.canEdit?'<button class="secondary" data-story-edit>Edit story</button>':''}${newsStory.canWithdraw?'<button class="secondary" data-story-withdraw>Unpublish</button>':''}<button class="secondary" data-news-share="${newsStory.id}">Copy story link ${icon('arrowup')}</button></footer></article>${renderNewsComments()}</section>`;
 return `<section class="news-page">${header}<div class="news-filters" role="group" aria-label="News category">${Object.entries(newsLabels).map(([k,l])=>`<button data-news-category="${k}" aria-pressed="${newsCategory===k}">${l}</button>`).join('')}</div><div id="news-stories" aria-live="polite">${newsStatus==='loading'?loadingPanel('Gathering the latest stories…'):newsStatus==='error'?errorPanel('News could not be loaded.','data-news-refresh')+(new URL(location.href).searchParams.has('story')?'<button class="secondary" data-news-back>All stories</button>':''):newsRows.length?`<div class="news-grid">${newsRows.map((a,i)=>`<article class="news-card ${i===0?'news-card-lead':''}" lang="en"><div class="news-card-top"><span class="news-category">${e(newsKind(a))}</span><time datetime="${e(a.publishedAt)}">${newsDate(a.publishedAt)}</time></div><a class="news-story-link" href="${e(newsURL(a.id))}" data-news-open="${a.id}">${newsCover(a)}<h2>${e(a.title)}</h2><p>${e(a.summary)}</p><span class="news-read">Read story ${icon('arrow')}</span></a><footer>${newsByline(a)}${a.source?.url?`<span class="news-card-source">Source: ${newsSource(a)}</span>`:''}</footer>${newsCommentsLink(a)}</article>`).join('')}</div>${newsNext?'<button class="secondary news-more" data-news-more>More stories</button>':''}`:`<div class="news-empty"><span class="news-empty-mark" aria-hidden="true">${icon('news')}</span><h2>${newsCategory==='all'?'No stories yet':'No stories in this section yet.'}</h2><p>${newsCategory==='all'?'Published stories will appear here.':'Try another topic or come back for the next update.'}</p><button class="secondary" data-news-refresh>Check for updates ${icon('repeat')}</button></div>`}</div><p class="news-fineprint">Reading news does not earn VP.</p></section>`;
}
async function loadNews(append=false){
 const owner=data.user?.id||null,epoch=++newsEpoch,category=newsCategory,id=new URL(location.href).searchParams.get('story');
 if(!append){newsStatus='loading';newsStory=null;newsWriterId=null;}
 try{
  const u=new URL('/api/news',location.origin);u.searchParams.set('category',category);if(id)u.searchParams.set('id',id);else if(append&&newsNext)u.searchParams.set('before',newsNext);
  const r=await fetch(u.href,{credentials:'same-origin'}),d=await r.json();if(!r.ok)throw Error(d.error||'News unavailable');
  if(epoch!==newsEpoch||owner!==(data.user?.id||null))return;
  newsWriterId=d.canPublish?owner:null;
  newsStory=d.article||null;if(!id){newsRows=append?[...new Map([...newsRows,...d.articles].map(a=>[a.id,a])).values()]:d.articles;newsNext=d.next;}newsStatus='ready';if(newsStory)await loadNewsComments();
 }catch(err){if(epoch!==newsEpoch)return;newsStatus='error';}
}
function newsSetStory(id){const u=new URL(location.href);if(id)u.searchParams.set('story',id);else u.searchParams.delete('story');history.replaceState(null,'',u);}
document.addEventListener('click',async ev=>{
 const open=ev.target.closest('[data-news-open]'),b=ev.target.closest('button');
 if(open){ev.preventDefault();newsSetStory(open.dataset.newsOpen);await loadNews();if(page==='news')render();return;}
 if(!b)return;
 if(b.hasAttribute('data-story-compose')&&newsWriterId===data.user?.id){newsComposer();return;}
 if(b.hasAttribute('data-story-edit')&&newsStory?.canEdit){newsComposer(newsStory);return;}
 if(b.hasAttribute('data-story-withdraw')&&newsStory?.canWithdraw){
  showModal(`<h2 id="modal-title">Unpublish this story?</h2><p class="modal-subtitle">${e(newsStory.title)}</p><form data-story-form="story-withdraw" data-id="${newsStory.id}" data-owner="${e(data.user.id)}"><p>Readers will lose access to the story and its discussion.</p><p role="alert"></p><button type="button" class="secondary" data-action="close">Cancel</button> <button class="primary">Unpublish</button></form>`);
  return;
 }
 const category=b.dataset.newsCategory;
 if(category){newsCategory=Object.hasOwn(newsLabels,category)?category:'all';newsSetStory(null);}
 if(b.hasAttribute('data-news-back'))newsSetStory(null);
 if(b.dataset.newsShare){try{await navigator.clipboard.writeText(newsURL(b.dataset.newsShare));toast('Story link copied.');}catch{toast('Copy the story URL from your browser.');}return;}
 if(category||['data-news-refresh','data-news-more','data-news-back'].some(k=>b.hasAttribute(k))){const pending=loadNews(b.hasAttribute('data-news-more'));if(page==='news')render();await pending;if(page==='news')render();}
});

function newsComposer(story=null){
 if(!data.user)return;
 const options=Object.entries(newsLabels).filter(([key])=>key!=='all').map(([key,label])=>`<option value="${key}" ${key===(story?.category||'reviews')?'selected':''}>${label}</option>`).join('');
 showModal(`<h2 id="modal-title">${story?'Edit story':'Write a story'}</h2><p class="modal-subtitle">Write in English. Separate paragraphs with a blank line.</p>
  <form class="news-compose" data-story-form="${story?'story-edit':'story-create'}" data-id="${story?.id||crypto.randomUUID()}" data-owner="${e(data.user.id)}">
   <label>Headline<input name="title" maxlength="150" value="${e(story?.title||'')}" required></label>
   <label>Category<select name="category">${options}</select></label>
   <label>Short summary<textarea name="summary" rows="2" maxlength="450" required>${e(story?.summary||'')}</textarea></label>
   <label>Article<textarea name="body" rows="7" maxlength="8000" required>${e(story?.paragraphs.join('\n\n')||'')}</textarea></label>
   <label>Source link (optional)<input type="url" name="source" placeholder="https://" maxlength="1500" value="${e(story?.source?.url||'')}"></label>
   <p role="alert"></p><div><button type="button" class="secondary" data-action="close">Cancel</button> <button type="submit" class="primary">${story?'Save changes':'Publish story'}</button></div>
  </form>`);
}
document.addEventListener('submit',async ev=>{
 const form=ev.target.closest('[data-story-form]');if(!form)return;
 ev.preventDefault();
 if(!data.user||form.dataset.owner!==data.user.id||form.getAttribute('aria-busy')==='true')return;
 const action=form.dataset.storyForm;
 form.setAttribute('aria-busy','true');const submit=form.querySelector('button.primary');submit.disabled=true;
 try{
  const input={...Object.fromEntries(new FormData(form)),action,id:form.dataset.id};
  const r=await fetch('/api/news',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
  const result=await r.json();if(!r.ok)throw Error(result.error||'Story could not be saved.');
  if(form.dataset.owner!==data.user?.id)return;
  if(form.isConnected)closeModal();
  if(page==='news'){newsSetStory(action==='story-withdraw'?null:result.id);await loadNews();render();}
 }catch(err){form.querySelector('[role=alert]').textContent=err.message;}
 finally{form.removeAttribute('aria-busy');submit.disabled=false;}
});
