import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {withDB} from '../server/db.js';
const source=await readFile(new URL('../db/schema.sql',import.meta.url),'utf8');
const marker='-- Stackable NFT multipliers.';const migration=source.slice(source.indexOf(marker));
if(!migration.startsWith(marker))throw new Error('Missing NFT stacking migration.');
const result=await withDB(db=>db.tx(async tx=>{
 await tx.q('SELECT id FROM farm_state WHERE id=1 FOR UPDATE');
 const snapshot=async()=>{
  const [receipts]=await tx.q("SELECT count(*)::int AS count,COALESCE(sum(amount),0)::text AS vp,md5(COALESCE(string_agg(row_to_json(a)::text,',' ORDER BY id),'')) AS digest FROM farm_awards a");
  const [contributions]=await tx.q("SELECT count(*)::int AS count,md5(COALESCE(string_agg(row_to_json(c)::text,',' ORDER BY id),'')) AS digest FROM farm_contributions c");
  const pools=await tx.q('SELECT id,budget::text,spent::text FROM farm_pools ORDER BY id');
  const versions=await tx.q('SELECT version,starts_at,announced_at FROM farm_rule_versions ORDER BY version');
  return {receipts,contributions,pools,versions};
 };
 const before=await snapshot();await tx.q(migration);const after=await snapshot();assert.deepEqual(after,before);
 const storage=await tx.q("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema=current_schema() AND (table_name IN('farm_contributions','farm_account_rounds') AND column_name='multiplier_ppm' OR table_name='farm_awards' AND column_name='effective_units') ORDER BY table_name");
 assert.ok(storage.length===3&&storage.every(c=>c.data_type==='numeric'));
 return {previousAwardsAndContributionsPreserved:true,before,after,storage};
}));
await mkdir('../outputs/vyx-nft-stacking',{recursive:true});await writeFile('../outputs/vyx-nft-stacking/rollout.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({previousAwardsAndContributionsPreserved:true,receipts:result.after.receipts.count,vp:result.after.receipts.vp,storage:result.storage}));
