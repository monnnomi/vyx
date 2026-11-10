CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), x_id text UNIQUE,
 x_username text NOT NULL DEFAULT '', handle text UNIQUE NOT NULL,
 name text NOT NULL, bio text NOT NULL DEFAULT '', avatar_url text NOT NULL DEFAULT '',
 is_system boolean NOT NULL DEFAULT false, profile_completed boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS oauth_attempts (
 state_hash text PRIMARY KEY, cookie_hash text NOT NULL, verifier text NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS posts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
 body text NOT NULL CHECK(length(body) BETWEEN 20 AND 1500), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS posts_date ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS posts_user_date ON posts(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS reactions (
 user_id uuid NOT NULL REFERENCES users(id), post_id uuid NOT NULL REFERENCES posts(id),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,post_id)
);
CREATE TABLE IF NOT EXISTS saved_posts (
 user_id uuid NOT NULL REFERENCES users(id), post_id uuid NOT NULL REFERENCES posts(id),
 PRIMARY KEY(user_id,post_id)
);
CREATE TABLE IF NOT EXISTS comments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
 post_id uuid NOT NULL REFERENCES posts(id), body text NOT NULL CHECK(length(body) BETWEEN 1 AND 500),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comments_post ON comments(post_id,created_at);
CREATE TABLE IF NOT EXISTS follows (
 follower_id uuid NOT NULL REFERENCES users(id), following_id uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(follower_id,following_id),
 CHECK(follower_id<>following_id)
);
CREATE TABLE IF NOT EXISTS messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sender_id uuid NOT NULL REFERENCES users(id),
 recipient_id uuid NOT NULL REFERENCES users(id), body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
 request_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(sender_id,request_id), CHECK(sender_id<>recipient_id)
);
CREATE INDEX IF NOT EXISTS messages_sender ON messages(sender_id,created_at DESC);
CREATE INDEX IF NOT EXISTS messages_recipient ON messages(recipient_id,created_at DESC);
CREATE TABLE IF NOT EXISTS rooms (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id),
 name text NOT NULL CHECK(length(name) BETWEEN 3 AND 48),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=240),
 request_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), archived_at timestamptz,
 UNIQUE(owner_id,request_id)
);
CREATE INDEX IF NOT EXISTS rooms_created ON rooms(created_at DESC,id DESC) WHERE archived_at IS NULL;
CREATE TABLE IF NOT EXISTS room_members (
 room_id uuid NOT NULL REFERENCES rooms(id), user_id uuid NOT NULL REFERENCES users(id),
 joined_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(room_id,user_id)
);
CREATE INDEX IF NOT EXISTS room_members_user ON room_members(user_id,room_id);
CREATE TABLE IF NOT EXISTS room_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 room_id uuid NOT NULL REFERENCES rooms(id), sender_id uuid NOT NULL REFERENCES users(id),
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000), request_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), deleted_at timestamptz,
 UNIQUE(sender_id,request_id)
);
CREATE INDEX IF NOT EXISTS room_messages_history ON room_messages(room_id,seq DESC) WHERE deleted_at IS NULL;
-- Backfill existing memberships once; later migrations must preserve read positions.
ALTER TABLE room_members ADD COLUMN IF NOT EXISTS last_read_seq bigint;
UPDATE room_members rm SET last_read_seq=COALESCE((SELECT max(seq) FROM room_messages WHERE room_id=rm.room_id),0)
WHERE last_read_seq IS NULL;
ALTER TABLE room_members ALTER COLUMN last_read_seq SET DEFAULT 0;
ALTER TABLE room_members ALTER COLUMN last_read_seq SET NOT NULL;
ALTER TABLE room_messages ADD COLUMN IF NOT EXISTS reply_to uuid REFERENCES room_messages(id);
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS pinned_message_id uuid REFERENCES room_messages(id);
CREATE TABLE IF NOT EXISTS room_mentions (
 message_id uuid NOT NULL REFERENCES room_messages(id), user_id uuid NOT NULL REFERENCES users(id),
 PRIMARY KEY(message_id,user_id)
);
CREATE INDEX IF NOT EXISTS room_mentions_user ON room_mentions(user_id,message_id);
CREATE TABLE IF NOT EXISTS activity_events (
 user_id uuid NOT NULL REFERENCES users(id), season text NOT NULL, day text NOT NULL,
 kind text NOT NULL, target text NOT NULL, PRIMARY KEY(user_id,season,day,kind,target)
);
CREATE TABLE IF NOT EXISTS quest_claims (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
 season text NOT NULL, quest text NOT NULL, period text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,season,quest,period)
);
CREATE TABLE IF NOT EXISTS chests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
 claim_id uuid NOT NULL UNIQUE REFERENCES quest_claims(id), season text NOT NULL,
 tier integer NOT NULL CHECK(tier BETWEEN 0 AND 3), opened_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chests_user ON chests(user_id,season,opened_at);
