import {withDB} from '../server/db.js';
import {newsAdminWrite} from '../server/news.js';
import {initialNewsSources} from '../server/news-policy.js';
if(!process.argv.includes('--apply'))throw Error('Use --apply to add the owner-selected sources.');
console.log(JSON.stringify(await withDB(async db=>{
 const id=(process.env.VYX_ADMIN_X_IDS||'').split(',')[0].trim();
 const [owner]=await db.q('SELECT * FROM users WHERE x_id=$1',[id]);
 if(!owner)throw Error('Administrator not found');
 for(const username of initialNewsSources)await newsAdminWrite(db,owner,{action:'source-add',username});
 return {sources:(await db.q('SELECT username,enabled,last_status FROM news_sources WHERE NOT archived ORDER BY username')),automationChanged:false};
})));
