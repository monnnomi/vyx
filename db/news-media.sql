ALTER TABLE news_items ADD COLUMN IF NOT EXISTS source_media jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(source_media)='array' AND jsonb_array_length(source_media)<=4);
ALTER TABLE news_items ADD COLUMN IF NOT EXISTS media_checked_at timestamptz;
ALTER TABLE news_items ADD COLUMN IF NOT EXISTS media_next_attempt_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS news_media_pending ON news_items(media_next_attempt_at,published_at DESC) WHERE status='published' AND media_checked_at IS NULL;
