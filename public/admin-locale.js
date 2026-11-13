'use strict';
// Loaded only by /admin. Public UI, API values and original content stay unchanged.
window.VYXAdminRU=(()=>{
 const own=(map,key)=>Object.hasOwn(map,key)?map[key]:null;
 const number=n=>new Intl.NumberFormat('ru-RU').format(n||0);
 const money=cents=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'USD'}).format(Number(cents||0)/100);
 const date=(value,empty='Пока нет данных')=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('ru-RU',{timeZone:'UTC',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})+' UTC':empty;
 const statuses={pending:'В очереди',review:'На проверке',rejected:'Отклонено',published:'Опубликовано',withdrawn:'Снято с публикации',unchecked:'Ожидает отбора',selected:'Отобрано',open:'Открыто',resolved:'Решено',dismissed:'Отклонено',requested:'Заявка получена',reviewing:'Рассматривается',completed:'Завершено',cancelled:'Отменено',running:'Выполняется',paused:'Приостановлено',active:'Активно',ok:'Успешно',continuing:'Обработка продолжается','not-checked':'Ещё не проверялось','waiting-for-sources':'Ожидание источников','waiting-for-credentials':'Ожидание подключения X и ИИ','quest-priority':'Сначала проверяются задания участников','already-running':'Цикл уже выполняется','already-scanning':'Проверка уже выполняется','waiting-for-identities':'Ожидание проверки аккаунтов','identity-check-failed':'Не удалось проверить аккаунты','search-failed':'Ошибка поиска постов','daily-allowance-reached':'Дневной лимит исчерпан','daily-allowance-wait':'Ожидание сброса дневного лимита','allowance-or-paused':'Лимит исчерпан или работа приостановлена','allowance-wait':'Ожидание доступного бюджета','budget-window-wait':'Ожидание следующего окна бюджета','daily-publication-limit':'Дневной лимит публикаций достигнут','publication-window-wait':'Ожидание следующего окна публикаций','x-authentication-required':'Нужно обновить подключение X','x-credits-required':'Недостаточно кредитов X','x-access-denied':'X отклонил доступ','x-rate-limited':'X временно ограничил запросы','collection-error':'Ошибка сбора постов'};
 const status=value=>own(statuses,value)||(/^x-http-\d{3}$/.test(value)?({'401':'Нужно обновить подключение X','402':'Недостаточно кредитов X','403':'X отклонил доступ','429':'X временно ограничил запросы'}[value.slice(-3)]||'Ошибка X, код '+value.slice(-3)):'Неизвестный статус');
 const errors={
  'Sign in with your administrator X account.':'Войдите через аккаунт X с правами администратора.',
  'This account does not have administrator access.':'У этого аккаунта нет доступа к админке.',
  'Could not load the dashboard.':'Не удалось загрузить панель управления.',
  'Newsroom unavailable':'Редакция новостей временно недоступна.',
  'Something went wrong. Please try again.':'Не удалось выполнить запрос. Попробуйте ещё раз.',
  'Unauthorized.':'Требуется вход в аккаунт.',
  'Invalid filter.':'Выберите допустимый фильтр.',
  'Invalid page.':'Недопустимый номер страницы.',
  'Invalid item.':'Не удалось определить выбранный элемент.',
  'Method not allowed.':'Этот способ запроса не поддерживается.',
  'Please use the VYX website to make this request.':'Выполните действие на сайте VYX. При необходимости обновите страницу.',
  'Sign-in is being set up. Please try again later.':'Вход временно недоступен. Попробуйте позже.',
  'The community service is being set up. Please try again later.':'Сервис временно недоступен. Попробуйте позже.',
  'A little too fast. Please try again shortly.':'Слишком много запросов. Подождите немного и попробуйте снова.',
  'Please enter text.':'Введите текст.',
  'Send a JSON request.':'Не удалось отправить запрос. Обновите страницу и попробуйте ещё раз.',
  'This request is too large.':'Запрос слишком большой. Сократите введённые данные.',
  'This request could not be read.':'Не удалось прочитать запрос. Обновите страницу и повторите действие.',
  'Enter an X username or a profile link.':'Введите имя аккаунта X или ссылку на его профиль.',
  'Choose a daily allowance from $0 to $1.':'Укажите дневной лимит от 0 до 1 доллара.',
  'Add sources and connect X and the AI service before starting the newsroom.':'Перед запуском добавьте источники и подключите X и сервис ИИ.',
  'Add between 1 and 100 accounts.':'Добавьте от 1 до 100 аккаунтов.',
  'Up to 100 sources can be monitored.':'Можно отслеживать не больше 100 аккаунтов.',
  'Invalid source setting.':'Недопустимая настройка источника.',
  'Story not found.':'Новость не найдена.',
  'Only a complete, source-checked English draft can be published.':'Можно опубликовать только готовую английскую новость, которая прошла проверку по источнику.',
  'This story is not published.':'Эта новость не опубликована.',
  'This story cannot be retried.':'Для этой новости нельзя повторить проверку в текущем состоянии.',
  'Withdraw a published story first.':'Сначала снимите новость с публикации.',
  'Unknown newsroom action.':'Неизвестное действие редакции.',
  'Choose a request status.':'Выберите статус заявки.',
  'Complete data removal before marking the request completed. This dashboard only starts review.':'Сначала необходимо удалить данные. В этой панели можно только начать рассмотрение заявки.',
  'Report not found.':'Жалоба не найдена.',
  'Choose a review outcome.':'Выберите результат рассмотрения жалобы.',
  'This type requires manual review; no account or private conversation is deleted here.':'Этот тип жалобы требует отдельной проверки. Здесь нельзя удалять аккаунты или личную переписку.',
  'Newsroom automation paused.':'Автоматическая работа редакции приостановлена.',
  'Daily news allowance reached.':'Дневной лимит новостей исчерпан.',
  'Three-hour news allowance reached; waiting for the next window.':'Лимит текущего трёхчасового окна исчерпан. Ожидается следующее окно.',
  'Collection allowance reached; funds held for the writer.':'Сбор приостановлен: оставшиеся средства зарезервированы для подготовки новостей.'
 };
 function error(message){
  if(own(errors,message))return own(errors,message);
  const range=/^Please use (\d+)–(\d+) characters\.$/.exec(message||'');
  if(range)return `Введите от ${range[1]} до ${range[2]} символов.`;
  if(/fetch|network|load failed|connection/i.test(message||''))return 'Не удалось связаться с сервером. Проверьте подключение и попробуйте ещё раз.';
  if(/[А-Яа-яЁё]/.test(message||''))return message;
  return 'Не удалось выполнить действие. Обновите страницу и попробуйте ещё раз.';
 }
 const reasons={
  'Daily allowance reached or paused; retry later.':'Дневной лимит исчерпан или работа приостановлена. Проверка будет повторена позже.',
  'AI request timed out; retry scheduled.':'ИИ не ответил вовремя. Повторная попытка запланирована.',
  'Run time limit reached; retry scheduled.':'Время выполнения цикла истекло. Повторная попытка запланирована.',
  'AI returned an incomplete article or source check; retry scheduled.':'ИИ вернул неполную новость или результат проверки. Запланирована повторная попытка.',
  'Draft processing failed; retry scheduled.':'Не удалось подготовить черновик. Повторная попытка запланирована.',
  'Batch selection unavailable; retry scheduled.':'Пакетный отбор временно недоступен. Повторная попытка запланирована.',
  'Source update is older than 48 hours.':'Исходному посту больше 48 часов.',
  'Duplicate event':'Это событие уже было рассмотрено.',
  'Not a substantive news update':'В посте нет содержательной новости.'
 };
 const reason=value=>own(reasons,value)||(/^AI service returned HTTP \d{3}; retry scheduled\.$/.test(value)?'Сервис ИИ вернул ошибку '+value.match(/\d{3}/)[0]+'. Повторная попытка запланирована.':null);
 const reportReasons={'Spam or manipulation':'Спам или манипуляция','Harassment or abuse':'Травля или оскорбления','Unsafe or illegal content':'Опасный или незаконный контент',Impersonation:'Выдача себя за другого','Other concern':'Другая причина'};
 const kinds={post:'Пост',comment:'Комментарий','room-message':'Сообщение в комнате',room:'Комната',message:'Личное сообщение',user:'Участник',profile:'Профиль'};
 const events={search:'Поиск',search_result:'Результат поиска',profile_view:'Просмотр профиля',follow:'Подписка',post_started:'Начало создания поста',post_published:'Публикация поста',comment_sent:'Отправка комментария',room_open:'Открытие комнаты',room_join:'Вступление в комнату',message_sent:'Отправка сообщения',signin_started:'Начало входа',signin_returned:'Возврат после входа',onboarding_saved:'Сохранение знакомства с VYX',onboarding_skipped:'Пропуск знакомства с VYX',getting_started:'Первые шаги',visit_started:'Посещение сайта',visit_from_x:'Переход из X',signed_in_visit:'Посещение с выполненным входом',first_room_join:'Первое вступление в комнату',first_room_message:'Первое сообщение в комнате',first_vp_contribution:'Первый засчитанный вклад',return_next_day:'Возврат на следующий день',first_reward_seen:'Первый просмотр награды'};
 const outcomes={success:'Успешно',error:'Ошибка',ok:'Успешно',empty:'Нет результатов',found:'Найдено',none:'Без результата',accepted:'Засчитано',rejected:'Не засчитано',started:'Начато',completed:'Завершено',returned:'Возврат',sent:'Отправлено',joined:'Вступление',authenticated:'Вход выполнен',cancelled:'Отменено'};
 return Object.freeze({number,money,date,status,error,reason,reportReason:value=>own(reportReasons,value)||value,kind:value=>own(kinds,value)||'Другой тип',event:value=>own(events,value)||'Другое событие',outcome:value=>own(outcomes,value)||'Другое значение'});
})();
