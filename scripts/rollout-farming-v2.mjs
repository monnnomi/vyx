import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {withDB} from '../server/db.js';
const source=await readFile(new URL('../db/schema.sql',import.meta.url),'utf8');
const marker='-- Fair room drops v2.';const migration=source.slice(source.indexOf(marker));
if(!migration.startsWith(marker))throw new Error('Missing migration.');
const result=await withDB(db=>db.tx(async tx=>{
 await tx.q('SELECT id FROM farm_state WHERE id=1 FOR UPDATE');
 const ledger=async()=>{
  const [r]=await tx.q("SELECT count(*)::int AS receipts,COALESCE(sum(amount),0)::text AS vp,md5(COALESCE(string_agg(id::text||':'||amount::text||':'||activity::text||':'||units::text,',' ORDER BY id),'')) AS digest FROM farm_awards");
  const pools=await tx.q('SELECT id,budget::text,spent::text FROM farm_pools ORDER BY id');return {receipts:r.receipts,vp:r.vp,digest:r.digest,pools};
 };
 const before=await ledger();await tx.q(migration);const after=await ledger();assert.deepEqual(after,before);
 const versions=await tx.q('SELECT version,starts_at,announced_at FROM farm_rule_versions ORDER BY version');
 const windows=await tx.q('SELECT rule_version,count(*)::int AS windows FROM farm_windows GROUP BY rule_version ORDER BY rule_version');
 return {previousReceiptsPreserved:true,before,after,versions,windows};
}));
await mkdir('../outputs/vyx-points-v2',{recursive:true});await writeFile('../outputs/vyx-points-v2/rollout.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({previousReceiptsPreserved:result.previousReceiptsPreserved,receipts:result.after.receipts,vp:result.after.vp,version2:result.versions.find(v=>v.version===2),windows:result.windows}));
