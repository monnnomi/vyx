'use strict';
// /admin → «Раздача jVYX»: frozen season shares, Merkle batches and the owner's on-chain steps.
(()=>{
 const box=document.getElementById('admin-tokens');if(!box)return;
 const ru=window.VYXAdminRU,num=ru.number,date=s=>ru.date(s,'—');
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const unit=10n**18n;
 const tokens=wei=>{const v=BigInt(wei||0),whole=new Intl.NumberFormat('ru-RU').format(v/unit),cents=(v%unit)*100n/unit;return cents?`${whole},${String(cents).padStart(2,'0')}`:whole;};
 const short=a=>a?a.slice(0,6)+'…'+a.slice(-4):'—';
 const every=s=>s===86400?'раз в сутки':s===0?'сразу':s%86400===0?`раз в ${num(s/86400)} дн.`:s%3600===0?`раз в ${num(s/3600)} ч`:`раз в ${num(s)} с`;
 const plan=p=>p.tranches===1?'всё сразу':`${num(p.tranches)} частей, ${every(p.intervalSeconds)}`;
 const errors={
  'Unknown token season.':'Неизвестный сезон jVYX.',
  'Freeze this season before creating a batch.':'Партию можно создать только после заморозки долей сезона.',
  'No members with a linked wallet are waiting for this season.':'В этом сезоне нет участников с кошельком, которые ждут партию.',
  'Choose a valid unlock start.':'Укажите корректную дату начала разлочки.',
  'Tranches must be 1 to 365.':'Число частей разлочки — от 1 до 365.',
  'Choose a valid unlock interval.':'Укажите корректный интервал разлочки.',
  'Batch not found.':'Партия не найдена.',
  'Only an inactive batch can be discarded.':'Удалить можно только партию, которая ещё не активна.',
  'This batch is already in the distributor. Check the chain to activate it instead.':'Эта партия уже добавлена в контракт, удалять её нельзя. Нажмите «Проверить сеть сейчас», чтобы активировать её.',
  'Could not reach Robinhood Chain. Try again.':'Не удалось связаться с Robinhood Chain. Попробуйте ещё раз.',
  'Unknown token action.':'Неизвестное действие раздачи.'
 };
 const error=m=>errors[m]||ru.error(m);
 let data=null,busy=false;
 function logLine(line,labels){
  let m=/^Froze (\S+): (\d+) members, (\d+) of (\d+) jVYX\.$/.exec(line);
  if(m)return `Доли «${labels[m[1]]||m[1]}» заморожены: участников ${num(m[2])}, ${num(m[3])} из ${num(m[4])} jVYX.`;
  if((m=/^Batch (\d+) is live as on-chain season (\d+)\.$/.exec(line)))return `Партия №${m[1]} активна — сезон ${m[2]} в контракте.`;
  if((m=/^Batch (\d+) matches season (\d+) by root/.exec(line)))return `Партия №${m[1]} совпадает с сезоном ${m[2]} по корню, но не по сумме или графику. Проверьте команды addSeason.`;
  return line;
 }
 function seasonState(s){
  if(s.frozen)return ['minted','Доли заморожены '+date(s.frozenAt)];
  if(!s.closed)return ['open',`Идёт до ${date(s.closesAt)}`];
  return ['',`Закрыт ${date(s.closesAt)} · заморозка в течение 5 минут`];
 }
 function seasonCard(s){
  const [cls,label]=seasonState(s);
  const form=s.frozen&&s.waiting?`<form class="admin-token-form" data-token-batch="${esc(s.key)}">${s.schedule?`<p>Новая партия получит график первой: старт ${date(s.schedule.startsAt)}, ${plan(s.schedule)}.</p>`:`<label>Начало разлочки, UTC<input type="datetime-local" name="startsAt" step="60"></label><p>Пусто — разлочка начнётся сразу. ${plan(data.unlock)}.</p>`}<button class="primary">Создать партию · участников: ${num(s.waiting)}</button></form>`:'';
  return `<article class="admin-metric admin-token-season"><span>${esc(s.label)}</span><strong>${tokens(s.frozen?s.allocated:s.pool)} <small>${s.frozen?'из '+tokens(s.pool)+' jVYX':'jVYX в пуле'}</small></strong><span class="admin-badge ${cls}">${label}</span>
   ${s.frozen?`<small>Участников с долей: ${num(s.members)} · основа ${num(s.basisVP)} VP<br>С кошельком: ${num(s.withWallet)} · без кошелька: ${num(s.needsWallet)}<br>В партиях: ${num(s.batched)} · доступно к клейму: ${num(s.live)} (${tokens(s.liveAmount)} jVYX)<br>Ждут партию: ${num(s.waiting)}</small>`:`<small>${s.kind==='early'?'Половина поровну, половина по VP — для участников, зарегистрированных до снимка.':'Пропорционально VP этого сезона.'}</small>`}
   ${form}</article>`;
 }
 function batchRow(b){
  const live=Boolean(b.activatedAt);
  const steps=b.steps.map((st,i)=>`<li>${i?'Владелец раздачи добавляет сезон':'Казна переводит токены в распределитель'}<pre>${esc(st.command)}</pre></li>`).join('');
  return `<tr><td>№${b.id}<small>${date(b.createdAt)}</small></td><td>${esc(b.label)}</td><td>${num(b.members)}</td><td>${tokens(b.total)} jVYX</td><td>${date(b.startsAt)}<small>${plan(b)}</small></td>
   <td>${live?`<span class="admin-badge minted">Активна · сезон ${num(b.onchainId)}</span><small>${date(b.activatedAt)}</small>`:'<span class="admin-badge open">Ждёт addSeason</span>'}<small title="${esc(b.root)}">Корень ${esc(short(b.root))}</small></td>
   <td>${live?'—':`<details><summary>Команды для владельца</summary><ol class="admin-token-steps">${steps}</ol><p>После подтверждения транзакций партия включится автоматически в течение 5 минут или по кнопке «Проверить сеть сейчас».</p></details><button class="secondary" data-token-discard="${b.id}">Удалить партию</button>`}</td></tr>`;
 }
 const statusLabel={live:'Доступно к клейму','batched':'В партии, ждёт контракт',waiting:'Ждёт партию','needs-wallet':'Нет кошелька'};
 function draw(message=''){
  const d=data,ex=d.chain.explorer,link=(a,t)=>a?`<a class="admin-x-link" href="${esc(ex)}/address/${esc(a)}" target="_blank" rel="noopener noreferrer"><code class="admin-wallet">${esc(short(a))}</code> ${t} ↗</a>`:'';
  box.innerHTML=`<header><div><div class="eyebrow">VYX JUNIOR · ${esc(d.chain.name.toUpperCase())}</div><h2>Раздача jVYX</h2><p>Доли сезона замораживаются автоматически после закрытия и больше не пересчитываются. Сбор за клейм — 0,00002 ETH. Участник видит токены в профиле, когда его партия добавлена в контракт.</p><p class="admin-token-links">${link(d.contracts?.token,'токен')} ${link(d.contracts?.distributor,'распределитель')}</p></div><div class="admin-news-controls"><button class="secondary" data-token-refresh>Обновить</button><button class="primary" data-token-sync>Проверить сеть сейчас</button></div></header>
   <p role="status" class="admin-token-status">${esc(message)}</p>
   <div class="admin-metrics admin-token-seasons">${d.seasons.map(seasonCard).join('')}</div>
   <h3>Партии</h3>${d.batches.length?`<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Партия</th><th>Сезон</th><th>Кошельков</th><th>Сумма</th><th>Разлочка</th><th>Статус</th><th>Действия</th></tr></thead><tbody>${d.batches.map(batchRow).join('')}</tbody></table></div>`:'<p>Партий пока нет. Создайте первую, когда сезон заморожен и есть участники с кошельком.</p>'}
   ${d.seasons.filter(s=>s.top.length).map(s=>`<details class="admin-token-top"><summary>Крупнейшие доли · ${esc(s.label)} (до 20)</summary><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Участник</th><th>Основа, VP</th><th>Доля, jVYX</th><th>Статус</th></tr></thead><tbody>${s.top.map(t=>`<tr><td>${esc(t.name)}<small>@${esc(t.x_username||t.handle)}</small></td><td>${num(t.basis_vp)}</td><td>${tokens(t.amount)}</td><td>${statusLabel[t.status]||esc(t.status)}</td></tr>`).join('')}</tbody></table></div></details>`).join('')}
   <p class="admin-note">Обновлено: ${date(d.serverNow)}. Удалить можно только партию, которую ещё не добавили в контракт: перед удалением сервер проверяет сеть.</p>`;
 }
 async function request(body){
  const r=await fetch('/api/admin'+(body?'':'?action=tokens'),{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  const d=await r.json();if(!r.ok)throw new Error(d.error);return d;
 }
 async function load(message=''){
  try{data=await request();draw(message);}
  catch(err){if(data)draw(error(err.message));else box.innerHTML=`<header><div><h2>Раздача jVYX</h2></div></header><p role="status" class="admin-token-status">${esc(error(err.message))}</p><button class="secondary" data-token-refresh>Повторить</button>`;}
 }
 async function act(input,button,done){
  if(busy)return;busy=true;if(button)button.disabled=true;
  try{const r=await request(input);await load(done(r));}
  catch(err){const s=box.querySelector('.admin-token-status');if(s)s.textContent=error(err.message);if(button)button.disabled=false;}
  finally{busy=false;}
 }
 box.addEventListener('click',ev=>{
  const b=ev.target.closest('button');if(!b)return;
  if(b.hasAttribute('data-token-refresh')){load();return;}
  if(b.hasAttribute('data-token-sync')){b.textContent='Проверяем сеть…';act({action:'token-sync'},b,r=>{const labels=Object.fromEntries(data.seasons.map(s=>[s.key,s.label]));return r.log.length?r.log.map(l=>logLine(l,labels)).join(' '):'Изменений нет: новых закрытых сезонов и добавленных в контракт партий не найдено.';});return;}
  if(b.dataset.tokenDiscard){
   if(!confirm(`Удалить партию №${b.dataset.tokenDiscard}? Её участники вернутся в очередь. Сервер откажет, если партию уже добавили в контракт.`))return;
   act({action:'token-discard',id:Number(b.dataset.tokenDiscard)},b,()=>`Партия №${b.dataset.tokenDiscard} удалена. Её участники снова ждут партию.`);
  }
 });
 box.addEventListener('submit',ev=>{
  const f=ev.target;if(!f.dataset.tokenBatch)return;ev.preventDefault();
  const v=f.elements.startsAt?.value,input={action:'token-batch',season:f.dataset.tokenBatch};
  if(v)input.startsAt=v+(v.length===16?':00':'')+'Z';
  const label=data.seasons.find(s=>s.key===f.dataset.tokenBatch)?.label||'';
  if(!confirm(`Создать партию «${label}»? После этого владелец переводит токены в распределитель и вызывает addSeason.`))return;
  act(input,f.querySelector('button'),r=>`Партия №${r.id} создана · кошельков: ${num(r.members)} · ${tokens(r.total)} jVYX. Выполните команды для владельца в таблице партий.`);
 });
 load();
})();