ALTER TABLE chests ADD COLUMN IF NOT EXISTS campaign_id text;
CREATE UNIQUE INDEX IF NOT EXISTS chests_campaign_once ON chests(user_id,campaign_id) WHERE campaign_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS point_ledger (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
 season text NOT NULL, chest_id uuid UNIQUE NOT NULL REFERENCES chests(id),
 amount integer NOT NULL CHECK(amount BETWEEN 20 AND 5000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS points_user_season ON point_ledger(user_id,season);
CREATE TABLE IF NOT EXISTS open_receipts (
 user_id uuid NOT NULL REFERENCES users(id), request_id uuid NOT NULL,
 chest_id uuid NOT NULL REFERENCES chests(id), amount integer NOT NULL,
 PRIMARY KEY(user_id,request_id)
);
CREATE TABLE IF NOT EXISTS rate_limits (
 bucket text NOT NULL, window_start bigint NOT NULL, count integer NOT NULL,
 PRIMARY KEY(bucket,window_start)
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
ALTER TABLE oauth_attempts ADD COLUMN IF NOT EXISTS return_to text NOT NULL DEFAULT '/';
ALTER TABLE users ADD COLUMN IF NOT EXISTS login_count integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
UPDATE users u SET last_login_at=s.last_login,login_count=s.logins
FROM (SELECT user_id,max(created_at) AS last_login,count(*)::int AS logins FROM sessions GROUP BY user_id) s
WHERE u.id=s.user_id AND u.last_login_at IS NULL AND u.login_count=0;
CREATE TABLE IF NOT EXISTS event_mints (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id text NOT NULL,
 user_id uuid NOT NULL REFERENCES users(id), x_id text NOT NULL CHECK(length(x_id)>0),
 minted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(campaign_id,x_id), UNIQUE(campaign_id,user_id)
);
CREATE INDEX IF NOT EXISTS event_mints_time ON event_mints(campaign_id,minted_at DESC);
CREATE TABLE IF NOT EXISTS presence_sessions (
 token_hash text PRIMARY KEY, user_id uuid REFERENCES users(id),
 last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(), page text NOT NULL DEFAULT 'feed'
);
CREATE INDEX IF NOT EXISTS presence_active ON presence_sessions(last_seen_at DESC);
ALTER TABLE point_ledger ADD COLUMN IF NOT EXISTS voided_at timestamptz;
ALTER TABLE point_ledger ADD COLUMN IF NOT EXISTS void_reason text;
-- Preserve earlier Halloween claims as collectibles and retain their audit trail.
INSERT INTO event_mints(campaign_id,user_id,x_id,minted_at)
SELECT c.campaign_id,c.user_id,u.x_id,c.created_at FROM chests c JOIN users u ON u.id=c.user_id
WHERE c.campaign_id='halloween-2026' AND u.x_id IS NOT NULL AND NOT u.is_system
ON CONFLICT DO NOTHING;
UPDATE point_ledger l SET voided_at=clock_timestamp(),void_reason='Halloween mint is a collectible without VP'
FROM chests c WHERE c.id=l.chest_id AND c.campaign_id='halloween-2026' AND l.voided_at IS NULL;
INSERT INTO users (handle,name,bio,is_system)
VALUES ('vyx.club','VYX Club','Official VYX updates. Your circle. Your season.',true)
ON CONFLICT(handle) DO NOTHING;
INSERT INTO posts (user_id,body)
SELECT id, 'Welcome to VYX. Your presence matters. Your contribution counts. Meet your people, join a room and share thoughtful messages. Four-hour room drops record your eligible activity in VP. #VYX'
FROM users WHERE handle='vyx.club' AND NOT EXISTS (
 SELECT 1 FROM posts WHERE user_id=users.id
);

-- Room farming: one campaign budget, fixed UTC windows, immutable payout receipts.
CREATE TABLE IF NOT EXISTS farm_state (
 id integer PRIMARY KEY CHECK(id=1), farmers integer NOT NULL DEFAULT 0 CHECK(farmers>=0)
);
INSERT INTO farm_state(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS farm_pools (
 id text PRIMARY KEY, budget bigint NOT NULL CHECK(budget>0),
 spent bigint NOT NULL DEFAULT 0 CHECK(spent>=0 AND spent<=budget),
 starts_at timestamptz, ends_at timestamptz
);
INSERT INTO farm_pools(id,budget,spent,starts_at,ends_at) VALUES
 ('season-1',350000000,(SELECT COALESCE(sum(amount),0) FROM point_ledger WHERE season='season-1' AND voided_at IS NULL),'2026-11-01T00:00:00Z','2026-12-01T00:00:00Z'),
 ('season-2',350000000,(SELECT COALESCE(sum(amount),0) FROM point_ledger WHERE season='season-2' AND voided_at IS NULL),'2026-12-01T00:00:00Z','2026-12-25T00:00:00Z'),
 ('promotions',300000000,0,NULL,NULL)
 ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS farm_windows (
 starts_at timestamptz PRIMARY KEY, ends_at timestamptz NOT NULL,
 season text NOT NULL REFERENCES farm_pools(id), budget bigint NOT NULL CHECK(budget>=0),
 awarded bigint NOT NULL DEFAULT 0 CHECK(awarded>=0 AND awarded<=budget), settled_at timestamptz
);
INSERT INTO farm_windows(starts_at,ends_at,season,budget)
SELECT p.starts_at+n*interval '4 hours',p.starts_at+(n+1)*interval '4 hours',p.id,
 floor(p.budget::numeric*(n+1)/(extract(epoch FROM(p.ends_at-p.starts_at))/14400))::bigint-
 floor(p.budget::numeric*n/(extract(epoch FROM(p.ends_at-p.starts_at))/14400))::bigint
FROM farm_pools p CROSS JOIN LATERAL generate_series(0,(extract(epoch FROM(p.ends_at-p.starts_at))/14400)::int-1) n
WHERE p.starts_at IS NOT NULL ON CONFLICT DO NOTHING;
CREATE INDEX IF NOT EXISTS farm_windows_due ON farm_windows(ends_at) WHERE settled_at IS NULL;
CREATE TABLE IF NOT EXISTS farm_farmers (
 user_id uuid PRIMARY KEY REFERENCES users(id), x_id text UNIQUE NOT NULL,
 activated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS farm_milestones (
 threshold integer PRIMARY KEY CHECK(threshold IN(100,250,500,1000,2000,5000,10000)),
 activated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS farm_contributions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 message_id uuid NOT NULL UNIQUE REFERENCES room_messages(id), room_id uuid NOT NULL REFERENCES rooms(id),
 user_id uuid NOT NULL REFERENCES users(id), window_start timestamptz NOT NULL REFERENCES farm_windows(starts_at),
 content_hash text NOT NULL, slot bigint NOT NULL, units integer NOT NULL CHECK(units BETWEEN 1 AND 128),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), voided_at timestamptz,
 UNIQUE(user_id,content_hash), UNIQUE(user_id,slot)
);
CREATE INDEX IF NOT EXISTS farm_contributions_window ON farm_contributions(window_start,room_id,user_id) WHERE voided_at IS NULL;
CREATE INDEX IF NOT EXISTS farm_contributions_user_time ON farm_contributions(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS room_drops (
 window_start timestamptz NOT NULL REFERENCES farm_windows(starts_at), room_id uuid NOT NULL REFERENCES rooms(id),
 base_budget bigint NOT NULL CHECK(base_budget>=0), awarded bigint NOT NULL CHECK(awarded>=0),
 activity integer NOT NULL CHECK(activity>0), active_members integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(window_start,room_id)
);
CREATE TABLE IF NOT EXISTS farm_awards (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
 room_id uuid NOT NULL REFERENCES rooms(id), window_start timestamptz NOT NULL REFERENCES farm_windows(starts_at),
 season text NOT NULL REFERENCES farm_pools(id), amount bigint NOT NULL CHECK(amount>=0),
 activity integer NOT NULL CHECK(activity>0), units integer NOT NULL CHECK(units>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(window_start,room_id,user_id)
);
CREATE INDEX IF NOT EXISTS farm_awards_user ON farm_awards(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS drop_reveals (
 user_id uuid NOT NULL REFERENCES users(id), window_start timestamptz NOT NULL REFERENCES farm_windows(starts_at),
 revealed_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(user_id,window_start)
);
CREATE TABLE IF NOT EXISTS inbox_state (
 user_id uuid PRIMARY KEY REFERENCES users(id), seen_at timestamptz NOT NULL
);
CREATE OR REPLACE VIEW reward_ledger AS
 SELECT id,user_id,season,amount::bigint,created_at,'chest'::text AS source,chest_id,
 NULL::uuid AS room_id,NULL::timestamptz AS window_start
 FROM point_ledger WHERE voided_at IS NULL
 UNION ALL
 SELECT id,user_id,season,amount,created_at,'room-drop'::text,NULL::uuid,room_id,window_start
 FROM farm_awards;

-- Refresh only the original system-authored welcome copy, never member posts.
UPDATE posts SET body='Welcome to VYX. Your presence matters. Your contribution counts. Meet your people, join a room and share thoughtful messages. Four-hour room drops record your eligible activity in VP. #VYX'
WHERE user_id IN(SELECT id FROM users WHERE is_system AND handle='vyx.club')
AND body='Welcome to VYX ✦ Introduce yourself, find your people and make this season yours. Quests earn chests, and each chest holds a random number of VP. Early-access points are separate from future farming seasons. #VYX';

-- Fair room drops v2. Version boundaries preserve every previous contribution and receipt.
CREATE TABLE IF NOT EXISTS farm_rule_versions (
 version smallint PRIMARY KEY CHECK(version IN(1,2)), starts_at timestamptz NOT NULL UNIQUE,
 announced_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO farm_rule_versions(version,starts_at) VALUES(1,'2026-11-01T00:00:00Z') ON CONFLICT DO NOTHING;
-- At least eight hours of notice, then a UTC midnight boundary. Re-running never moves it.
INSERT INTO farm_rule_versions(version,starts_at)
VALUES(2,(date_trunc('day',(clock_timestamp()+interval '8 hours') AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')+interval '1 day')
ON CONFLICT DO NOTHING;
ALTER TABLE farm_windows ADD COLUMN IF NOT EXISTS rule_version smallint NOT NULL DEFAULT 1 CHECK(rule_version IN(1,2));
ALTER TABLE farm_windows ADD COLUMN IF NOT EXISTS released_budget bigint CHECK(released_budget>=0 AND released_budget<=budget);
ALTER TABLE farm_windows ADD COLUMN IF NOT EXISTS eligible_participants integer CHECK(eligible_participants>=0);
ALTER TABLE farm_windows ADD COLUMN IF NOT EXISTS base_activity_units bigint CHECK(base_activity_units>=0);
ALTER TABLE farm_contributions ADD COLUMN IF NOT EXISTS base_units integer NOT NULL DEFAULT 128 CHECK(base_units BETWEEN 1 AND 128);
ALTER TABLE farm_contributions ADD COLUMN IF NOT EXISTS multiplier_ppm numeric NOT NULL DEFAULT 1000000 CHECK(multiplier_ppm>=0 AND scale(multiplier_ppm)=0);
ALTER TABLE farm_contributions ADD COLUMN IF NOT EXISTS canonical_hash text;
ALTER TABLE farm_contributions ADD COLUMN IF NOT EXISTS similarity_tokens integer[];
CREATE UNIQUE INDEX IF NOT EXISTS farm_contributions_user_canonical ON farm_contributions(user_id,canonical_hash) WHERE canonical_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS farm_contributions_window_canonical ON farm_contributions(window_start,canonical_hash) WHERE canonical_hash IS NOT NULL AND voided_at IS NULL;
ALTER TABLE farm_awards ADD COLUMN IF NOT EXISTS base_units integer CHECK(base_units>=0);
ALTER TABLE farm_awards ADD COLUMN IF NOT EXISTS effective_units numeric CHECK(effective_units>=0 AND scale(effective_units)=0);
ALTER TABLE farm_farmers ADD COLUMN IF NOT EXISTS qualified_at timestamptz;
-- One immutable personal coefficient per round. Real on-chain ownership is not enabled.
CREATE TABLE IF NOT EXISTS farm_account_rounds (
 window_start timestamptz NOT NULL REFERENCES farm_windows(starts_at),user_id uuid NOT NULL REFERENCES users(id),
 multiplier_ppm numeric NOT NULL DEFAULT 1000000 CHECK(multiplier_ppm>=0 AND scale(multiplier_ppm)=0),
 owned_events integer[] NOT NULL DEFAULT '{}',snapshot_ref text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(window_start,user_id)
);
CREATE TABLE IF NOT EXISTS farm_scheduler_state (
 id integer PRIMARY KEY CHECK(id=1),last_started_at timestamptz,last_completed_at timestamptz,last_settled integer
);
INSERT INTO farm_scheduler_state(id) VALUES(1) ON CONFLICT DO NOTHING;
UPDATE farm_windows SET rule_version=2
WHERE starts_at>=(SELECT starts_at FROM farm_rule_versions WHERE version=2)
AND settled_at IS NULL AND NOT EXISTS(SELECT 1 FROM farm_contributions c WHERE c.window_start=farm_windows.starts_at);
UPDATE farm_farmers f SET qualified_at=clock_timestamp()
WHERE f.qualified_at IS NULL AND f.user_id IN (
 SELECT c.user_id FROM farm_contributions c JOIN farm_windows w ON w.starts_at=c.window_start
 WHERE c.voided_at IS NULL AND w.settled_at IS NOT NULL
 GROUP BY c.user_id HAVING count(DISTINCT (c.created_at AT TIME ZONE 'UTC')::date)>=3
);

-- Stackable NFT multipliers. Expand numeric storage without changing contributions or receipts.
ALTER TABLE farm_contributions DROP CONSTRAINT IF EXISTS farm_contributions_multiplier_ppm_check;
ALTER TABLE farm_contributions ALTER COLUMN multiplier_ppm TYPE numeric USING multiplier_ppm::numeric;
ALTER TABLE farm_contributions ADD CONSTRAINT farm_contributions_multiplier_ppm_check CHECK(multiplier_ppm>=0 AND scale(multiplier_ppm)=0);
ALTER TABLE farm_account_rounds DROP CONSTRAINT IF EXISTS farm_account_rounds_multiplier_ppm_check;
ALTER TABLE farm_account_rounds ALTER COLUMN multiplier_ppm TYPE numeric USING multiplier_ppm::numeric;
ALTER TABLE farm_account_rounds ADD CONSTRAINT farm_account_rounds_multiplier_ppm_check CHECK(multiplier_ppm>=0 AND scale(multiplier_ppm)=0);
ALTER TABLE farm_account_rounds ADD COLUMN IF NOT EXISTS nft_holdings jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(nft_holdings)='object');
ALTER TABLE farm_awards DROP CONSTRAINT IF EXISTS farm_awards_effective_units_check;
ALTER TABLE farm_awards ALTER COLUMN effective_units TYPE numeric USING effective_units::numeric;
ALTER TABLE farm_awards ADD CONSTRAINT farm_awards_effective_units_check CHECK(effective_units>=0 AND scale(effective_units)=0);

-- Photo and video attachments. File contents live in private object storage.
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_body_check;
ALTER TABLE posts ADD CONSTRAINT posts_body_check CHECK(length(body) BETWEEN 0 AND 1500);
ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_body_check;
ALTER TABLE comments ADD CONSTRAINT comments_body_check CHECK(length(body) BETWEEN 0 AND 500);
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_body_check;
ALTER TABLE messages ADD CONSTRAINT messages_body_check CHECK(length(body) BETWEEN 0 AND 2000);
ALTER TABLE room_messages DROP CONSTRAINT IF EXISTS room_messages_body_check;
ALTER TABLE room_messages ADD CONSTRAINT room_messages_body_check CHECK(length(body) BETWEEN 0 AND 2000);
ALTER TABLE posts ADD COLUMN IF NOT EXISTS request_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS posts_request ON posts(user_id,request_id) WHERE request_id IS NOT NULL;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS request_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS comments_request ON comments(user_id,request_id) WHERE request_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS media_state(id integer PRIMARY KEY CHECK(id=1));
INSERT INTO media_state(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS media_assets (
 id uuid PRIMARY KEY,owner_id uuid NOT NULL REFERENCES users(id),
 scope text NOT NULL CHECK(scope IN('post','comment','room','message')),target_id uuid,
 kind text NOT NULL CHECK(kind IN('image','video')),content_type text NOT NULL,
 byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 52428800),pathname text NOT NULL UNIQUE,storage_url text,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','ready','attached','rejected','deleting','deleted')),
 post_id uuid REFERENCES posts(id),comment_id uuid REFERENCES comments(id),room_message_id uuid REFERENCES room_messages(id),message_id uuid REFERENCES messages(id),
 position smallint NOT NULL DEFAULT 0 CHECK(position BETWEEN 0 AND 3),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '24 hours',uploaded_at timestamptz,
 CHECK(num_nonnulls(post_id,comment_id,room_message_id,message_id)<=1),
 CHECK((status='attached')=(num_nonnulls(post_id,comment_id,room_message_id,message_id)=1))
);
CREATE INDEX IF NOT EXISTS media_owner_time ON media_assets(owner_id,created_at DESC);
CREATE INDEX IF NOT EXISTS media_expiry ON media_assets(expires_at) WHERE status IN('pending','ready','deleting');
CREATE INDEX IF NOT EXISTS media_post ON media_assets(post_id,position) WHERE post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS media_comment ON media_assets(comment_id,position) WHERE comment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS media_room_message ON media_assets(room_message_id,position) WHERE room_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS media_message ON media_assets(message_id,position) WHERE message_id IS NOT NULL;

-- Bounded same-origin chunks bypass function request limits without browser-to-storage connections.
CREATE TABLE IF NOT EXISTS media_upload_parts (
 asset_id uuid NOT NULL REFERENCES media_assets(id),part_number smallint NOT NULL CHECK(part_number BETWEEN 1 AND 25),
 byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 2097152),pathname text NOT NULL UNIQUE,storage_url text NOT NULL,
 sha256 text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(asset_id,part_number)
);

-- Room discovery activity index.
CREATE INDEX IF NOT EXISTS room_messages_activity ON room_messages(created_at DESC,room_id,sender_id) WHERE deleted_at IS NULL;

-- Social discovery and member controls. Additive; reward ledgers are unchanged.
ALTER TABLE users ADD COLUMN IF NOT EXISTS interests text NOT NULL DEFAULT '';
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT '';
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS topic text NOT NULL DEFAULT '';
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS featured boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS member_controls (
 user_id uuid REFERENCES users(id), target_id uuid REFERENCES users(id),
 blocked boolean NOT NULL DEFAULT false, muted boolean NOT NULL DEFAULT false,
 PRIMARY KEY(user_id,target_id), CHECK(user_id<>target_id)
);
CREATE TABLE IF NOT EXISTS room_mutes (
 user_id uuid REFERENCES users(id), room_id uuid REFERENCES rooms(id), PRIMARY KEY(user_id,room_id)
);
CREATE TABLE IF NOT EXISTS notification_preferences (
 user_id uuid PRIMARY KEY REFERENCES users(id), follows boolean NOT NULL DEFAULT true,
 comments boolean NOT NULL DEFAULT true, mentions boolean NOT NULL DEFAULT true, drops boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS community_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reporter_id uuid REFERENCES users(id),
 kind text NOT NULL CHECK(kind IN ('user','post','comment','room','room-message','message')),
 target_id uuid NOT NULL, reason text NOT NULL, detail text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','dismissed')),
 created_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz,
 reviewed_by uuid REFERENCES users(id), resolution text NOT NULL DEFAULT '',
 UNIQUE(reporter_id,kind,target_id)
);
CREATE TABLE IF NOT EXISTS deletion_requests (
 user_id uuid PRIMARY KEY REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','reviewing','completed','cancelled')),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS product_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, event text NOT NULL,
 section text NOT NULL DEFAULT '', outcome text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_events_time_idx ON product_events(created_at);

CREATE TABLE IF NOT EXISTS message_reactions (
 user_id uuid NOT NULL REFERENCES users(id),
 room_message_id uuid REFERENCES room_messages(id) ON DELETE CASCADE,
 message_id uuid REFERENCES messages(id) ON DELETE CASCADE,
 emoji text NOT NULL CHECK(emoji IN ('❤️','👍','🔥','😂','👏','😮')),
 CHECK ((room_message_id IS NULL) <> (message_id IS NULL)),
 UNIQUE(user_id,room_message_id), UNIQUE(user_id,message_id)
);
CREATE INDEX IF NOT EXISTS message_reactions_room_idx ON message_reactions(room_message_id);
CREATE INDEX IF NOT EXISTS message_reactions_dm_idx ON message_reactions(message_id);

ALTER TABLE oauth_attempts ADD COLUMN IF NOT EXISTS inviter_id uuid REFERENCES users(id);
CREATE TABLE IF NOT EXISTS referrals (
 invitee_id uuid PRIMARY KEY REFERENCES users(id),
 inviter_id uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), CHECK(invitee_id<>inviter_id)
);
CREATE INDEX IF NOT EXISTS referrals_inviter_idx ON referrals(inviter_id,created_at);
-- X campaign verification. Tokens are short-lived, encrypted, and never returned to browsers.
ALTER TABLE oauth_attempts ADD COLUMN IF NOT EXISTS expected_x_id text;
CREATE TABLE IF NOT EXISTS x_task_access (
 user_id uuid PRIMARY KEY REFERENCES users(id), x_id text UNIQUE NOT NULL,
 sealed_token text NOT NULL, scopes text NOT NULL, expires_at timestamptz NOT NULL,
 connected_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS x_task_awards (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
 x_id text NOT NULL, task_id text NOT NULL, season text NOT NULL,
 amount integer NOT NULL CHECK(amount>0 AND amount<=2500), proof_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(user_id,task_id), UNIQUE(x_id,task_id)
);
CREATE INDEX IF NOT EXISTS x_task_awards_user ON x_task_awards(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS x_task_checks (
 user_id uuid NOT NULL REFERENCES users(id), task_id text NOT NULL,
 status text NOT NULL CHECK(status IN('not-verified','unavailable','verified')),
 detail text NOT NULL, checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(user_id,task_id)
);
CREATE TABLE IF NOT EXISTS x_task_runs (
 user_id uuid PRIMARY KEY REFERENCES users(id), locked_until timestamptz NOT NULL,
 checked_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS x_task_api_budget (
 day date PRIMARY KEY, reserved_cents integer NOT NULL CHECK(reserved_cents>=0)
);
CREATE OR REPLACE VIEW reward_ledger AS
 SELECT id,user_id,season,amount::bigint,created_at,'chest'::text AS source,chest_id,
 NULL::uuid AS room_id,NULL::timestamptz AS window_start
 FROM point_ledger WHERE voided_at IS NULL
 UNION ALL
 SELECT id,user_id,season,amount,created_at,'room-drop'::text,NULL::uuid,room_id,window_start FROM farm_awards
 UNION ALL
 SELECT id,user_id,season,amount::bigint,created_at,'x-task'::text,NULL::uuid,NULL::uuid,NULL::timestamptz FROM x_task_awards;

-- Unique message views and expanded reactions.
CREATE TABLE IF NOT EXISTS message_views (
 user_id uuid NOT NULL REFERENCES users(id),
 room_message_id uuid REFERENCES room_messages(id) ON DELETE CASCADE,
 message_id uuid REFERENCES messages(id) ON DELETE CASCADE,
 viewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK ((room_message_id IS NULL) <> (message_id IS NULL)),
 UNIQUE(user_id,room_message_id), UNIQUE(user_id,message_id)
);
CREATE INDEX IF NOT EXISTS message_views_room_idx ON message_views(room_message_id);
CREATE INDEX IF NOT EXISTS message_views_dm_idx ON message_views(message_id);

ALTER TABLE message_reactions DROP CONSTRAINT IF EXISTS message_reactions_emoji_check;
ALTER TABLE message_reactions ADD CONSTRAINT message_reactions_emoji_check
 CHECK(emoji IN ('❤️','👍','🔥','😂','👏','😮','🎉','🚀','💯','👀','🙏','🤝','😍','🤔','😎','🤣','😢','😭','😡','👎','💪','🥳','✅','⚡'));

-- Unique post views across feed, profiles and post details.
CREATE TABLE IF NOT EXISTS post_views (
 user_id uuid NOT NULL REFERENCES users(id),
 post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
 viewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(user_id,post_id)
);
CREATE INDEX IF NOT EXISTS post_views_post_idx ON post_views(post_id);

-- Recognition reads existing reactions; no reputation ledger or score table.
-- Read-time reputation: index existing likes without storing or backfilling a score.
CREATE INDEX IF NOT EXISTS reactions_post_reputation_idx ON reactions(post_id,user_id);
