import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {withDB} from '../server/db.js';
const source=await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'),marker='-- Photo and video attachments.';
const sql=source.slice(source.indexOf(marker));if(!sql.startsWith(marker))throw new Error('Missing media migration.');
const result=await withDB(db=>db.tx(async tx=>{
 // Lock content before taking a consistency snapshot; no farming lock or VP changes.
 await tx.q('LOCK TABLE posts,comments,messages,room_messages IN ACCESS EXCLUSIVE MODE');
 const snapshot=async()=>{
  const tables={};for(const name of ['posts','comments','messages','room_messages']){
   const [row]=await tx.q(`SELECT count(*)::int AS count,md5(COALESCE(string_agg((to_jsonb(t)-'request_id')::text,',' ORDER BY id),'')) AS digest FROM ${name} t`);tables[name]=row;
  }
  const [vp]=await tx.q("SELECT count(*)::int AS receipts,COALESCE(sum(amount),0)::text AS total FROM farm_awards");return {tables,vp};
 };
 const before=await snapshot();await tx.q(sql);const after=await snapshot();assert.deepEqual(before,after);return {existingContentAndVPUnchanged:true,before,after};
}));
await mkdir('../outputs/vyx-media',{recursive:true});await writeFile('../outputs/vyx-media/rollout.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({existingContentAndVPUnchanged:true,rows:Object.fromEntries(Object.entries(result.after.tables).map(([name,r])=>[name,r.count])),vp:result.after.vp}));
