import {readFile} from 'node:fs/promises';
import {withDB} from '../server/db.js';
if(!process.argv.includes('--apply'))throw new Error('Use --apply for the post views migration.');
const migration=await readFile(new URL('../db/post-views.sql',import.meta.url),'utf8');
const result=await withDB(db=>db.tx(async tx=>{
 await tx.q('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
 const totals=async()=>({
  records:(await tx.q(`SELECT (SELECT count(*) FROM users)::text AS users,(SELECT count(*) FROM posts)::text AS posts,
   (SELECT count(*) FROM reactions)::text AS likes,(SELECT count(*) FROM comments)::text AS comments,
   (SELECT count(*) FROM message_views)::text AS message_views,(SELECT count(*) FROM message_reactions)::text AS reactions,
   (SELECT count(*) FROM reward_ledger)::text AS reward_records,(SELECT COALESCE(sum(amount),0) FROM reward_ledger)::text AS vp,
   (SELECT COALESCE(sum(spent),0) FROM farm_pools)::text AS pool_spend`))[0],
  views:(await tx.q("SELECT to_regclass('public.post_views') AS present"))[0].present?(await tx.q('SELECT count(*)::text AS n FROM post_views'))[0].n:'0'
 });
 const before=await totals();await tx.q(migration);const after=await totals();
 if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Existing data changed unexpectedly; rolling back.');
 return {applied:true,preserved:true};
}));
console.log(JSON.stringify(result));
