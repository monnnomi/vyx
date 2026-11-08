import {readFile} from 'node:fs/promises';
import {withDB} from '../server/db.js';
if(!process.argv.includes('--apply'))throw new Error('Use --apply for the additive X task migration.');
const schema=await readFile(new URL('../db/x-tasks.sql',import.meta.url),'utf8');
const proof=await withDB(db=>db.tx(async tx=>{
 const totals=async()=> (await tx.q(`SELECT (SELECT count(*) FROM users)::text AS users,
 (SELECT count(*) FROM posts)::text AS posts,(SELECT count(*) FROM room_messages)::text AS room_messages,
 (SELECT count(*) FROM reward_ledger)::text AS reward_records,(SELECT COALESCE(sum(amount),0) FROM reward_ledger)::text AS vp,
 (SELECT spent::text FROM farm_pools WHERE id='promotions') AS promotion_spent`))[0];
 const before=await totals();await tx.q(schema);const after=await totals();
 if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Existing records changed unexpectedly; rolling back.');
 return {applied:true,preserved:true};
}));
console.log(JSON.stringify(proof));
