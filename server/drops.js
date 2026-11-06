import {fail} from './http.js';
import {settleDueWindows,farmingOverview,currentActivity} from './farming.js';

const iso=d=>new Date(d).toISOString();
function timestamp(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(value)||!Number.isFinite(Date.parse(value)))fail(400,'Invalid round.');
 return iso(value);
}
function signedIn(user){if(!user?.x_id)fail(401,'Sign in with X to view your drops.');}
// Results are reconstructed from the immutable server ledger, including old rounds.
// A reveal receipt has no connection to allocation or the point balance.
export async function dropResults(db,user,{before=null}={}){
 signedIn(user);
 if(before)before=timestamp(before);
 await settleDueWindows(db);
 const overview=await farmingOverview(db,user);
 const rows=await db.q(`SELECT w.starts_at,w.ends_at,w.season,w.settled_at,w.budget,w.awarded,w.rule_version,w.released_budget,w.eligible_participants,
  sum(a.amount)::bigint AS amount,sum(a.activity)::int AS activity,count(*)::int AS rooms,v.revealed_at
 FROM farm_awards a JOIN farm_windows w ON w.starts_at=a.window_start
 LEFT JOIN drop_reveals v ON v.window_start=w.starts_at AND v.user_id=a.user_id
 WHERE a.user_id=$1 AND w.settled_at IS NOT NULL AND ($2::timestamptz IS NULL OR w.starts_at<$2)
 GROUP BY w.starts_at,v.revealed_at ORDER BY w.starts_at DESC LIMIT 21`,[user.id,before]);
 const [summary]=await db.q(`SELECT COALESCE(sum(a.amount),0)::bigint AS total,
 COALESCE(sum(a.amount) FILTER(WHERE w.ends_at>=(date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')),0)::bigint AS today,
 count(DISTINCT a.window_start) FILTER(WHERE v.revealed_at IS NULL)::int AS unopened,
 max(a.window_start) FILTER(WHERE v.revealed_at IS NULL) AS next_unopened
 FROM farm_awards a JOIN farm_windows w ON w.starts_at=a.window_start
 LEFT JOIN drop_reveals v ON v.user_id=a.user_id AND v.window_start=a.window_start
 WHERE a.user_id=$1 AND w.settled_at IS NOT NULL`,[user.id]);
 const current=overview.current;
 const activity=await currentActivity(db,user.id,current);
 const [pending]=await db.q(`SELECT count(DISTINCT c.window_start)::int AS rounds FROM farm_contributions c
 JOIN farm_windows w ON w.starts_at=c.window_start WHERE c.user_id=$1 AND c.voided_at IS NULL
 AND w.ends_at<=clock_timestamp() AND w.settled_at IS NULL`,[user.id]);
 const results=rows.slice(0,20).map(w=>({id:iso(w.starts_at),endsAt:iso(w.ends_at),season:w.season,status:'FINALIZED',
  ruleVersion:w.rule_version,releasedBudget:Number(w.released_budget??w.budget),participants:w.eligible_participants,amount:Number(w.amount),activity:w.activity,rooms:w.rooms,finalizedAt:iso(w.settled_at),revealedAt:w.revealed_at?iso(w.revealed_at):null}));
 return {serverNow:overview.serverNow,policy:overview.policy,current:current?{...current,status:'ACTIVE'}:null,balance:overview.balance,
  summary:{total:Number(summary.total),today:Number(summary.today),unopened:summary.unopened,pending:pending.rounds},activity,
  estimate:activity.estimate,
  results,nextUnopened:summary.next_unopened?iso(summary.next_unopened):null,nextBefore:rows.length>20?results.at(-1).id:null};
}
export async function dropResult(db,user,id){
 signedIn(user);id=timestamp(id);
 const rows=await db.q(`SELECT a.amount,a.activity,a.units,a.base_units,a.effective_units,r.id AS room_id,r.name AS room_name,
 w.starts_at,w.ends_at,w.settled_at,w.season,w.rule_version,w.budget,w.released_budget,w.eligible_participants,v.revealed_at,
 d.activity AS room_activity,d.active_members
 FROM farm_awards a JOIN farm_windows w ON w.starts_at=a.window_start
 JOIN rooms r ON r.id=a.room_id JOIN room_drops d ON d.window_start=a.window_start AND d.room_id=a.room_id
 LEFT JOIN drop_reveals v ON v.user_id=a.user_id AND v.window_start=a.window_start
 WHERE a.user_id=$1 AND a.window_start=$2 AND w.settled_at IS NOT NULL ORDER BY a.amount DESC,a.room_id`,[user.id,id]);
 if(!rows.length)fail(404,'No finalized result for this account and round.');
 const w=rows[0];return {id,endsAt:iso(w.ends_at),season:w.season,status:'FINALIZED',finalizedAt:iso(w.settled_at),
  ruleVersion:w.rule_version,releasedBudget:Number(w.released_budget??w.budget),maxBudget:Number(w.budget),participants:w.eligible_participants,
  weight:rows.reduce((n,r)=>n+Number(r.base_units||0)/128,0),effectiveWeight:rows.reduce((n,r)=>n+Number(r.effective_units||0)/128/1000000,0),
  revealedAt:w.revealed_at?iso(w.revealed_at):null,amount:rows.reduce((n,r)=>n+Number(r.amount),0),activity:rows.reduce((n,r)=>n+r.activity,0),
  rooms:rows.map(r=>({id:r.room_id,name:r.room_name,amount:Number(r.amount),activity:r.activity,weight:Number(r.base_units||0)/128,roomActivity:r.room_activity,activeMembers:r.active_members}))};
}
export async function revealDrop(db,user,id){
 const result=await dropResult(db,user,id);
 const [receipt]=await db.q(`INSERT INTO drop_reveals(user_id,window_start) VALUES($1,$2)
 ON CONFLICT(user_id,window_start) DO UPDATE SET revealed_at=drop_reveals.revealed_at RETURNING revealed_at`,[user.id,result.id]);
 return {...result,revealedAt:iso(receipt.revealed_at)};
}
export async function notifications(db,user){
 signedIn(user);
 const [state]=await db.q('SELECT seen_at FROM inbox_state WHERE user_id=$1',[user.id]);
 const items=await db.q(`SELECT * FROM (
 SELECT 'drop:'||w.starts_at::text AS id,'system' AS category,'drop' AS kind,
  'Your room drop is ready' AS title,sum(a.amount)::text||' VP recorded across '||count(*)::text||' room(s).' AS body,
  w.settled_at AS created_at,w.starts_at::text AS target FROM farm_awards a JOIN farm_windows w ON w.starts_at=a.window_start
  WHERE a.user_id=$1 AND w.settled_at IS NOT NULL GROUP BY w.starts_at
 UNION ALL
 SELECT 'follow:'||f.follower_id::text,'social','follow',u.name||' followed you','A new connection in your circle.',f.created_at,u.id::text
 FROM follows f JOIN users u ON u.id=f.follower_id WHERE f.following_id=$1 AND NOT u.is_system
 UNION ALL
 SELECT 'comment:'||c.id::text,'social','comment',u.name||' commented on your post',left(c.body,160),c.created_at,c.post_id::text
 FROM comments c JOIN posts p ON p.id=c.post_id JOIN users u ON u.id=c.user_id WHERE p.user_id=$1 AND c.user_id<>$1
 UNION ALL
 SELECT 'mention:'||m.id::text,'social','room-mention',u.name||' mentioned you in '||r.name,left(m.body,160),m.created_at,r.id::text
 FROM room_mentions n JOIN room_messages m ON m.id=n.message_id JOIN rooms r ON r.id=m.room_id
 JOIN users u ON u.id=m.sender_id JOIN room_members rm ON rm.room_id=r.id AND rm.user_id=n.user_id
 WHERE n.user_id=$1 AND m.deleted_at IS NULL AND r.archived_at IS NULL
 ) n ORDER BY created_at DESC,id LIMIT 50`,[user.id]);
 return {items:items.map(n=>({...n,created_at:iso(n.created_at),unread:!state||new Date(n.created_at)>new Date(state.seen_at)})),limit:50};
}
export async function readNotifications(db,user){
 signedIn(user);await db.q(`INSERT INTO inbox_state(user_id,seen_at) VALUES($1,clock_timestamp())
 ON CONFLICT(user_id) DO UPDATE SET seen_at=EXCLUDED.seen_at`,[user.id]);return {ok:true};
}
