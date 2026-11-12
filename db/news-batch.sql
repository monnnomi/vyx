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
