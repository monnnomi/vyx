import {fail} from './http.js';
import {halloween} from './events.js';

export function isAdmin(user){
 const ids=(process.env.VYX_ADMIN_X_IDS||'').split(',').map(x=>x.trim()).filter(Boolean);
 return Boolean(user?.x_id&&!user.is_system&&ids.includes(user.x_id));
}
export function requireAdmin(user){if(!user)fail(401,'Sign in with your administrator X account.');if(!isAdmin(user))fail(403,'This account does not have administrator access.');}
export async function adminOverview(db,user,params={}){
 requireAdmin(user);
 const query=String(params.query||'').trim().slice(0,100),filter=params.filter||'all';
 if(!['all','minted','not-minted','online'].includes(filter))fail(400,'Invalid filter.');
 const page=Number(params.page||1);if(!Number.isInteger(page)||page<1||page>100000)fail(400,'Invalid page.');
 const [counts]=await db.q(`SELECT
 (SELECT count(*)::int FROM users WHERE x_id IS NOT NULL AND NOT is_system) AS connected,
 (SELECT count(*)::int FROM event_mints WHERE campaign_id=$1) AS minted,
 (SELECT count(DISTINCT user_id)::int FROM presence_sessions WHERE user_id IS NOT NULL AND last_seen_at>clock_timestamp()-interval '90 seconds') AS online_members,
 (SELECT count(*)::int FROM presence_sessions WHERE user_id IS NULL AND last_seen_at>clock_timestamp()-interval '90 seconds') AS online_guests,
 (SELECT count(*)::int FROM users WHERE x_id IS NOT NULL AND NOT is_system AND created_at>=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS connected_today,
 (SELECT count(*)::int FROM event_mints WHERE campaign_id=$1 AND minted_at>=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS minted_today,
 clock_timestamp() AS server_now`,[halloween.id]);
 const rows=await db.q(`SELECT u.id,u.x_id,u.x_username,u.name,u.handle,u.avatar_url,u.created_at,
 u.last_login_at,u.login_count,u.last_seen_at,m.id AS mint_id,m.minted_at,
 EXISTS(SELECT 1 FROM presence_sessions p WHERE p.user_id=u.id AND p.last_seen_at>clock_timestamp()-interval '90 seconds') AS online,
 count(*) OVER()::int AS filtered_total
 FROM users u LEFT JOIN event_mints m ON m.user_id=u.id AND m.campaign_id=$1
 WHERE u.x_id IS NOT NULL AND NOT u.is_system
 AND ($2='' OR u.name ILIKE $3 OR u.x_username ILIKE $3 OR u.handle ILIKE $3 OR u.x_id=$2)
 AND ($4='all' OR ($4='minted' AND m.id IS NOT NULL) OR ($4='not-minted' AND m.id IS NULL)
 OR ($4='online' AND EXISTS(SELECT 1 FROM presence_sessions p WHERE p.user_id=u.id AND p.last_seen_at>clock_timestamp()-interval '90 seconds')))
 ORDER BY u.created_at DESC,u.id LIMIT 50 OFFSET $5`,[halloween.id,query,'%'+query+'%',filter,(page-1)*50]);
 const total=rows[0]?.filtered_total||0;
 return {admin:{name:user.name,x_username:user.x_username},counts:{...counts,online:counts.online_members+counts.online_guests,not_minted:Math.max(0,counts.connected-counts.minted)},
  event:halloween,users:rows.map(({filtered_total,...row})=>row),pagination:{page,pageSize:50,total,pages:Math.max(1,Math.ceil(total/50))},onlineWindowSeconds:90};
}
