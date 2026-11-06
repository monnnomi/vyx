import {fail,uuid} from './http.js';
import {calendar} from './config.js';
import {milestones,legacyRules,fairRules,legacyDigest,analyzeContribution,nearDuplicate,contributionUnits,releasedQuota,weightedAward,MULTIPLIER_SCALE,nftPolicy} from './farming-policy.js';
export {milestones};
export const farmingRules=legacyRules;
export const eligibleContent=legacyDigest;
const number=n=>Number(n||0),iso=d=>new Date(d).toISOString();
export function retentionUnits(reached,owned=[]){const held=new Set(owned);return 128/(2**milestones.filter(n=>reached.includes(n)&&!held.has(n)).length);}
async function clock(db){return new Date((await db.q('SELECT clock_timestamp() AS now'))[0].now);}
// Serialize acceptance with settlement. The authenticated room writer already locks the actor.
export async function recordContribution(tx,user,roomId,messageId,body){
 const digest=eligibleContent(body);
 if(!digest)return {counted:false,reason:'For farming: use at least 40 characters and 5 different words.'};
 await tx.q('SELECT id FROM farm_state WHERE id=1 FOR UPDATE');
 const now=await clock(tx),stamp=iso(now);
 const [w]=await tx.q('SELECT * FROM farm_windows WHERE starts_at<=$1 AND ends_at>$1 AND settled_at IS NULL',[stamp]);
 if(!w)return {counted:false,reason:stamp<'2026-11-01T00:00:00.000Z'?'Room farming starts November 1 at 00:00 UTC.':'The farming seasons have ended.'};
 const v2=w.rule_version===2,analysis=v2?analyzeContribution(body):null;
 if(v2&&!analysis)return {counted:false,reason:'For farming: use 24 letters and 5 different words. Numbers alone do not add contribution.'};
 const [duplicate]=await tx.q('SELECT 1 FROM farm_contributions WHERE user_id=$1 AND content_hash=$2',[user.id,digest]);
 if(duplicate)return {counted:false,reason:'Repeated messages do not add farming activity.'};
 let base=128;
 if(v2){
  const [used]=await tx.q('SELECT count(*)::int AS n FROM farm_contributions WHERE user_id=$1 AND window_start=$2',[user.id,w.starts_at]);
  base=contributionUnits(used.n);
  if(!base)return {counted:false,reason:'Your 10 farming messages for this round are used. Keep chatting; the next round resets the allowance.'};
  const [copy]=await tx.q(`SELECT 1 FROM farm_contributions WHERE canonical_hash=$2 AND (user_id=$1 OR (window_start=$3 AND voided_at IS NULL)) LIMIT 1`,[user.id,analysis.canonical,w.starts_at]);
  if(copy)return {counted:false,reason:'Copied text or number-only variations do not add farming activity.'};
  const recentText=await tx.q(`SELECT similarity_tokens FROM farm_contributions WHERE user_id=$1 AND similarity_tokens IS NOT NULL AND created_at>$2::timestamptz-interval '7 days' ORDER BY created_at DESC LIMIT 80`,[user.id,stamp]);
  if(recentText.some(r=>nearDuplicate(analysis.tokens,r.similarity_tokens)))return {counted:false,reason:'This is too similar to your recent farming messages. Share a new contribution.'};
 }
 const [recent]=await tx.q(`SELECT max(created_at) AS last_at,count(*) FILTER(WHERE created_at>=(date_trunc('hour',$2::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'))::int AS hour_count
 FROM farm_contributions WHERE user_id=$1 AND created_at>$2::timestamptz-interval '1 hour'`,[user.id,stamp]);
 if(recent.last_at&&now-new Date(recent.last_at)<300000)return {counted:false,reason:'Farming counts one message every 5 minutes across all rooms.'};
 if(recent.hour_count>=8)return {counted:false,reason:'You have reached 8 eligible messages this UTC hour.'};
 const fresh=await tx.q('INSERT INTO farm_farmers(user_id,x_id,activated_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING user_id',[user.id,user.x_id,stamp]);
 if(fresh.length){
  const [count]=await tx.q('UPDATE farm_state SET farmers=farmers+1 WHERE id=1 RETURNING farmers');
  if(!v2)for(const threshold of milestones.filter(n=>n<=count.farmers))await tx.q('INSERT INTO farm_milestones(threshold,activated_at) VALUES($1,$2) ON CONFLICT DO NOTHING',[threshold,stamp]);
 }
 let units=base,multiplier=MULTIPLIER_SCALE;
 if(v2){
  // Wallet/contract verification is not live. No client-supplied NFT holdings are accepted.
  // A real ownership snapshot adapter must precede activation of event reductions.
  await tx.q('INSERT INTO farm_account_rounds(window_start,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[w.starts_at,user.id]);
  const [round]=await tx.q('SELECT multiplier_ppm FROM farm_account_rounds WHERE window_start=$1 AND user_id=$2',[w.starts_at,user.id]);
  multiplier=round.multiplier_ppm;
 }else units=retentionUnits((await tx.q('SELECT threshold FROM farm_milestones')).map(r=>r.threshold));
 const rows=await tx.q(`INSERT INTO farm_contributions(message_id,room_id,user_id,window_start,content_hash,slot,units,created_at,base_units,multiplier_ppm,canonical_hash,similarity_tokens)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING RETURNING id`,[messageId,roomId,user.id,w.starts_at,digest,Math.floor(now.getTime()/300000),units,stamp,base,multiplier,analysis?.canonical||null,analysis?.tokens||null]);
 return {counted:rows.length>0,reason:rows.length?`Activity added to this drop.${v2&&base===64?' Half-weight contribution.':''}`:'This activity has already been counted.',retention:v2?number(multiplier)/MULTIPLIER_SCALE:units/128,coefficientPPM:v2?String(multiplier):null,weight:base/128};
}
export async function voidContribution(tx,messageId){
 await tx.q('SELECT id FROM farm_state WHERE id=1 FOR UPDATE');
 await tx.q(`UPDATE farm_contributions c SET voided_at=clock_timestamp() FROM farm_windows w
 WHERE c.window_start=w.starts_at AND c.message_id=$1 AND c.voided_at IS NULL AND w.settled_at IS NULL AND clock_timestamp()<w.ends_at`,[messageId]);
}
async function qualifyFarmers(tx){
 await tx.q(`UPDATE farm_farmers f SET qualified_at=clock_timestamp() WHERE f.qualified_at IS NULL AND f.user_id IN (
 SELECT c.user_id FROM farm_contributions c JOIN farm_windows w ON w.starts_at=c.window_start
 WHERE c.voided_at IS NULL AND w.settled_at IS NOT NULL
 GROUP BY c.user_id HAVING count(DISTINCT (c.created_at AT TIME ZONE 'UTC')::date)>=3)`);
}
export async function settleDueWindows(db,batch=12){
 const [due]=await db.q('SELECT starts_at FROM farm_windows WHERE settled_at IS NULL AND ends_at<=clock_timestamp() ORDER BY starts_at LIMIT 1');
 if(!due)return {settled:0};
 return db.tx(async tx=>{
  await tx.q('SELECT id FROM farm_state WHERE id=1 FOR UPDATE');
  const windows=await tx.q('SELECT * FROM farm_windows WHERE settled_at IS NULL AND ends_at<=clock_timestamp() ORDER BY starts_at LIMIT $1 FOR UPDATE',[batch]);
  for(const w of windows){
   const [pool]=await tx.q('SELECT * FROM farm_pools WHERE id=$1 FOR UPDATE',[w.season]);
   const quota=Math.min(number(w.budget),Math.max(0,number(pool.budget)-number(pool.spent)));
   const scores=await tx.q(`SELECT room_id,user_id,count(*)::int AS activity,sum(units)::int AS units,
    sum(base_units)::bigint AS base_units,sum(base_units::numeric*multiplier_ppm)::text AS effective_units
    FROM farm_contributions WHERE window_start=$1 AND voided_at IS NULL GROUP BY room_id,user_id ORDER BY room_id,user_id`,[w.starts_at]);
   const total=scores.reduce((s,r)=>s+r.activity,0),baseTotal=scores.reduce((s,r)=>s+number(r.base_units),0),participants=new Set(scores.map(s=>s.user_id)).size;
   const effectiveTotal=scores.reduce((sum,r)=>sum+BigInt(r.effective_units),0n);
   const release=releasedQuota(quota,participants,w.rule_version),rooms=new Map();let issued=0;
   for(const s of scores){
    const amount=w.rule_version===2?weightedAward(release,s.effective_units,baseTotal,effectiveTotal):Number(BigInt(quota)*BigInt(s.units)/(BigInt(total)*128n));
    issued+=amount;
    await tx.q(`INSERT INTO farm_awards(user_id,room_id,window_start,season,amount,activity,units,base_units,effective_units) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[s.user_id,s.room_id,w.starts_at,w.season,amount,s.activity,s.units,s.base_units,s.effective_units]);
    const r=rooms.get(s.room_id)||{activity:0,base:0,effective:0n,awarded:0,members:0};r.activity+=s.activity;r.base+=number(s.base_units);r.effective+=BigInt(s.effective_units);r.awarded+=amount;r.members++;rooms.set(s.room_id,r);
   }
   for(const [id,r] of rooms)await tx.q('INSERT INTO room_drops(window_start,room_id,base_budget,awarded,activity,active_members) VALUES($1,$2,$3,$4,$5,$6)',[w.starts_at,id,w.rule_version===2?weightedAward(release,r.effective,baseTotal,effectiveTotal):Number(BigInt(release)*BigInt(r.activity)/BigInt(total)),r.awarded,r.activity,r.members]);
   if(issued>release)fail(500,'Invalid farming allocation.');
   const changed=await tx.q('UPDATE farm_pools SET spent=spent+$2 WHERE id=$1 AND spent+$2<=budget RETURNING id',[w.season,issued]);
   if(!changed.length)fail(409,'The farming fund limit has been reached.');
   await tx.q('UPDATE farm_windows SET awarded=$2,settled_at=clock_timestamp(),released_budget=$3,eligible_participants=$4,base_activity_units=$5 WHERE starts_at=$1',[w.starts_at,issued,release,participants,baseTotal]);
  }
  await qualifyFarmers(tx);
  return {settled:windows.length};
 });
}
export async function reserveLegacyReward(tx,season,amount){
 if(!['season-1','season-2'].includes(season))return;
 const rows=await tx.q('UPDATE farm_pools SET spent=spent+$2 WHERE id=$1 AND spent+$2<=budget RETURNING id',[season,amount]);
 if(!rows.length)fail(409,'The farming fund limit has been reached.');
}
// Estimates and settlement use the same denominator, including stacked NFT weights.
export async function currentActivity(db,userId,w,roomId=null){
 const zero={eligible:0,rooms:0,units:0,global:0,participants:0,base:0,globalBase:0,effective:0,total:0,members:0,own:0,used:0,weight:0,effectiveWeight:0,estimate:0,baseBudget:0,releasedBudget:0};
 if(!w)return zero;
 const [a]=await db.q(`SELECT count(*)::int AS global,count(DISTINCT user_id)::int AS participants,COALESCE(sum(base_units),0)::bigint AS global_base,
 COALESCE(sum(base_units::numeric*multiplier_ppm),0)::text AS global_effective,
 count(*) FILTER(WHERE user_id=$2 AND ($3::uuid IS NULL OR room_id=$3))::int AS eligible,
 count(DISTINCT room_id) FILTER(WHERE user_id=$2 AND ($3::uuid IS NULL OR room_id=$3))::int AS rooms,
 COALESCE(sum(units) FILTER(WHERE user_id=$2 AND ($3::uuid IS NULL OR room_id=$3)),0)::int AS units,
 COALESCE(sum(base_units) FILTER(WHERE user_id=$2 AND ($3::uuid IS NULL OR room_id=$3)),0)::bigint AS base,
 COALESCE(sum(base_units::numeric*multiplier_ppm) FILTER(WHERE user_id=$2 AND ($3::uuid IS NULL OR room_id=$3)),0)::text AS effective,
 count(*) FILTER(WHERE room_id=$3)::int AS total,count(DISTINCT user_id) FILTER(WHERE room_id=$3)::int AS members,
 COALESCE(sum(base_units) FILTER(WHERE room_id=$3),0)::bigint AS room_base,
 COALESCE(sum(base_units::numeric*multiplier_ppm) FILTER(WHERE room_id=$3),0)::text AS room_effective
 FROM farm_contributions WHERE window_start=$1 AND voided_at IS NULL`,[w.startsAt,userId,roomId]);
 const [used]=await db.q('SELECT count(*)::int AS n FROM farm_contributions WHERE window_start=$1 AND user_id=$2',[w.startsAt,userId]);
 const [pool]=await db.q('SELECT budget-spent AS remaining FROM farm_pools WHERE id=$1',[w.season]);
 const release=releasedQuota(Math.min(w.budget,Math.max(0,number(pool.remaining))),a.participants,w.ruleVersion);
 const estimate=w.ruleVersion===2?weightedAward(release,a.effective,a.global_base,a.global_effective):a.global?Number(BigInt(release)*BigInt(a.units)/(BigInt(a.global)*128n)):0;
 const denominator=w.ruleVersion===2?number(a.global_base):a.global,numerator=w.ruleVersion===2?number(a.room_base):a.total;
 return {...zero,...a,base:number(a.base),effective:number(a.effective),effectiveUnits:String(a.effective),globalEffectiveUnits:String(a.global_effective),globalBase:number(a.global_base),own:a.eligible,used:used.n,weight:number(a.base)/128,effectiveWeight:w.ruleVersion===2?number(a.effective)/128/MULTIPLIER_SCALE:a.units/128,estimate,releasedBudget:release,baseBudget:w.ruleVersion===2?weightedAward(release,a.room_effective,a.global_base,a.global_effective):denominator?Number(BigInt(release)*BigInt(numerator)/BigInt(denominator)):0};
}
export async function farmingOverview(db,user){
 const now=await clock(db),[campaign]=await db.q('SELECT farmers FROM farm_state WHERE id=1');
 const pools=await db.q('SELECT id,budget,spent,starts_at,ends_at FROM farm_pools ORDER BY id');
 const current=(await db.q('SELECT * FROM farm_windows WHERE starts_at<=$1 AND ends_at>$1',[iso(now)]))[0]||null;
 const [transition]=await db.q('SELECT starts_at,announced_at FROM farm_rule_versions WHERE version=2');
 const [qualified]=await db.q('SELECT count(*)::int AS n FROM farm_farmers WHERE qualified_at IS NOT NULL');
 const legacyReached=await db.q('SELECT threshold FROM farm_milestones ORDER BY threshold');
 const version=current?.rule_version||(now>=new Date(transition.starts_at)?2:1);
 const [snapshot]=user&&version===2&&current?await db.q('SELECT multiplier_ppm::text FROM farm_account_rounds WHERE window_start=$1 AND user_id=$2',[current.starts_at,user.id]):[];
 const coefficient=String(snapshot?.multiplier_ppm||MULTIPLIER_SCALE);
 const reached=version===2?milestones.filter(n=>n<=qualified.n):legacyReached.map(r=>r.threshold);
 const history=user?await db.q(`SELECT a.id,a.amount,a.activity,a.window_start,w.ends_at,a.season,r.name AS room_name
 FROM farm_awards a JOIN farm_windows w ON w.starts_at=a.window_start JOIN rooms r ON r.id=a.room_id
 WHERE a.user_id=$1 ORDER BY a.window_start DESC,a.room_id LIMIT 10`,[user.id]):[];
 const [balance]=user?await db.q(`SELECT COALESCE(sum(amount) FILTER(WHERE season=$2),0)::bigint AS points,COALESCE(sum(amount),0)::bigint AS all_points FROM reward_ledger WHERE user_id=$1`,[user.id,current?.season||calendar(now).season]):[];
 return {serverNow:iso(now),status:current?'active':iso(now)<'2026-11-01T00:00:00.000Z'?'upcoming':'ended',startsAt:'2026-11-01T00:00:00.000Z',endsAt:'2026-12-25T00:00:00.000Z',
  current:current?{startsAt:iso(current.starts_at),endsAt:iso(current.ends_at),budget:number(current.budget),season:current.season,ruleVersion:version}:null,
  farmers:campaign.farmers,qualifiedFarmers:qualified.n,retention:version===2?number(coefficient)/MULTIPLIER_SCALE:retentionUnits(reached)/128,coefficientPPM:version===2?coefficient:null,
  milestones:milestones.map(n=>({threshold:n,reached:reached.includes(n),nftAvailable:false})),
  nftStatus:'planned',nftPolicy,nftNetwork:'Robinhood',eventReductionsEnabled:version===1,rules:version===2?fairRules:legacyRules,
  policy:{version:2,effectiveAt:iso(transition.starts_at),announcedAt:iso(transition.announced_at),...fairRules},
  pools:pools.map(p=>({id:p.id,budget:number(p.budget),spent:number(p.spent),remaining:number(p.budget)-number(p.spent)})),
  balance:balance?{points:number(balance.points),all_points:number(balance.all_points)}:null,
  history:history.map(r=>({...r,amount:number(r.amount)}))};
}
export async function roomFarming(db,user,id){
 uuid(id);if(!user?.x_id)fail(401,'Sign in with X to view room farming.');
 const [member]=await db.q('SELECT 1 FROM room_members m JOIN rooms r ON r.id=m.room_id WHERE m.room_id=$1 AND m.user_id=$2 AND r.archived_at IS NULL',[id,user.id]);
 if(!member)fail(403,'Join this room to view its farming activity.');
 const overview=await farmingOverview(db,user),w=overview.current,activity=await currentActivity(db,user.id,w,id);
 const leaders=w?await db.q(`SELECT u.id,u.name,count(*)::int AS activity,sum(c.base_units)::int AS base FROM farm_contributions c JOIN users u ON u.id=c.user_id
   WHERE c.room_id=$1 AND c.window_start=$2 AND c.voided_at IS NULL GROUP BY u.id,u.name ORDER BY base DESC,u.id LIMIT 10`,[id,w.startsAt]):[];
 const drops=await db.q(`SELECT d.*,w.ends_at,(SELECT COALESCE(sum(amount),0) FROM farm_awards WHERE room_id=d.room_id AND window_start=d.window_start AND user_id=$2)::bigint AS own
 FROM room_drops d JOIN farm_windows w ON w.starts_at=d.window_start WHERE d.room_id=$1 ORDER BY d.window_start DESC LIMIT 5`,[id,user.id]);
 return {...overview,room:{id,activity,leaders,baseBudget:activity.baseBudget,estimate:activity.estimate,drops:drops.map(d=>({...d,base_budget:number(d.base_budget),awarded:number(d.awarded),own:number(d.own)}))}};
}
export async function farmingAdmin(db){
 const overview=await farmingOverview(db,null);
 const windows=await db.q(`SELECT w.*,(SELECT count(*)::int FROM room_drops WHERE window_start=w.starts_at) AS rooms,
 (SELECT count(DISTINCT user_id)::int FROM farm_awards WHERE window_start=w.starts_at) AS recipients
 FROM farm_windows w WHERE w.settled_at IS NOT NULL ORDER BY w.starts_at DESC LIMIT 12`);
 const awards=await db.q(`SELECT a.id,a.user_id,a.room_id,a.window_start,a.amount,a.activity,a.season,u.name,u.x_username,r.name AS room_name
 FROM farm_awards a JOIN users u ON u.id=a.user_id JOIN rooms r ON r.id=a.room_id ORDER BY a.created_at DESC,a.id LIMIT 100`);
 const [scheduler]=await db.q(`SELECT s.*,(SELECT count(*)::int FROM farm_windows WHERE settled_at IS NULL AND ends_at<=clock_timestamp()) AS pending_rounds FROM farm_scheduler_state s WHERE id=1`);
 return {...overview,scheduler,windows:windows.map(w=>({...w,budget:number(w.budget),released_budget:w.released_budget===null?null:number(w.released_budget),awarded:number(w.awarded)})),awards:awards.map(a=>({...a,amount:number(a.amount)}))};
}
