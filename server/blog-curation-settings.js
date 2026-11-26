import {fail,text} from './http.js';
import {requireAdmin} from './admin.js';
import {sealTaskToken as sealCredential,openTaskToken as openCredential} from './x-task-access.js';

export async function migrateBlogCurationSettings(db){
 await db.q(`CREATE TABLE IF NOT EXISTS blog_curation_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK(id), enabled boolean NOT NULL DEFAULT true,
  gateway_url text NOT NULL DEFAULT 'https://gateway.testnet.flop.network/v1',
  model text NOT NULL DEFAULT 'qwen/qwen3-14b', sealed_key text, key_expires_at timestamptz,
  version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now()
 )`);
 await db.q('INSERT INTO blog_curation_settings(id,enabled) VALUES(true,$1) ON CONFLICT(id) DO NOTHING',
  [process.env.VYX_CURATED_FEED!=='0']);
}

export async function storedBlogSettings(db){
 if(!db)return null;
 const [schema]=await db.q("SELECT to_regclass('public.blog_curation_settings') IS NOT NULL AS available");
 if(!schema?.available)return null;
 const [row]=await db.q('SELECT * FROM blog_curation_settings WHERE id=true');
 return row||null;
}

export async function curatedFeedEnabled(db){
 const settings=await storedBlogSettings(db);
 return settings?settings.enabled:process.env.VYX_CURATED_FEED==='1';
}

export function blogGatewayCredential(settings){
 if(settings?.sealed_key)return {
  apiKey:openCredential(settings.sealed_key,'blog-curation:'+settings.gateway_url),
  model:settings.model,gateway:settings.gateway_url
 };
 return {apiKey:process.env.FLOP_API_KEY,model:process.env.VYX_BLOG_MODEL,
  gateway:process.env.FLOP_GATEWAY_URL||'https://gateway.testnet.flop.network/v1'};
}

export async function blogCurationAdmin(db,user){
 requireAdmin(user);
 const settings=await storedBlogSettings(db);
 if(!settings)fail(503,'Настройки куратора ожидают обновления базы.');
 const [counts]=await db.q(`SELECT
  count(*) FILTER(WHERE c.status='approved' AND c.reviewed_body=m.body
   AND c.reviewed_edit IS NOT DISTINCT FROM m.edited_at)::integer AS published,
  count(*) FILTER(WHERE c.status='rejected')::integer AS rejected,
  count(*) FILTER(WHERE c.message_id IS NULL OR c.status IN ('reviewing','retry') OR
   c.reviewed_body<>m.body OR c.reviewed_edit IS DISTINCT FROM m.edited_at)::integer AS waiting,
  max(c.checked_at) AS checked_at
  FROM forum_topic_messages m JOIN forum_topics t ON t.id=m.topic_id
  LEFT JOIN blog_curations c ON c.message_id=m.id WHERE m.kind='update' AND m.author_id=t.owner_id`);
 return {enabled:settings.enabled,gateway:settings.gateway_url,model:settings.model,
  configured:Boolean(settings.sealed_key||process.env.FLOP_API_KEY)&&
   (!settings.key_expires_at||new Date(settings.key_expires_at)>new Date()),expiresAt:settings.key_expires_at,counts};
}

export async function saveBlogCurationSettings(db,user,input,fetcher=fetch){
 requireAdmin(user);
 if(typeof input.enabled!=='boolean')fail(400,'Выберите режим главной ленты.');
 const settings=await storedBlogSettings(db);
 if(!settings)fail(503,'Настройки куратора ожидают обновления базы.');
 const model=text(input.model,1,160);
 let gateway;
 try{gateway=new URL(input.gateway);}catch{fail(400,'Укажите адрес шлюза FLOP.');}
 if(gateway.protocol!=='https:'||!['api.flop.network','gateway.testnet.flop.network'].includes(gateway.hostname)||
  gateway.username||gateway.password||gateway.search||gateway.hash)fail(400,'Используйте официальный HTTPS-шлюз FLOP.');
 gateway.pathname=gateway.pathname.replace(/\/+$/,'').replace(/\/v1$/,'')+'/v1';
 const gatewayURL=gateway.href;
 const replacement=input.apiKey==null?'':text(input.apiKey,0,4096);
 if(replacement&&(!replacement.startsWith('flop_')||/\s/.test(replacement)))fail(400,'Проверьте API-ключ FLOP.');
 if(!replacement&&settings.sealed_key&&gatewayURL!==settings.gateway_url)fail(400,'Для другого шлюза укажите соответствующий API-ключ.');
 const prior=blogGatewayCredential(settings);
 const apiKey=replacement||prior.apiKey;
 let sealed=settings.sealed_key,expires=settings.key_expires_at;
 const verify=input.enabled||replacement||gatewayURL!==settings.gateway_url||model!==settings.model;
 if(apiKey&&verify){
  let status,catalog;
  try{
   const headers={Authorization:'Bearer '+apiKey};
   const keyResponse=await fetcher(gatewayURL+'/keys/me',{headers,redirect:'error',signal:AbortSignal.timeout(30000)});
   if(!keyResponse.ok)fail(409,'Шлюз FLOP не подтвердил доступ по этому ключу.');
   status=await keyResponse.json();
   const modelsResponse=await fetcher(gatewayURL+'/models',{redirect:'error',signal:AbortSignal.timeout(30000)});
   if(!modelsResponse.ok)fail(503,'Каталог моделей FLOP временно недоступен.');
   catalog=await modelsResponse.json();
  }catch(error){if(error.status)throw error;fail(503,'Не удалось связаться со шлюзом FLOP. Повторите проверку позже.');}
  if(!Number.isFinite(status.remaining_quota)||status.remaining_quota<=0)fail(409,'У ключа FLOP закончился доступный лимит.');
  if(status.expires_at!=null&&(!Number.isFinite(status.expires_at)||status.expires_at<=Date.now()))fail(409,'Срок действия ключа FLOP закончился.');
  if(status.model&&status.model!==model)fail(409,'Этот ключ FLOP выдан для другой модели.');
  if(!Array.isArray(status.model_allowlist)||!status.model_allowlist.every(item=>typeof item==='string')||
   !status.model_allowlist.some(item=>item.toLowerCase()===model.toLowerCase()))fail(409,'Ключ FLOP не разрешает выбранную модель.');
  if(!Array.isArray(catalog.data)||!catalog.data.some(item=>item.id===model))fail(409,'Указанной модели сейчас нет в каталоге этого шлюза.');
  sealed=sealCredential(apiKey,'blog-curation:'+gatewayURL);
  expires=status.expires_at==null?null:new Date(status.expires_at).toISOString();
 }
 const saved=await db.q(`UPDATE blog_curation_settings SET enabled=$1,gateway_url=$2,model=$3,sealed_key=$4,
  key_expires_at=$5,version=version+1,updated_at=clock_timestamp() WHERE id=true AND version=$6 RETURNING id`,
  [input.enabled,gatewayURL,model,sealed,expires,settings.version]);
 if(!saved.length)fail(409,'Настройки уже изменены. Обновите страницу и повторите действие.');
 return blogCurationAdmin(db,user);
}
