import {readFile} from 'node:fs/promises';
import {withDB} from '../server/db.js';
if(!process.argv.includes('--apply'))throw new Error('Use --apply for the reputation index migration.');
const migration=await readFile(new URL('../db/reputation.sql',import.meta.url),'utf8');
const result=await withDB(db=>db.tx(async tx=>{
 await tx.q('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
 await tx.q("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'");
 const totals=async()=>(await tx.q(`SELECT (SELECT count(*) FROM users)::text AS users,
  (SELECT count(*) FROM posts)::text AS posts,(SELECT count(*) FROM reactions)::text AS likes,
  (SELECT count(*) FROM room_messages)::text AS room_messages,(SELECT count(*) FROM messages)::text AS direct_messages,
  (SELECT count(*) FROM message_reactions)::text AS message_reactions,(SELECT count(*) FROM media_assets)::text AS media,
  (SELECT count(*) FROM message_views)::text AS message_views,(SELECT count(*) FROM post_views)::text AS post_views,
  (SELECT count(*) FROM reward_ledger)::text AS reward_records,(SELECT COALESCE(sum(amount),0) FROM reward_ledger)::text AS vp,
  (SELECT COALESCE(sum(spent),0) FROM farm_pools)::text AS pool_spend`))[0];
 const before=await totals();await tx.q(migration);const after=await totals();
 if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Existing data changed unexpectedly; rolling back.');
 return {applied:true,preserved:true};
}));
console.log(JSON.stringify(result));
