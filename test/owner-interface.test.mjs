import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createHandler} from '../api/vyx.js';
import {login} from '../server/oauth.js';
import {serveOwnerPage} from '../server/owner-interface.js';

test('the owner can switch across sessions, while guests and other admins always get English',async()=>{
 execFileSync(process.execPath,['scripts/build-interface-ru.mjs'],{cwd:new URL('../',import.meta.url)});
 const pg=new PGlite();
 try{
  await pg.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
  const wrap=p=>({q:async(sql,params)=>(await p.query(sql,params)).rows,tx:fn=>p.transaction(tx=>fn(wrap(tx)))});
  const db=wrap(pg),useDB=fn=>fn(db);
  process.env.VYX_APP_SECRET='local-test-only';
  process.env.PUBLIC_APP_URL='https://vyx.test';
  const signin=(id,name)=>db.tx(tx=>login(tx,{id,name,username:name,avatar:''}));
  const ownerXId='1001';process.env.VYX_OWNER_INTERFACE_X_ID=ownerXId;
  const owner=await signin(ownerXId,'owner'),other=await signin('2345','monnnomi_');
  process.env.VYX_ADMIN_X_IDS=other.user.x_id;
  function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=body?.toString();}};}
  const cookie=account=>account?'vyx_session='+account.sessionToken:'';
  const handler=createHandler(useDB);
  async function call(action,account,body,origin=process.env.PUBLIC_APP_URL){
   const res=response();
   await handler({url:'/api/vyx?action='+action,method:body?'POST':'GET',body,headers:{cookie:cookie(account),origin,'content-type':'application/json'}},res);
   return {status:res.statusCode,data:JSON.parse(res.body)};
  }
  async function page(account,path='/',method='GET'){
   const res=response();const localized=await serveOwnerPage(path,{method,headers:{cookie:cookie(account)+'; vyx_ui_ru=1','accept-language':'ru'}},res,useDB);
   return {localized,...res};
  }
  assert.equal((await call('state',owner)).data.user.owner_interface_locale,'en');
  assert.equal((await call('interface-language',null,{locale:'ru'})).status,401);
  assert.equal((await call('interface-language',other,{locale:'ru',x_id:ownerXId})).status,403);
  assert.equal((await call('interface-language',owner,{locale:'de'})).status,400);
  assert.equal((await call('interface-language',owner,{locale:'ru'},'https://other.test')).status,403);
  assert.equal((await page(owner)).localized,false);
  assert.equal((await call('interface-language',owner,{locale:'ru'})).status,200);
  const second=await signin(ownerXId,'owner');
  const russian=await page(second);
  assert.equal(russian.headers.Vary,'Cookie');assert.match(russian.headers['Cache-Control'],/private, no-store/);
  assert.match(russian.body,/<html lang="ru">/);assert.match(russian.body,/\/assets\/interface-ru\/social-shell\.js/);
  assert.match((await page(second,'/privacy.html')).body,/Данные и конфиденциальность/);
  assert.equal((await page(second,'/index.html','HEAD')).body,undefined);
  for(const account of [null,other]){
   assert.equal((await page(account)).localized,false);
   assert.equal((await page(account,'/privacy.html')).localized,false);
   assert.equal((await call('tasks',account)).data.tasks[0].title,'Follow VYX on X');
  }
  const outsider=(await call('state',other)).data;
  assert.equal(outsider.user.is_admin,true);
  assert.equal('owner_interface_locale' in outsider.user,false);
  assert.ok(outsider.members.every(member=>!('interface_locale' in member||'owner_interface_locale' in member)));
  assert.equal((await call('tasks',second)).data.tasks[0].title,'Подписаться на VYX в X');
  await db.q('INSERT INTO posts(body,user_id) VALUES($1,$2)',['Follow VYX on X',other.user.id]);
  const state=(await call('state',second)).data;
  assert.equal(state.posts[0].body,'Follow VYX on X');
  assert.equal((await call('interface-language',second,{locale:'en'})).status,200);
  assert.equal((await page(owner)).localized,false);
 }finally{await pg.close();}
});
