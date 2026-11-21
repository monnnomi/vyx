// Owner tool for jVYX seasons. Run on the server:
//   node --env-file=/etc/vyx/vyx.env scripts/token-season.mjs status
//   ... allocate <season>                 freeze shares after the season closes
//   ... batch <season> [--start=ISO]      Merkle batch for members with a wallet (90 daily unlocks)
//   ... activate <batchId> <onchainId>    after addSeason; checked against the chain
//   ... discard <batchId>                 drop a batch that was never added on-chain
// Seasons: early-members, season-1, season-2.
import {withDB} from '../server/db.js';
import {walletChain} from '../server/wallets.js';
import {computeAllocations,createBatch,activateBatch,discardBatch,tokenContracts,tokenUnit,tokenSeasons,decodeSeason,seasonsCallData} from '../server/token-claims.js';

const [cmd,a,b]=process.argv.slice(2),opt=Object.fromEntries(process.argv.slice(2).filter(x=>x.startsWith('--')).map(x=>x.slice(2).split('=')));
const tokens=wei=>{const v=BigInt(wei);return (v/tokenUnit).toLocaleString('en-US')+(v%tokenUnit?'.'+(v%tokenUnit).toString().padStart(18,'0').replace(/0+$/,'').slice(0,4):'');};
const chain=walletChain(),contracts=tokenContracts[chain.id];

async function readSeason(id){
 const res=await fetch(chain.rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_call',params:[{to:contracts.distributor,data:seasonsCallData(id)},'latest']})});
 const body=await res.json();if(body.error)throw new Error(body.error.message);return decodeSeason(body.result);
}

await withDB(async db=>{
 if(cmd==='allocate'){
  const r=await computeAllocations(db,a);
  console.log(`${r.season}: ${r.members} members, ${tokens(r.allocated)} of ${tokens(r.pool)} jVYX allocated (total ${Number(r.totalVP).toLocaleString('en-US')} VP).`);
 }else if(cmd==='batch'){
  const r=await createBatch(db,a,{startsAt:opt.start});
  console.log(`Batch ${r.id} · ${r.season} · ${r.members} wallets · ${tokens(r.total)} jVYX · ${r.tranches} unlocks every ${r.intervalSeconds}s from ${r.startsAt}`);
  console.log('\nOwner steps (from the Mac, contracts/ folder):');
  console.log(`1) Treasury sends tokens to the distributor:\n   cast send ${contracts.token} "transfer(address,uint256)" ${contracts.distributor} ${r.total} --rpc-url robinhood --account <treasury>`);
  console.log(`2) Owner adds the season:\n   cast send ${contracts.distributor} "addSeason(bytes32,uint128,uint64,uint16,uint32)" ${r.root} ${r.total} ${r.start} ${r.tranches} ${r.intervalSeconds} --rpc-url robinhood --account <owner>`);
  console.log(`3) Read the new season id: cast call ${contracts.distributor} "seasonCount()(uint256)" --rpc-url robinhood   (id = count - 1)`);
  console.log(`4) node --env-file=/etc/vyx/vyx.env scripts/token-season.mjs activate ${r.id} <id>`);
 }else if(cmd==='activate'){
  const r=await activateBatch(db,Number(a),Number(b),readSeason);console.log(`Batch ${r.id} is live as on-chain season ${r.onchainId}.`);
 }else if(cmd==='discard'){
  await discardBatch(db,Number(a));console.log(`Batch ${a} discarded.`);
 }else if(cmd==='status'){
  for(const key of Object.keys(tokenSeasons)){
   const [s]=await db.q(`SELECT count(*)::int AS members,COALESCE(sum(amount),0)::text AS allocated,
     (SELECT count(*)::int FROM token_batch_claims c WHERE c.season=$1) AS batched,
     (SELECT count(*)::int FROM token_batch_claims c JOIN token_batches b ON b.id=c.batch_id WHERE c.season=$1 AND b.activated_at IS NOT NULL) AS live,
     (SELECT count(*)::int FROM token_allocations x JOIN user_wallets w ON w.user_id=x.user_id WHERE x.season=$1 AND NOT EXISTS(SELECT 1 FROM token_batch_claims c WHERE c.season=x.season AND c.user_id=x.user_id)) AS waiting
     FROM token_allocations WHERE season=$1`,[key]);
   console.log(`${key}: ${s.members} members, ${tokens(s.allocated)} jVYX allocated, ${s.batched} in batches (${s.live} live), ${s.waiting} with a wallet waiting for a batch`);
  }
 }else{console.log('Usage: status | allocate <season> | batch <season> [--start=ISO] | activate <batchId> <onchainId> | discard <batchId>');process.exitCode=1;}
});
