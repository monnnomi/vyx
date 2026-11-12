import {readFile} from 'node:fs/promises';
import {withDB} from '../server/db.js';
if(!process.argv.includes('--apply'))throw Error('Use --apply to upgrade newsroom presentation.');
const migration=await readFile(new URL('../db/news-editorial.sql',import.meta.url),'utf8');
console.log(JSON.stringify(await withDB(db=>db.tx(async tx=>{
 await tx.q('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
 const totals=async()=>(await tx.q(`SELECT (SELECT count(*) FROM users)::text AS users,(SELECT count(*) FROM posts)::text AS posts,(SELECT count(*) FROM room_messages)::text AS messages,(SELECT count(*) FROM reward_ledger)::text AS awards,(SELECT COALESCE(sum(amount),0) FROM reward_ledger)::text AS vp,(SELECT count(*) FROM news_items)::text AS stories`))[0];
 const before=await totals();await tx.q(migration);const after=await totals();
 if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Existing records changed; rolling back.');
 return {applied:true,preserved:true};
}))));
