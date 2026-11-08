import {fail} from './http.js';

export const nftSelectionRules=Object.freeze({vp:50000,referrals:3,vpBasis:'lifetime-confirmed'});

// These expressions use only the internal users alias, never request input.
export const nftSelectionTotalsSQL=`SELECT
 COALESCE((SELECT sum(amount) FROM reward_ledger WHERE user_id=u.id),0)::bigint AS confirmed_vp,
 (SELECT count(*) FROM referrals WHERE inviter_id=u.id)::int AS invited_referrals`;

export function nftSelectionStatus(confirmedVP,invitedReferrals){
 const vp=Number(confirmedVP),referrals=Number(invitedReferrals);
 const vpRemaining=Math.max(0,nftSelectionRules.vp-vp),referralsRemaining=Math.max(0,nftSelectionRules.referrals-referrals);
 const tier=vpRemaining===0?(referralsRemaining===0?'free':'half-price'):'full-price';
 return {tier,discountPercent:tier==='free'?100:tier==='half-price'?50:0,
  confirmedVP:vp,invitedReferrals:referrals,vpRemaining,referralsRemaining,rules:nftSelectionRules};
}

export async function ownNftSelection(db,user){
 if(!user?.x_id||user.is_system)fail(401,'Sign in with X to see your NFT eligibility.');
 const [row]=await db.q(`SELECT nft.* FROM users u CROSS JOIN LATERAL (${nftSelectionTotalsSQL}) nft WHERE u.id=$1`,[user.id]);
 if(!row)fail(401,'Please sign in again.');
 return {...nftSelectionStatus(row.confirmed_vp,row.invited_referrals),checkedAt:new Date().toISOString()};
}

export async function nftWhitelist(db,{tier='all',page=1}={}){
 if(!['all','free','half-price'].includes(tier))fail(400,'Choose a valid whitelist.');
 page=Number(page);if(!Number.isInteger(page)||page<1||page>100000)fail(400,'Choose a valid page.');
 const [row]=await db.q(`WITH eligible AS (
  SELECT u.id,u.name,u.handle,u.avatar_url,u.created_at,
   CASE WHEN nft.invited_referrals>=${nftSelectionRules.referrals} THEN 'free' ELSE 'half-price' END AS tier
  FROM users u CROSS JOIN LATERAL (${nftSelectionTotalsSQL}) nft
  WHERE u.x_id IS NOT NULL AND NOT u.is_system AND nft.confirmed_vp>=${nftSelectionRules.vp}
 ), matching AS (SELECT * FROM eligible WHERE $1='all' OR tier=$1)
 SELECT (SELECT count(*)::int FROM eligible WHERE tier='free') AS free,
  (SELECT count(*)::int FROM eligible WHERE tier='half-price') AS half_price,
  (SELECT count(*)::int FROM matching) AS total,
  COALESCE((SELECT json_agg(p) FROM (
   SELECT id,name,handle,avatar_url,tier FROM matching
   ORDER BY (tier='free') DESC,created_at,id LIMIT 50 OFFSET $2
  ) p),'[]'::json) AS members`,[tier,(page-1)*50]);
 return {members:row.members,counts:{free:row.free,halfPrice:row.half_price,total:row.free+row.half_price},
  pagination:{page,pageSize:50,total:row.total,pages:Math.max(1,Math.ceil(row.total/50))},checkedAt:new Date().toISOString()};
}
