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
