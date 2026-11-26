import {moderationQueue,moderate} from '../server/social.js';
import {withDB} from '../server/db.js';
import {session,fail,handleError,json,body,sameOrigin,limit} from '../server/http.js';
import {adminOverview,requireAdmin} from '../server/admin.js';
import {settleDueWindows,farmingAdmin} from '../server/farming.js';
import {tokenAdmin,tokenAdminAction,distributorReader} from '../server/token-claims.js';
import {blogCurationAdmin,saveBlogCurationSettings} from '../server/blog-curation-settings.js';
import {selectBlogPost} from '../server/blog-curation.js';
export function createAdminHandler(useDB=withDB,{tokenChain=()=>distributorReader(),blogFetcher=fetch}={}){return async function handler(req,res){
 try{
  if(!['GET','POST'].includes(req.method))fail(405,'Method not allowed.');
  const url=new URL(req.url,'https://vyx.local');
  await useDB(async db=>{
   const user=await session(db,req);requireAdmin(user);
   if(req.method==='POST'){
    sameOrigin(req);await limit(db,'admin:'+user.id,30);const input=await body(req);
    if(String(input?.action||'').startsWith('token-'))return json(res,200,await tokenAdminAction(db,input,tokenChain()));
    if(input.action==='blog-curation-settings')return json(res,200,await saveBlogCurationSettings(db,user,input,blogFetcher));
    if(input.action==='blog-curation-select')return json(res,200,await selectBlogPost(db,user,input));
    return json(res,200,await moderate(db,user,input));
   }
   const action=url.searchParams.get('action');
   if(action==='moderation')return json(res,200,await moderationQueue(db,user));
   if(action==='farming'){await settleDueWindows(db);return json(res,200,await farmingAdmin(db));}
   if(action==='tokens')return json(res,200,await tokenAdmin(db));
   if(action==='blog-curation')return json(res,200,await blogCurationAdmin(db,user));
   json(res,200,await adminOverview(db,user,{query:url.searchParams.get('q'),filter:url.searchParams.get('filter'),page:url.searchParams.get('page')}));
  });
 }catch(e){handleError(res,e);}
};}
export default createAdminHandler();
