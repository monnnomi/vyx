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
