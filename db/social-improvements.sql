
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
