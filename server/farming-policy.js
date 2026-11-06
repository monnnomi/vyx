import {hash} from './http.js';

export const BASE_UNITS=128;
export const MULTIPLIER_SCALE=1000000;
export const milestones=[100,250,500,1000,2000,5000,10000];
export const legacyRules={version:1,minCharacters:40,minWords:5,cooldownSeconds:300,maxPerHour:8,windowHours:4};
export const nftPolicy={status:'planned',stacking:true,duplicateCopiesStack:true,multiplierCap:null,perTokenBonuses:null};
export const fairRules={...legacyRules,version:2,fullWeightMessages:5,halfWeightMessages:5,maxPerWindow:10,emissionTarget:100,qualificationDays:3,eventReductionPercent:15,similarityPercent:85};

export function legacyDigest(body){
 const normalized=body.normalize('NFKC').toLowerCase().replace(/https?:\/\/\S+/g,' ').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 const words=normalized.split(/\s+/).filter(w=>w.length>=2);
 if(body.trim().length<40||normalized.replace(/\s/g,'').length<24||new Set(words).size<5)return null;
 return hash(normalized);
}
export function analyzeContribution(body){
 const digest=legacyDigest(body);if(!digest)return null;
 const normalized=body.normalize('NFKC').toLowerCase().replace(/https?:\/\/\S+/g,' ').replace(/\p{N}+/gu,'').replace(/[^\p{L}]+/gu,' ').trim();
 const words=normalized.split(/\s+/).filter(w=>w.length>=2),distinct=[...new Set(words)];
 if(distinct.length<5||normalized.replace(/\s/g,'').length<24)return null;
 // Compact fingerprints, not additional copies of members' message text.
 const tokens=distinct.map(word=>parseInt(hash(word).slice(0,8),16)|0).sort((a,b)=>a-b).slice(0,64);
 return {digest,canonical:hash(words.join(' ')),tokens};
}
export function nearDuplicate(a,b){
 if(!a?.length||!b?.length)return false;
 const left=new Set(a),right=new Set(b);let intersection=0;
 for(const token of left)if(right.has(token))intersection++;
 const union=left.size+right.size-intersection;
 return intersection>=5&&intersection*100>=union*fairRules.similarityPercent;
}
export function contributionUnits(accepted){
 if(accepted<fairRules.fullWeightMessages)return BASE_UNITS;
 if(accepted<fairRules.maxPerWindow)return BASE_UNITS/2;
 return 0;
}
// Base event retention only. Per-token boosts are added separately, including duplicate editions.
export function eventRetentionPPM(reached,owned=[]){
 const held=new Set(owned),missing=milestones.filter(n=>reached.includes(n)&&!held.has(n)).length;
 return Number(BigInt(MULTIPLIER_SCALE)*85n**BigInt(missing)/100n**BigInt(missing));
}
function unsignedInteger(value,label){
 if(typeof value==='number'&&!Number.isSafeInteger(value))throw new RangeError(label+' must be an exact integer.');
 if(!/^(0|[1-9]\d*)$/.test(String(value)))throw new RangeError(label+' must be a nonnegative integer.');
 return BigInt(value);
}
// Pure policy calculator for a future verified snapshot. No bonus schedule is enabled by default.
// Holdings are edition quantities, not a set of editions: every copy contributes its configured bonus.
export function nftMultiplierPPM(reached,holdings=[],bonusPerTokenPPM=null){
 const active=new Set(milestones.filter(n=>reached.includes(n))),quantities=new Map();
 for(const holding of holdings){
  const quantity=unsignedInteger(holding.quantity,'NFT quantity');
  if(!active.has(holding.event)||quantity===0n)continue;
  quantities.set(holding.event,(quantities.get(holding.event)||0n)+quantity);
 }
 let bonus=0n;
 for(const [event,quantity] of quantities){
  if(bonusPerTokenPPM?.[event]===undefined)throw new Error('NFT bonus schedule is not configured for this edition.');
  bonus+=quantity*unsignedInteger(bonusPerTokenPPM[event],'NFT bonus');
 }
 return BigInt(eventRetentionPPM(reached,[...quantities.keys()]))+bonus;
}
export function releasedQuota(budget,participants,version=2){
 if(version===1)return Number(budget);
 return Number(BigInt(budget)*BigInt(Math.min(fairRules.emissionTarget,Math.max(0,participants)))/BigInt(fairRules.emissionTarget));
}
export function weightedAward(budget,weightedUnits,totalBaseUnits,totalWeightedUnits){
 const base=BigInt(totalBaseUnits)*BigInt(MULTIPLIER_SCALE);
 if(base===0n)return 0;
 const effective=BigInt(totalWeightedUnits),denominator=effective>base?effective:base;
 // An individual multiplier has no 100% ceiling. Normalize a boosted round to its fixed fund.
 // When all coefficients are <= 100%, retain the existing v2 calculation and unissued remainder.
 return Number(BigInt(budget)*BigInt(weightedUnits)/denominator);
}

