-- Additive, idempotent newsroom tables. No community or VP records are modified.
CREATE TABLE IF NOT EXISTS news_settings (
 id integer PRIMARY KEY CHECK(id=1), enabled boolean NOT NULL DEFAULT false,
 auto_publish boolean NOT NULL DEFAULT true, daily_budget_cents integer NOT NULL DEFAULT 100 CHECK(daily_budget_cents BETWEEN 0 AND 100),
 last_started_at timestamptz, last_completed_at timestamptz, last_status text NOT NULL DEFAULT 'waiting-for-sources',
 lease_until timestamptz, lease_token uuid, updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO news_settings(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS news_sources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), username text NOT NULL UNIQUE CHECK(username ~ '^[A-Za-z0-9_]{1,15}$'),
 x_user_id text CHECK(x_user_id ~ '^[0-9]{1,20}$'), enabled boolean NOT NULL DEFAULT true,
 archived boolean NOT NULL DEFAULT false, since_id text, pagination_token text, pending_since_id text,
 initial_start_at timestamptz NOT NULL DEFAULT (now()-interval '24 hours'), next_fetch_at timestamptz NOT NULL DEFAULT now(),
 last_fetched_at timestamptz, last_status text NOT NULL DEFAULT 'not-checked', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS news_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id uuid NOT NULL REFERENCES news_sources(id),
 x_post_id text NOT NULL UNIQUE CHECK(x_post_id ~ '^[0-9]{1,20}$'), source_url text NOT NULL,
 source_text text NOT NULL CHECK(length(source_text)<=8000), source_published_at timestamptz NOT NULL,
 content_hash text NOT NULL UNIQUE, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','review','rejected','published','withdrawn')),
 category text NOT NULL DEFAULT 'updates' CHECK(category IN ('updates','ecosystem','events','security','markets')),
 title_en text NOT NULL DEFAULT '', title_ru text NOT NULL DEFAULT '', summary_en text NOT NULL DEFAULT '', summary_ru text NOT NULL DEFAULT '',
 body_en jsonb NOT NULL DEFAULT '[]', body_ru jsonb NOT NULL DEFAULT '[]',
 presentation jsonb NOT NULL DEFAULT '{}', verification jsonb NOT NULL DEFAULT '{}', reason text NOT NULL DEFAULT '', attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(), processing_token uuid, processing_until timestamptz,
 published_at timestamptz, reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS news_published_idx ON news_items(published_at DESC,id DESC) WHERE status='published';
CREATE INDEX IF NOT EXISTS news_pending_idx ON news_items(next_attempt_at,created_at) WHERE status='pending';
CREATE TABLE IF NOT EXISTS news_budget (
 day date PRIMARY KEY, reserved_cents integer NOT NULL DEFAULT 0 CHECK(reserved_cents>=0),
 x_cents integer NOT NULL DEFAULT 0, ai_cents integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS news_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid REFERENCES users(id), action text NOT NULL,
 item_id uuid REFERENCES news_items(id), created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE news_settings ADD COLUMN IF NOT EXISTS collection_mode text NOT NULL DEFAULT 'batch' CHECK(collection_mode IN ('timeline','batch'));
ALTER TABLE news_settings ADD COLUMN IF NOT EXISTS scan_dirty boolean NOT NULL DEFAULT true;
ALTER TABLE news_settings ADD COLUMN IF NOT EXISTS scan_lease_token uuid;
ALTER TABLE news_settings ADD COLUMN IF NOT EXISTS scan_lease_until timestamptz;
ALTER TABLE news_settings ADD COLUMN IF NOT EXISTS last_scan_at timestamptz;
ALTER TABLE news_settings ADD COLUMN IF NOT EXISTS scan_status text NOT NULL DEFAULT 'not-checked';
CREATE TABLE IF NOT EXISTS news_scan_batches (
 id text PRIMARY KEY, query text NOT NULL, active boolean NOT NULL DEFAULT true,
 since_id text, pending_since_id text, pagination_token text,
 initial_start_at timestamptz NOT NULL, next_fetch_at timestamptz NOT NULL DEFAULT now(),
 last_fetched_at timestamptz, last_status text NOT NULL DEFAULT 'not-checked'
);
CREATE TABLE IF NOT EXISTS news_read_reservations (
 id uuid PRIMARY KEY, day date NOT NULL REFERENCES news_budget(day), cents integer NOT NULL CHECK(cents>0),
 settled boolean NOT NULL DEFAULT false, charged_cents integer, created_at timestamptz NOT NULL DEFAULT now()
);
-- News discussions are separate from community posts and VP-earning room messages.
CREATE TABLE IF NOT EXISTS news_comments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 news_id uuid NOT NULL REFERENCES news_items(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id),
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
 request_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 edited_at timestamptz, deleted_at timestamptz,
 UNIQUE(user_id,request_id)
);
CREATE INDEX IF NOT EXISTS news_comments_thread ON news_comments(news_id,created_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS news_comments_author_time ON news_comments(user_id,created_at DESC);
