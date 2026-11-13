-- Additive pacing ledger; existing reservations and publications are never reset.
ALTER TABLE news_settings ADD COLUMN IF NOT EXISTS pacing_enabled boolean NOT NULL DEFAULT true;
CREATE TABLE IF NOT EXISTS news_budget_windows (
 day date NOT NULL REFERENCES news_budget(day) ON DELETE CASCADE,
 slot smallint NOT NULL CHECK(slot BETWEEN 0 AND 7),
 allowance_cents integer NOT NULL CHECK(allowance_cents>=0),
 reserved_cents integer NOT NULL DEFAULT 0 CHECK(reserved_cents>=0),
 x_cents integer NOT NULL DEFAULT 0 CHECK(x_cents>=0),
 ai_cents integer NOT NULL DEFAULT 0 CHECK(ai_cents>=0),
 PRIMARY KEY(day,slot),CHECK(reserved_cents<=allowance_cents)
);
ALTER TABLE news_read_reservations ADD COLUMN IF NOT EXISTS budget_slot smallint CHECK(budget_slot BETWEEN 0 AND 7);
ALTER TABLE news_items ADD COLUMN IF NOT EXISTS selection_status text NOT NULL DEFAULT 'unchecked' CHECK(selection_status IN ('unchecked','selected'));
ALTER TABLE news_items ADD COLUMN IF NOT EXISTS selection_score smallint NOT NULL DEFAULT 0 CHECK(selection_score BETWEEN 0 AND 100);
ALTER TABLE news_items ADD COLUMN IF NOT EXISTS selection_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE news_items ADD COLUMN IF NOT EXISTS selection_next_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE news_items ADD COLUMN IF NOT EXISTS selected_at timestamptz;
CREATE INDEX IF NOT EXISTS news_selection_idx ON news_items(selection_next_at,source_published_at DESC) WHERE status='pending' AND selection_status='unchecked';
