import {withDB} from '../server/db.js';
import {body,fail,handleError,json,limit,sameOrigin,session,ipKey} from '../server/http.js';
import {listNewsComments,writeNewsComment} from '../server/news-comments.js';
import {listNews} from '../server/news.js';
import {requireAdmin} from '../server/admin.js';
import {canPublishNews,editorialTeam,changeEditor,writeStory} from '../server/news-editors.js';
export function createNewsHandler(useDB=withDB){return async(req,res)=>{
 try{
  const u=new URL(req.url,'https://vyx.local'),admin=u.searchParams.get('admin')==='1';
  if(!['GET','POST'].includes(req.method))fail(405,'Method not allowed.');
  await useDB(async db=>{
   if(req.method==='POST'){
    sameOrigin(req);const user=await session(db,req),input=await body(req);
    if(['comment-add','comment-edit','comment-delete'].includes(input.action)){
     if(!user)fail(401,'Sign in with X to comment.');
     await limit(db,'news-comments:'+user.id,30);await limit(db,'news-comments-ip:'+ipKey(req),90);
     return json(res,200,await writeNewsComment(db,user,input));
    }
    if(['story-create','story-edit','story-withdraw'].includes(input.action)){
     if(!user)fail(401,'Sign in to publish.');
     await limit(db,'news-story:'+user.id,30);
     return json(res,200,await writeStory(db,user,input));
    }
    requireAdmin(user);await limit(db,'news-admin:'+user.id,30);
    return json(res,200,await changeEditor(db,user,input));
   }
   if(admin)return json(res,200,await editorialTeam(db,await session(db,req)));
   const viewer=await session(db,req);
   if(u.searchParams.get('action')==='comments')return json(res,200,await listNewsComments(db,viewer,{id:u.searchParams.get('id'),before:u.searchParams.get('before')}));
   return json(res,200,{canPublish:canPublishNews(viewer),...await listNews(db,{category:u.searchParams.get('category')||'all',before:u.searchParams.get('before'),id:u.searchParams.get('id'),viewer})});
  });
 }catch(error){handleError(res,error);}
};}
export default createNewsHandler();
