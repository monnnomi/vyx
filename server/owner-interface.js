import {readFile} from 'node:fs/promises';
import {cookie,fail,session} from './http.js';
import {withDB} from './db.js';

// This preference belongs to the site owner. Admin and profile permissions are independent.
export function ownerLocale(user){
 return user?.x_id && user.x_id===process.env.VYX_OWNER_INTERFACE_X_ID&&!user.is_system?(user.interface_locale==='ru'?'ru':'en'):null;
}
export async function saveOwnerLocale(db,user,locale){
 if(ownerLocale(user)===null)fail(403,'This setting is private.');
 if(!['en','ru'].includes(locale))fail(400,'Unknown interface language.');
 await db.q('UPDATE users SET interface_locale=$1 WHERE id=$2 AND x_id=$3 AND NOT is_system',[locale,user.id,user.x_id]);
 return {locale};
}
const pages=new Map([['/','index.html'],['/index.html','index.html'],['/privacy.html','privacy.html']]);
export async function serveOwnerPage(path,req,res,useDB=withDB){
 if(!pages.has(path)||!['GET','HEAD'].includes(req.method))return false;
 res.setHeader('Vary','Cookie');
 if(!cookie(req,'vyx_session'))return false;
 if(await useDB(async db=>ownerLocale(await session(db,req)))!=='ru')return false;
 const bytes=await readFile(new URL('./generated-interface-ru/'+pages.get(path),import.meta.url));
 res.setHeader('Content-Type','text/html; charset=utf-8');
 res.setHeader('Content-Language','ru');
 res.setHeader('Cache-Control','private, no-store');
 res.end(req.method==='HEAD'?undefined:bytes);
 return true;
}

const systemCopy=new Map((await readFile(new URL('../locales/system-ru.tsv',import.meta.url),'utf8'))
 .trimEnd().split(/\r?\n/).map(line=>line.split('\t')));
// Apply only to fields originating in VYX code. Posts, names, messages and
// editorial content are displayed verbatim, including text matching a UI label.
export function localizeSystemResult(action,payload,user){
 if(ownerLocale(user)!=='ru')return payload;
 const translate=text=>systemCopy.get(text)??text;
 if(action==='tasks'||action==='verify-tasks'){
  return {...payload,tasks:payload.tasks.map(task=>({...task,title:translate(task.title),detail:translate(task.detail)}))};
 }
 if(action==='state')return {...payload,calendar:{...payload.calendar,label:translate(payload.calendar.label)}};
 if(action==='room-send'&&payload.farming)return {...payload,farming:{...payload.farming,reason:translate(payload.farming.reason)}};
 return payload;
}
