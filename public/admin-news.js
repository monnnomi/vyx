'use strict';
(()=>{
 const box=document.getElementById('admin-news');
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let busy=false;
 async function request(body){
  const r=await fetch('/api/news'+(body?'':'?admin=1'),{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  const d=await r.json();
  if(!r.ok){
   const known={'VYX member not found.':'Участник с таким ником VYX не найден.','Administrators already have publishing access.':'У администратора уже есть право публикации.'};
   throw Error(known[d.error]||window.VYXAdminRU.error(d.error));
  }
  return d;
 }
 async function load(message=''){
  const {authors}=await request();
  box.innerHTML=`<header><div><h2>Редакция новостей</h2><p>Вы публикуете от имени VYX. Приглашённые авторы публикуют под своим именем.</p></div><a class="primary" href="/#news">Перейти в новости ↗</a></header>
   <h3>Авторы</h3><form class="admin-news-add"><label>Ник участника в VYX<input name="handle" maxlength="100" placeholder="@ник" autocomplete="off" required></label><button class="secondary">Дать право публикации</button></form>
   <p role="status">${escape(message)}</p>
   ${authors.length?authors.map(a=>`<div class="admin-news-source"><b>${escape(a.name)}</b><span>@${escape(a.handle)}</span><button class="secondary" data-revoke="${escape(a.id)}" aria-label="Отозвать право публикации у ${escape(a.handle)}">Отозвать доступ</button></div>`).join(''):'<p>Приглашённых авторов пока нет.</p>'}`;
 }
 function error(message){
  const status=box.querySelector('[role=status]');
  if(status)status.textContent=message;
  else box.innerHTML=`<h2>Редакция новостей</h2><p role="status">${escape(message)}</p><button class="secondary" data-refresh-team>Повторить</button>`;
 }
 async function update(input,button){
  if(busy)return;
  busy=true;button.disabled=true;
  try{await request(input);await load(input.action==='author-grant'?'Право публикации выдано.':'Доступ отозван.');}
  catch(err){error(err.message);}
  finally{busy=false;button.disabled=false;}
 }
 box.addEventListener('submit',ev=>{ev.preventDefault();update({action:'author-grant',handle:new FormData(ev.target).get('handle')},ev.target.querySelector('button'));});
 box.addEventListener('click',ev=>{
  const button=ev.target.closest('button');if(!button)return;
  if(button.hasAttribute('data-refresh-team'))load().catch(err=>error(err.message));
  if(button.dataset.revoke)update({action:'author-revoke',id:button.dataset.revoke},button);
 });
 load().catch(err=>error(err.message));
})();
