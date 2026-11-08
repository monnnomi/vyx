'use strict';
let whitelistData=null,whitelistFilter='all',whitelistPage=1,whitelistState='loading',whitelistRequest=0;
function communityRankingsNav(selected){return `<nav class="community-rankings-nav" aria-label="Community lists"><a href="#leaderboard" ${selected==='leaderboard'?'aria-current="page"':''}>${icon('trophy')} Leaderboard</a><a href="#whitelist" ${selected==='whitelist'?'aria-current="page"':''}>${icon('check')} Whitelist</a></nav>`;}
async function loadWhitelist({quiet=false}={}){
 const request=++whitelistRequest,tier=whitelistFilter,listPage=whitelistPage;
 if(!quiet)whitelistState='loading';
 try{
  const result=await api('whitelist',undefined,{tier,page:listPage});
  if(request!==whitelistRequest)return;
  whitelistData=result;whitelistState='ready';
  if(result.pagination.page>result.pagination.pages){whitelistPage=result.pagination.pages;return loadWhitelist({quiet});}
 }catch{if(request===whitelistRequest)whitelistState='error';}
}
function whitelistOwnStatus(){
 if(!data.user)return `<div class="whitelist-personal"><div><strong>Where do you stand?</strong><p>Connect with X to see your private eligibility progress.</p></div><button class="secondary" data-action="signin">Check my status ${icon('arrow')}</button></div>`;
 const mine=nftSelectionOwner===data.user.id&&nftSelectionState==='ready'?nftSelectionData:null;
 const copy=mine?.tier==='free'?['You’re on the Free NFT list.','Both selection requirements are complete.']:mine?.tier==='half-price'?['Your 50% off place is ready.','Keep inviting your people to qualify for a free NFT.']:mine?['Your place is still ahead.','Your profile shows exactly what is left to qualify.']:['Your place in the community.','View your private eligibility progress in your profile.'];
 return `<div class="whitelist-personal"><div><strong>${copy[0]}</strong><p>${copy[1]}</p></div><button class="secondary" data-action="profile">My progress ${icon('arrow')}</button></div>`;
}
function renderWhitelist(){
 const current=whitelistData,counts=current?.counts,loading=whitelistState==='loading';
 return `<section class="whitelist-page">${communityRankingsNav('whitelist')}<header class="product-heading whitelist-heading"><div><span class="eyebrow">A PLACE IN THE NEXT CHAPTER</span><h1>The whitelist.</h1><p>Good conversations. Real contributions.<br>A little closer to the VYX NFT collection.</p></div><button class="icon-button" data-whitelist-refresh aria-label="Refresh whitelist" ${loading?'disabled':''}>${icon('repeat')}</button></header><div class="whitelist-editions"><article class="whitelist-edition"><span class="whitelist-edition-icon">${icon('spark')}</span><span class="eyebrow">BOTH REQUIREMENTS MET</span><h2>Free NFT</h2><p>50,000+ confirmed VP<br>and 3 registered referrals.</p><strong>${counts?fmt(counts.free):'—'} <small>${counts?.free===1?'member':'members'}</small></strong></article><article class="whitelist-edition"><span class="whitelist-edition-icon">${icon('check')}</span><span class="eyebrow">THE FIRST MILESTONE</span><h2>50% off</h2><p>50,000+ confirmed VP.<br>Your contribution earns a head start.</p><strong>${counts?fmt(counts.halfPrice):'—'} <small>${counts?.halfPrice===1?'member':'members'}</small></strong></article></div>${whitelistOwnStatus()}<div class="whitelist-list-heading"><h2>Meet the list</h2><div class="whitelist-filters" role="group" aria-label="Whitelist filter">${[['all','All'],['free','Free NFT'],['half-price','50% off']].map(([id,label])=>`<button data-whitelist-filter="${id}" aria-pressed="${id===whitelistFilter}">${label}</button>`).join('')}</div></div>${loading?loadingPanel('Checking the whitelist…'):whitelistState==='error'?errorPanel('The whitelist could not be loaded.','data-whitelist-refresh'):current?.members.length?`<div class="whitelist-members" role="list" aria-label="Qualified members">${current.members.map(p=>`<div role="listitem"><button class="whitelist-member ${p.id===data.user?.id?'is-you':''}" data-person="${e(p.id)}">${avatar(p)}<span class="whitelist-member-name"><strong>${e(p.name)}${p.id===data.user?.id?'<small class="whitelist-you">You</small>':''}</strong><small>${compactHandle(p.handle)}</small></span><span class="whitelist-badge ${p.tier==='free'?'is-free':''}">${p.tier==='free'?'Free NFT':'50% off'}</span>${icon('arrow')}</button></div>`).join('')}</div>`:`<div class="state-panel"><h2>${whitelistFilter==='free'?'The first free places are waiting.':whitelistFilter==='half-price'?'No discounted places yet.':'The list starts with your contribution.'}</h2><p>Members appear automatically when they meet the criteria.</p><button class="secondary" data-action="${data.user?'profile':'signin'}">${data.user?'See my progress':'Connect with X'}</button></div>`}${current&&current.pagination.pages>1&&!loading&&whitelistState!=='error'?`<nav class="whitelist-pagination" aria-label="Whitelist pages"><button class="secondary" data-whitelist-page="${whitelistPage-1}" ${whitelistPage<=1?'disabled':''}>Previous</button><span>Page ${whitelistPage} of ${current.pagination.pages}</span><button class="secondary" data-whitelist-page="${whitelistPage+1}" ${whitelistPage>=current.pagination.pages?'disabled':''}>Next</button></nav>`:''}<p class="product-note whitelist-note">Lists update automatically from confirmed lifetime VP and registered referrals. Your place moves from 50% off to Free NFT when both requirements are met. Detailed progress stays private. NFT minting is not open yet; this page shows current eligibility.</p></section>`;
}
document.addEventListener('click',async ev=>{
 const b=ev.target.closest('[data-whitelist-filter],[data-whitelist-page],[data-whitelist-refresh]');if(!b||page!=='whitelist')return;
 if(b.dataset.whitelistFilter){whitelistFilter=b.dataset.whitelistFilter;whitelistPage=1;whitelistData=null;}
 if(b.dataset.whitelistPage)whitelistPage=Number(b.dataset.whitelistPage);
 const pending=loadWhitelist();render();await pending;if(page==='whitelist')render();
});
setInterval(async()=>{
 if(page!=='whitelist'||document.hidden||whitelistState==='loading'||!$('#modal-backdrop').hidden)return;
 await Promise.all([loadWhitelist({quiet:true}),data.user?loadNftSelection():Promise.resolve()]);
 if(page==='whitelist')render();
},60000);
