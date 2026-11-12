import {fail,text,uuid} from './http.js';
import {isAdmin} from './admin.js';
import {hiddenBy} from './social.js';

// Internal SQL fragments only. Viewer IDs are always bound parameters.
export const newsCommentCount=(viewer='$1')=>`(SELECT count(*)::int FROM news_comments nc WHERE nc.news_id=n.id AND nc.deleted_at IS NULL AND NOT ${hiddenBy(viewer,'nc.user_id')}) AS comment_count`;
export async function listNewsComments(db,user,{id,before=null}={}){
 const newsId=uuid(id),viewer=user?.id||null,cursor=before?uuid(before):null;
 const [story]=await db.q("SELECT id FROM news_items WHERE id=$1 AND status='published'",[newsId]);
 if(!story)fail(404,'This story is not available.');
 if(cursor){const [anchor]=await db.q('SELECT id FROM news_comments WHERE news_id=$1 AND id=$2',[newsId,cursor]);if(!anchor)fail(400,'Please refresh the comments.');}
 const rows=await db.q(`SELECT c.id,c.body,c.created_at,c.edited_at,c.user_id,u.name,u.handle,u.avatar_url
 FROM news_comments c JOIN users u ON u.id=c.user_id
 WHERE c.news_id=$1 AND c.deleted_at IS NULL AND NOT ${hiddenBy('$2','c.user_id')}
 AND ($3::uuid IS NULL OR (c.created_at,c.id)<(SELECT created_at,id FROM news_comments WHERE id=$3 AND news_id=$1))
 ORDER BY c.created_at DESC,c.id DESC LIMIT 31`,[newsId,viewer,cursor]);
 const [{total}]=await db.q(`SELECT count(*)::int AS total FROM news_comments c WHERE c.news_id=$1 AND c.deleted_at IS NULL AND NOT ${hiddenBy('$2','c.user_id')}`,[newsId,viewer]);
 return {comments:rows.slice(0,30).reverse().map(c=>({id:c.id,body:c.body,createdAt:c.created_at,editedAt:c.edited_at,
  author:{id:c.user_id,name:c.name,handle:c.handle,avatar_url:c.avatar_url},canEdit:c.user_id===viewer,canDelete:c.user_id===viewer||isAdmin(user)})),next:rows.length>30?rows[29].id:null,total};
}
export async function writeNewsComment(db,user,input){
 if(!user)fail(401,'Sign in with X to comment.');
 const newsId=uuid(input.newsId);
 return db.tx(async tx=>{
  const [member]=await tx.q('SELECT id,x_id,is_system FROM users WHERE id=$1 AND NOT is_system FOR UPDATE',[user.id]);
  if(!member)fail(401,'Please sign in again.');
  const [story]=await tx.q("SELECT id FROM news_items WHERE id=$1 AND status='published' FOR SHARE",[newsId]);
  if(!story)fail(404,'This story is not available.');
  if(input.action==='comment-add'){
   const content=text(input.body,1,2000),requestId=uuid(input.requestId);
   const [old]=await tx.q('SELECT id,news_id,body,deleted_at FROM news_comments WHERE user_id=$1 AND request_id=$2',[user.id,requestId]);
   if(old){if(old.news_id!==newsId||old.body!==content)fail(409,'Please start a new comment request.');return {ok:true,id:old.id,deleted:Boolean(old.deleted_at)};}
   const [{n}]=await tx.q("SELECT count(*)::int AS n FROM news_comments WHERE user_id=$1 AND created_at>clock_timestamp()-interval '1 hour'",[user.id]);
   if(n>=30)fail(429,'You can add up to 30 news comments per hour.');
   const [comment]=await tx.q('INSERT INTO news_comments(news_id,user_id,body,request_id) VALUES($1,$2,$3,$4) RETURNING id',[newsId,user.id,content,requestId]);
   return {ok:true,id:comment.id};
  }
  if(!['comment-edit','comment-delete'].includes(input.action))fail(400,'Unknown comment action.');
  const [comment]=await tx.q('SELECT id,user_id,deleted_at FROM news_comments WHERE id=$1 AND news_id=$2 FOR UPDATE',[uuid(input.id),newsId]);
  if(!comment)fail(404,'This comment is not available.');
  if(comment.user_id!==user.id&&(input.action!=='comment-delete'||!isAdmin(member)))fail(403,'You can only change your own comments.');
  if(input.action==='comment-delete'){
   await tx.q('UPDATE news_comments SET deleted_at=COALESCE(deleted_at,clock_timestamp()) WHERE id=$1',[comment.id]);
   return {ok:true,id:comment.id};
  }
  if(comment.deleted_at)fail(404,'This comment is not available.');
  const content=text(input.body,1,2000);
  const [updated]=await tx.q('UPDATE news_comments SET edited_at=CASE WHEN body<>$2 THEN clock_timestamp() ELSE edited_at END,body=$2 WHERE id=$1 RETURNING edited_at',[comment.id,content]);
  return {ok:true,id:comment.id,editedAt:updated.edited_at};
 });
}
