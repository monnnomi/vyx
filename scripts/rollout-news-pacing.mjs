import {readFile} from 'node:fs/promises';
import {withDB} from '../server/db.js';
if(!process.argv.includes('--apply'))throw Error('Use --apply to add news pacing without resetting spending.');
const sql=await readFile(new URL('../db/news-pacing.sql',import.meta.url),'utf8');
await withDB(db=>db.tx(async tx=>{
 await tx.q('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
 const counts=`SELECT (SELECT count(*) FROM users)::text AS users,(SELECT count(*) FROM posts)::text AS posts,
  (SELECT count(*) FROM room_messages)::text AS messages,(SELECT count(*) FROM news_items)::text AS news,
  (SELECT count(*) FROM news_comments)::text AS comments,(SELECT COALESCE(sum(amount),0) FROM reward_ledger)::text AS vp,
  (SELECT COALESCE(sum(reserved_cents),0) FROM news_budget)::text AS reserved,
  (SELECT count(*) FROM news_items WHERE status='published')::text AS published`;
 const [before]=await tx.q(counts);await tx.q(sql);const [after]=await tx.q(counts);
 if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Content/spending preservation check failed.');
 console.log(JSON.stringify({migration:'news-pacing',preserved:after}));
}));
