import {fail} from './http.js';

export const halloween={
 id:'halloween-2026',name:'Halloween chest',
 startsAt:'2026-10-30T00:00:00.000Z',endsAt:'2026-11-01T00:00:00.000Z'
};
export async function halloweenState(db,user){
 const [clock]=await db.q('SELECT clock_timestamp() AS now');
 const current=new Date(clock.now);
 const [mint]=user?await db.q('SELECT id,minted_at FROM event_mints WHERE user_id=$1 AND campaign_id=$2',[user.id,halloween.id]):[];
 return {...halloween,serverNow:current.toISOString(),
  status:current<new Date(halloween.startsAt)?'upcoming':current>=new Date(halloween.endsAt)?'ended':'active',
  minted:Boolean(mint),mintId:mint?.id||null,mintedAt:mint?.minted_at||null};
}
export async function claimHalloween(tx,user){
 if(!user?.x_id||user.is_system)fail(403,'Connect your X account to mint this chest.');
 // Database time and the immutable X identity enforce the deadline and one mint
 // per account, including simultaneous requests from several devices.
 const [mint]=await tx.q(`INSERT INTO event_mints(user_id,x_id,campaign_id)
 SELECT $1,$2,$3 WHERE clock_timestamp()>=$4::timestamptz AND clock_timestamp()<$5::timestamptz
 ON CONFLICT DO NOTHING RETURNING id,minted_at`,[user.id,user.x_id,halloween.id,halloween.startsAt,halloween.endsAt]);
 if(!mint){
  const [existing]=await tx.q('SELECT id FROM event_mints WHERE campaign_id=$1 AND (x_id=$2 OR user_id=$3)',[halloween.id,user.x_id,user.id]);
  if(existing)fail(409,'You have already minted your Halloween chest.');
  fail(410,'The Halloween mint window is closed.');
 }
 return {id:mint.id,campaign_id:halloween.id,mintedAt:mint.minted_at};
}
