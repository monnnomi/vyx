// Discovery measures conversations, independently of VP and NFT multipliers.
// Retain seven days, halve weight every 24 hours, and reward participation
// across people and hours. Repeating a message does not refresh its weight.
export const roomActivitySQL=`
activity_clock AS (SELECT statement_timestamp() AS at),
activity_messages AS (
 SELECT m.room_id,m.sender_id,date_trunc('hour',min(m.created_at)) AS hour
 FROM room_messages m
 JOIN rooms r ON r.id=m.room_id AND r.archived_at IS NULL
 JOIN users sender ON sender.id=m.sender_id AND sender.x_id IS NOT NULL AND NOT sender.is_system
 CROSS JOIN activity_clock c
 WHERE m.deleted_at IS NULL AND m.created_at>=c.at-interval '7 days' AND m.created_at<=c.at
 GROUP BY m.room_id,m.sender_id,
  CASE WHEN btrim(m.body)<>'' THEN 'text:'||lower(regexp_replace(btrim(m.body),'[[:space:]]+',' ','g'))
   ELSE 'attachment:'||m.id::text END
),
activity_hours AS (
 SELECT room_id,sender_id,hour,count(*) AS messages
 FROM activity_messages GROUP BY room_id,sender_id,hour
),
room_activity AS (
 SELECT h.room_id,
  sum((1+ln(LEAST(h.messages,6)::double precision))*
   power(0.5::double precision,GREATEST(0,extract(epoch FROM (c.at-h.hour))/86400.0)::double precision)) AS score
 FROM activity_hours h CROSS JOIN activity_clock c GROUP BY h.room_id
)`;
