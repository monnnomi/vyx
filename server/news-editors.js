import {fail,text,uuid} from './http.js';
import {isAdmin,requireAdmin} from './admin.js';

export const newsCategories=['updates','ecosystem','events','security','markets','reviews'];
export const canPublishNews=user=>Boolean(user&&!user.is_system&&(isAdmin(user)||user.news_author));
export function canManageStory(user,article){
 return isAdmin(user)||Boolean(canPublishNews(user)&&article.author_id===user.id);
}

export async function editorialTeam(db,user){
 requireAdmin(user);
 return {authors:await db.q('SELECT id,name,handle FROM users WHERE news_author AND NOT is_system ORDER BY lower(name),id')};
}

export async function changeEditor(db,user,input){
 requireAdmin(user);
 const grant=input.action==='author-grant';
 if(!grant&&input.action!=='author-revoke')fail(400,'Unknown newsroom action.');
 return db.tx(async tx=>{
  let account;
  if(grant){
   const handle=text(input.handle,1,100).replace(/^@/,'');
   const matches=await tx.q('SELECT id,x_id,is_system FROM users WHERE lower(handle)=lower($1) AND NOT is_system FOR UPDATE',[handle]);
   if(matches.length!==1)fail(404,'VYX member not found.');
   [account]=matches;
  }else{
   [account]=await tx.q('SELECT id,x_id,is_system FROM users WHERE id=$1 AND NOT is_system FOR UPDATE',[uuid(input.id)]);
   if(!account)fail(404,'VYX member not found.');
  }
  if(isAdmin(account))fail(409,'Administrators already have publishing access.');
  await tx.q('UPDATE users SET news_author=$2 WHERE id=$1',[account.id,grant]);
  return {ok:true};
 });
}

function copy(input){
 const title=text(input.title,1,150),summary=text(input.summary,1,450),body=text(input.body,1,8000);
 if(!newsCategories.includes(input.category))fail(400,'Choose a category.');
 const paragraphs=body.split(/\n\s*\n/).map(p=>p.trim()).filter(Boolean);
 let source='';
 if(input.source){
  try{
   const url=new URL(text(input.source,1,1500));
   if(url.protocol!=='https:'||url.username||url.password)throw Error();
   source=url.href;
  }catch{fail(400,'Use an HTTPS source link.');}
 }
 return {title,summary,paragraphs,category:input.category,source};
}

export async function writeStory(db,user,input){
 if(!user)fail(401,'Sign in to publish.');
 const id=uuid(input.id);
 return db.tx(async tx=>{
  const [actor]=await tx.q('SELECT id,x_id,is_system,news_author FROM users WHERE id=$1 FOR UPDATE',[user.id]);
  if(!canPublishNews(actor))fail(403,'Publishing access is required.');
  const creating=input.action==='story-create';
  if(!creating){
   const [article]=await tx.q('SELECT author_id FROM news_items WHERE id=$1 AND status=\'published\' FOR UPDATE',[id]);
   if(!article)fail(404,'This story is not available.');
   if(!canManageStory(actor,article))fail(403,'You can only manage your own stories.');
   if(input.action==='story-withdraw'){
    await tx.q("UPDATE news_items SET status='withdrawn',updated_at=clock_timestamp() WHERE id=$1",[id]);
    return {id};
   }
   if(input.action!=='story-edit'||!article.author_id)fail(400,'This story cannot be edited.');
  }
  const {category,title,summary,paragraphs,source}=copy(input);
  const fields=[id,category,title,summary,JSON.stringify(paragraphs),source];
  if(creating){
   const rows=await tx.q(`INSERT INTO news_items(id,category,title_en,summary_en,body_en,source_url,author_id,source_text,content_hash,status,published_at,presentation)
    VALUES($1,$2,$3,$4,$5::text::jsonb,$6,$7,'',$8,'published',clock_timestamp(),$9::text::jsonb)
    ON CONFLICT(id) DO NOTHING RETURNING id`,[...fields,actor.id,'manual:'+id,JSON.stringify({staff:isAdmin(actor)})]);
   if(!rows.length){
    const [same]=await tx.q(`SELECT id FROM news_items WHERE id=$1 AND category=$2 AND title_en=$3 AND summary_en=$4 AND body_en=$5::text::jsonb AND source_url=$6 AND author_id=$7 AND status='published'`,[...fields,actor.id]);
    if(!same)fail(409,'This story has already changed. Reload it before editing.');
   }
  }else{
   await tx.q('UPDATE news_items SET category=$2,title_en=$3,summary_en=$4,body_en=$5::text::jsonb,source_url=$6,updated_at=clock_timestamp() WHERE id=$1',fields);
  }
  return {id};
 });
}
