import {readFile} from 'node:fs/promises';
import {withDB} from '../server/db.js';
if(!process.argv.includes('--apply'))throw new Error('Use --apply for the reviewed additive social migration.');
if(!process.env.DATABASE_URL)throw new Error('Database is not configured.');
const schema=await readFile(new URL('../db/social-improvements.sql',import.meta.url),'utf8');
const proof=await withDB(db=>db.tx(async tx=>{
 const totals=async()=> (await tx.q(`SELECT (SELECT count(*) FROM users)::text AS users,
 (SELECT count(*) FROM posts)::text AS posts,(SELECT count(*) FROM room_messages)::text AS room_messages,
 (SELECT count(*) FROM reward_ledger)::text AS reward_records,(SELECT COALESCE(sum(amount),0) FROM reward_ledger)::text AS vp`))[0];
 const before=await totals();await tx.q(schema);const after=await totals();
 if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Existing records changed unexpectedly; rolling back.');
 return {applied:true,preserved:true,counts:after};
}));
console.log(JSON.stringify(proof));
