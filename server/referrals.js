import {publicUser} from './config.js';
import {appURL} from './http.js';
export async function referralBoard(db,user){
 const rows=await db.q(`SELECT u.*,count(r.invitee_id)::int AS referral_count FROM users u LEFT JOIN referrals r ON r.inviter_id=u.id WHERE NOT u.is_system AND u.x_id IS NOT NULL GROUP BY u.id ORDER BY referral_count DESC,u.created_at ASC,u.id ASC`);
 const index=user?rows.findIndex(u=>u.id===user.id):-1;
 return {leaders:rows.slice(0,200).map((u,i)=>({...publicUser(u),referrals:u.referral_count,rank:i+1})),mine:index<0?null:{rank:index+1,count:rows[index].referral_count,url:appURL()+'/?ref='+user.id},total:rows.length};
}
