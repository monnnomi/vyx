'use strict';
(()=>{
 const box=document.getElementById('admin-blog-curation');
 if(!box)return;
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let busy=false;
 async function request(input){
  const response=await fetch('/api/admin'+(input?'':'?action=blog-curation'),{
   method:input?'POST':'GET',credentials:'same-origin',cache:'no-store',
   headers:input?{'Content-Type':'application/json'}:{},body:input?JSON.stringify(input):undefined
  });
  const result=await response.json();
  if(!response.ok)throw Error(result.error||'Не удалось загрузить настройки куратора.');
  return result;
 }
 function render(settings,message=''){
  const expires=settings.expiresAt?new Date(settings.expiresAt).toLocaleString('ru-RU'):null;
  box.innerHTML=`<header><div><h2>Куратор главной ленты</h2>
   <p>Бот отбирает авторские записи из блогов. Порог качества — 75 из 100.</p></div></header>
   <p>${settings.configured?'Доступ FLOP настроен.':expires?'Доступ FLOP истёк. Нужен действующий ключ.':'Для автоматического отбора нужен API-доступ FLOP.'}${expires?' Срок ключа: '+escape(expires)+'.':''}</p>
   <p>Опубликовано: ${Number(settings.counts.published)} · Ожидают проверки: ${Number(settings.counts.waiting)} · Отклонено: ${Number(settings.counts.rejected)}</p>
   <form data-blog-curation-settings>
    <label><input name="enabled" type="checkbox" ${settings.enabled?'checked':''}> На главной публикует только бот</label>
    <label>Шлюз FLOP<input name="gateway" type="url" required value="${escape(settings.gateway)}" autocomplete="off"></label>
    <label>Модель<input name="model" required maxlength="160" value="${escape(settings.model)}" autocomplete="off"></label>
    <label>API-ключ FLOP<input name="apiKey" type="password" maxlength="4096" autocomplete="off" placeholder="${settings.configured?'Оставьте пустым, чтобы сохранить текущий ключ':'flop_…'}"></label>
    <p>При сохранении ключ проверяется через FLOP и шифруется на сервере.</p>
    <button class="primary" type="submit">Проверить и сохранить</button>
   </form><p role="status">${escape(message)}</p>`;
 }
 function showError(error){
  const status=box.querySelector('[role=status]');
  if(status)status.textContent=error.message;
  else box.innerHTML=`<h2>Куратор главной ленты</h2><p role="status">${escape(error.message)}</p><button class="secondary" data-blog-curation-retry>Повторить</button>`;
 }
 const load=()=>request().then(settings=>render(settings)).catch(showError);
 box.addEventListener('submit',async event=>{
  if(!event.target.matches('[data-blog-curation-settings]'))return;
  event.preventDefault();
  if(busy)return;
  busy=true;
  const button=event.target.querySelector('button'),fields=new FormData(event.target);
  button.disabled=true;
  try{
   const result=await request({action:'blog-curation-settings',enabled:fields.get('enabled')==='on',
    gateway:fields.get('gateway'),model:fields.get('model'),apiKey:fields.get('apiKey')});
   render(result,!result.enabled?'Куратор выключен. Обычная главная лента восстановлена.':result.configured?'Настройки сохранены. Бот продолжит отбор при следующем запуске.':'Главная закрыта для прямых публикаций. Отбор ожидает подключения FLOP.');
  }catch(error){showError(error);}
  finally{busy=false;button.disabled=false;}
 });
 box.addEventListener('click',event=>{if(event.target.closest('[data-blog-curation-retry]'))void load();});
 void load();
})();
