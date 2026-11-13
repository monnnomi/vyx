(()=>{
 const $=s=>document.querySelector(s),e=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const ru=window.VYXAdminRU,fmt=ru.number,date=s=>ru.date(s,'—');
 let page=1,pages=1,busy=false,allowed=false,refreshPending=false;
 function nftCell(n){
  if(!n)return '—';
  const label={'free':'Бесплатный NFT','half-price':'Скидка 50%','full-price':'Полная стоимость'}[n.tier];
  return `<span class="admin-nft-status ${e(n.tier)}">${label}</span><small>${fmt(n.confirmedVP)} / 50 000 VP · Приглашено: ${fmt(n.invitedReferrals)} / 3</small><small>${n.tier==='free'?'Все условия выполнены':`${n.vpRemaining?'Не хватает VP: '+fmt(n.vpRemaining):'Условие по VP выполнено'} · ${n.referralsRemaining?'До бесплатного NFT нужно приглашений: '+fmt(n.referralsRemaining):'Условие по приглашениям выполнено'}`}</small>`;
 }
 function draw(d){
  pages=d.pagination.pages;
  $('#admin-identity').textContent='@'+d.admin.x_username;
  const cards=[['Сейчас онлайн',d.counts.online,`Участники: ${fmt(d.counts.online_members)} · Гости: ${fmt(d.counts.online_guests)}`],['Подключено аккаунтов X',d.counts.connected,`Подключились сегодня (UTC): ${fmt(d.counts.connected_today)}`],['Минты Halloween',d.counts.minted,`Сминтили сегодня (UTC): ${fmt(d.counts.minted_today)}`],['Ещё не сминтили',d.counts.not_minted,'Подключённые аккаунты без этого коллекционного сундука']];
  $('#admin-metrics').innerHTML=cards.map(([label,value,note],i)=>`<article class="admin-metric"><span>${i===0?'<i class="admin-live"></i>':''}${label}</span><strong>${fmt(value)}</strong><small>${note}</small></article>`).join('');
  const active=Date.parse(d.counts.server_now)<Date.parse(d.event.endsAt)&&Date.parse(d.counts.server_now)>=Date.parse(d.event.startsAt);
  $('#admin-event').innerHTML=`<img src="/assets/halloween-chest-2026.png" alt="Коллекционный сундук Halloween"><div><div class="eyebrow">HALLOWEEN 2026</div><h2>Коллекционный сундук без поинтов.</h2><p>Один минт на аккаунт X · Закрытие: ${date(d.event.endsAt)}</p></div><span class="admin-badge ${active?'open':''}">${active?'МИНТ ОТКРЫТ':'МИНТ ЗАКРЫТ'}</span>`;
  $('#admin-users').innerHTML=d.users.length?d.users.map(u=>`<tr><td><div class="admin-person"><span class="admin-avatar">${u.avatar_url?`<img src="${e(u.avatar_url)}" alt="" referrerpolicy="no-referrer">`:e(u.name.slice(0,1))}</span><span><strong>${e(u.name)}</strong><small>@${e(u.handle)}</small></span></div></td><td class="admin-nft-cell">${nftCell(u.nftSelection)}</td><td><a class="admin-x-link" href="https://x.com/${encodeURIComponent(u.x_username)}" target="_blank" rel="noopener">@${e(u.x_username)} ↗</a><small>ID ${e(u.x_id)}</small></td><td>${date(u.created_at)}<small>Последний вход: ${date(u.last_login_at)} · Всего входов: ${fmt(u.login_count)}</small></td><td>${u.online?'<span class="admin-online">Сейчас онлайн</span>':date(u.last_seen_at)}<small>${u.online?'Активность за последние 90 секунд':'Последняя активность на видимой странице'}</small></td><td><span class="admin-badge ${u.mint_id?'minted':''}">${u.mint_id?'Сминтил ✓':'Не сминтил'}</span>${u.minted_at?`<small>${date(u.minted_at)}</small>`:''}</td><td>${u.mint_id?`<span class="admin-receipt" title="${e(u.mint_id)}">${e(u.mint_id.slice(0,8))}…${e(u.mint_id.slice(-6))}</span>`:'—'}</td></tr>`).join(''):'<tr><td class="admin-empty" colspan="7">По выбранным фильтрам аккаунтов не найдено.</td></tr>';
  $('#admin-updated').textContent='Обновлено: '+new Date(d.counts.server_now).toLocaleTimeString('ru-RU',{timeZone:'UTC'})+' UTC';
  $('#admin-results').textContent='Найдено аккаунтов: '+fmt(d.pagination.total);$('#admin-page').textContent=`${d.pagination.page} / ${d.pagination.pages}`;
  $('#admin-prev').disabled=page<=1;$('#admin-next').disabled=page>=pages;
 }
 async function refresh(){
  if(busy){refreshPending=true;return;}busy=true;$('#admin-refresh').disabled=true;
  try{
   const query=new URLSearchParams({page,q:$('#admin-query').value,filter:$('#admin-filter').value});
   const res=await fetch('/api/admin?'+query,{credentials:'same-origin',cache:'no-store'}),d=await res.json();
   if(res.status===401||res.status===403){allowed=false;$('#admin-dashboard').hidden=true;$('#admin-identity').textContent='';$('#admin-status').innerHTML=res.status===401?'<h2>Вход для администратора</h2><p>Используйте аккаунт X, которому выдан доступ к этой панели.</p><a class="primary" href="/api/auth/x?returnTo=%2Fadmin">Войти через X ↗</a>':'<h2>Доступ ограничен</h2><p>У этого аккаунта X нет прав администратора.</p><a class="primary" href="/">Вернуться в VYX</a>';return;}
   if(!res.ok)throw new Error(d.error||'Could not load the dashboard.');
   allowed=true;$('#admin-status').textContent='';$('#admin-status').classList.remove('admin-status-error');$('#admin-dashboard').hidden=false;draw(d);
   const farmingResponse=await fetch('/api/admin?action=farming',{credentials:'same-origin',cache:'no-store'}),farming=await farmingResponse.json();
   if(farmingResponse.ok)$('#admin-farming').innerHTML=adminFarmingHTML(farming);
   else $('#admin-farming').innerHTML=`<p role="status">${e(ru.error(farming.error))}</p>`;
  }catch(err){$('#admin-status').textContent=ru.error(err.message);$('#admin-status').classList.add('admin-status-error');}
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
