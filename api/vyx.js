import {referralBoard} from '../server/referrals.js';
import {searchCommunity,memberProfile,postDetail,handleAvailability,memberPreferences,recordProductEvent} from '../server/social.js';
import {withDB} from '../server/db.js';
import {body,sameOrigin,session,fail,handleError,json,limit,ipKey,setCookie,cookie,hash,uuid} from '../server/http.js';
import {state,feed,comments,conversations,messages,mutate} from '../server/service.js';
import {listRooms,roomSummary,roomThread,roomMembers,roomMessage,roomMentionCandidates} from '../server/rooms.js';
import {dropResults,dropResult,revealDrop,notifications,readNotifications} from '../server/drops.js';
export function createHandler(useDB=withDB){return async function handler(req,res){
 try{
  const url=new URL(req.url,'https://vyx.local'),action=url.searchParams.get('action')||'state';
  if(!['GET','POST'].includes(req.method))fail(405,'Method not allowed.');
  if(req.method==='POST')sameOrigin(req);
  await useDB(async db=>{
   const user=await session(db,req);
   if(req.method==='GET'){
    if(action==='referrals')return json(res,200,await referralBoard(db,user));
    if(action==='search')return json(res,200,await searchCommunity(db,user,url.searchParams.get('q')||''));
    if(action==='member-profile')return json(res,200,await memberProfile(db,user,url.searchParams.get('id')));
    if(action==='post-detail')return json(res,200,await postDetail(db,user,url.searchParams.get('id')));
    if(action==='handle-availability')return json(res,200,await handleAvailability(db,user,url.searchParams.get('handle')||''));
    if(action==='state')return json(res,200,await state(db,user));
    if(action==='feed')return json(res,200,{posts:await feed(db,user,{filter:url.searchParams.get('filter')||'all',author:url.searchParams.has('author')?uuid(url.searchParams.get('author')):null,cursor:url.searchParams.get('cursor')||null})});
    if(action==='comments')return json(res,200,{comments:await comments(db,url.searchParams.get('id'),user)});
    if(action==='rooms')return json(res,200,await listRooms(db,user,{filter:url.searchParams.get('filter')||'all',search:url.searchParams.get('search')||'',page:url.searchParams.get('page')||0}));
    if(action==='room-info')return json(res,200,await roomSummary(db,user,url.searchParams.get('id')));
    if(!user)fail(401,'Sign in with X to continue.');
    if(action==='preferences')return json(res,200,await memberPreferences(db,user));
    if(action==='drops')return json(res,200,await dropResults(db,user,{before:url.searchParams.get('before')}));
    if(action==='drop-result')return json(res,200,await dropResult(db,user,url.searchParams.get('id')));
    if(action==='notifications')return json(res,200,await notifications(db,user));
    if(action==='room-thread')return json(res,200,await roomThread(db,user,url.searchParams.get('id'),url.searchParams.get('before')));
    if(action==='room-message')return json(res,200,await roomMessage(db,user,url.searchParams.get('id'),url.searchParams.get('messageId')));
    if(action==='room-mention-candidates')return json(res,200,await roomMentionCandidates(db,user,url.searchParams.get('id'),url.searchParams.get('search')||''));
    if(action==='room-members')return json(res,200,await roomMembers(db,user,url.searchParams.get('id'),url.searchParams.get('page')||0));
    if(action==='conversations')return json(res,200,{conversations:await conversations(db,user)});
    if(action==='messages')return json(res,200,{messages:await messages(db,user,url.searchParams.get('id'))});
    fail(404,'Page not found.');
   }
   if(action==='product-event'){await limit(db,'event:'+ipKey(req),30);return json(res,200,await recordProductEvent(db,await body(req)));}
   if(!user)fail(401,'Sign in with X to continue.');
   await limit(db,'write:'+user.id,60);
   await limit(db,'ip:'+ipKey(req),180);
   if(action==='logout'){
    await db.q('DELETE FROM sessions WHERE token_hash=$1',[hash(cookie(req,'vyx_session'))]);setCookie(res,'vyx_session','',0);return json(res,200,{ok:true});
   }
   const data=await body(req);
   if(action==='drop-reveal')return json(res,200,await revealDrop(db,user,data.id));
   if(action==='notifications-read')return json(res,200,await readNotifications(db,user));
   json(res,200,await mutate(db,user,action,data));
  });
 }catch(e){handleError(res,e);}
};}
export default createHandler();
