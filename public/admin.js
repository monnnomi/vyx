(()=>{
 const $=s=>document.querySelector(s),e=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=n=>new Intl.NumberFormat('en-US').format(n||0);
 const date=s=>s?new Date(s).toLocaleString('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
 let page=1,pages=1,busy=false,allowed=false,lastData=null,refreshPending=false;
 function nftCell(n){
  if(!n)return '—';
  const label={'free':'Free NFT','half-price':'50% off','full-price':'Full price'}[n.tier];
  return `<span class="admin-nft-status ${e(n.tier)}">${label}</span><small>${fmt(n.confirmedVP)} / 50,000 VP · ${fmt(n.invitedReferrals)} / 3 referrals</small><small>${n.tier==='free'?'All requirements met':`${n.vpRemaining?fmt(n.vpRemaining)+' VP remaining':'VP requirement met'} · ${n.referralsRemaining?fmt(n.referralsRemaining)+' referrals to free NFT':'Referral requirement met'}`}</small>`;
 }
 function draw(d){
  lastData=d;pages=d.pagination.pages;
  $('#admin-identity').textContent='@'+d.admin.x_username;
  const cards=[['Online now',d.counts.online,`${fmt(d.counts.online_members)} members · ${fmt(d.counts.online_guests)} guests`],['X accounts connected',d.counts.connected,`${fmt(d.counts.connected_today)} joined today (UTC)`],['Halloween mints',d.counts.minted,`${fmt(d.counts.minted_today)} minted today (UTC)`],['Not minted yet',d.counts.not_minted,'Connected accounts without this collectible']];
  $('#admin-metrics').innerHTML=cards.map(([label,value,note],i)=>`<article class="admin-metric"><span>${i===0?'<i class="admin-live"></i>':''}${label}</span><strong>${fmt(value)}</strong><small>${note}</small></article>`).join('');
  const active=Date.parse(d.counts.server_now)<Date.parse(d.event.endsAt)&&Date.parse(d.counts.server_now)>=Date.parse(d.event.startsAt);
  $('#admin-event').innerHTML=`<img src="/assets/halloween-chest-2026.png" alt="Halloween collectible chest"><div><div class="eyebrow">HALLOWEEN 2026</div><h2>A collectible. No points attached.</h2><p>One mint per X account · closes ${date(d.event.endsAt)} UTC</p></div><span class="admin-badge ${active?'open':''}">${active?'MINT OPEN':'MINT CLOSED'}</span>`;
  $('#admin-users').innerHTML=d.users.length?d.users.map(u=>`<tr><td><div class="admin-person"><span class="admin-avatar">${u.avatar_url?`<img src="${e(u.avatar_url)}" alt="" referrerpolicy="no-referrer">`:e(u.name.slice(0,1))}</span><span><strong>${e(u.name)}</strong><small>@${e(u.handle)}</small></span></div></td><td class="admin-nft-cell">${nftCell(u.nftSelection)}</td><td><a class="admin-x-link" href="https://x.com/${encodeURIComponent(u.x_username)}" target="_blank" rel="noopener">@${e(u.x_username)} ↗</a><small>ID ${e(u.x_id)}</small></td><td>${date(u.created_at)}<small>Last login ${date(u.last_login_at)} · ${fmt(u.login_count)} total</small></td><td>${u.online?'<span class="admin-online">Online now</span>':date(u.last_seen_at)}<small>${u.online?'Active within 90 seconds':'Last visible activity'}</small></td><td><span class="admin-badge ${u.mint_id?'minted':''}">${u.mint_id?'Minted ✓':'Not minted'}</span>${u.minted_at?`<small>${date(u.minted_at)}</small>`:''}</td><td>${u.mint_id?`<span class="admin-receipt" title="${e(u.mint_id)}">${e(u.mint_id.slice(0,8))}…${e(u.mint_id.slice(-6))}</span>`:'—'}</td></tr>`).join(''):'<tr><td class="admin-empty" colspan="7">No accounts match these filters.</td></tr>';
  $('#admin-updated').textContent='Updated '+new Date(d.counts.server_now).toLocaleTimeString('en-GB',{timeZone:'UTC'})+' UTC';
  $('#admin-results').textContent=fmt(d.pagination.total)+' matching accounts';$('#admin-page').textContent=`${d.pagination.page} / ${d.pagination.pages}`;
  $('#admin-prev').disabled=page<=1;$('#admin-next').disabled=page>=pages;
 }
 async function refresh(){
  if(busy){refreshPending=true;return;}busy=true;$('#admin-refresh').disabled=true;
  try{
   const query=new URLSearchParams({page,q:$('#admin-query').value,filter:$('#admin-filter').value});
   const res=await fetch('/api/admin?'+query,{credentials:'same-origin',cache:'no-store'}),d=await res.json();
   if(res.status===401||res.status===403){allowed=false;$('#admin-dashboard').hidden=true;$('#admin-identity').textContent='';$('#admin-status').innerHTML=res.status===401?'<h2>Administrator sign-in</h2><p>Use the X account assigned to this dashboard.</p><a class="primary" href="/api/auth/x?returnTo=%2Fadmin">Continue with X ↗</a>':'<h2>Access restricted</h2><p>This X account does not have administrator access.</p><a class="primary" href="/">Return to VYX</a>';return;}
   if(!res.ok)throw new Error(d.error||'Could not load the dashboard.');
   allowed=true;$('#admin-status').textContent='';$('#admin-dashboard').hidden=false;draw(d);
   const farmingResponse=await fetch('/api/admin?action=farming',{credentials:'same-origin',cache:'no-store'}),farming=await farmingResponse.json();
   if(farmingResponse.ok)$('#admin-farming').innerHTML=adminFarmingHTML(farming);
  }catch(err){$('#admin-status').textContent=err.message;$('#admin-status').classList.add('admin-status-error');}
  finally{busy=false;$('#admin-refresh').disabled=false;if(refreshPending){refreshPending=false;refresh();}}
 }
 $('#admin-refresh').addEventListener('click',refresh);
 $('#admin-search').addEventListener('submit',ev=>{ev.preventDefault();page=1;refresh();});
 $('#admin-filter').addEventListener('change',()=>{page=1;refresh();});
 $('#admin-query').addEventListener('input',()=>{if(!$('#admin-query').value){page=1;refresh();}});
 $('#admin-prev').addEventListener('click',()=>{if(page>1){page--;refresh();}});$('#admin-next').addEventListener('click',()=>{if(page<pages){page++;refresh();}});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&allowed)refresh();});
 setInterval(()=>{if(!document.hidden&&allowed)refresh();},15000);
 const url=new URL(location.href);if(url.searchParams.has('auth')){url.searchParams.delete('auth');history.replaceState({},'',url.pathname+url.search);}
 refresh();
})();
