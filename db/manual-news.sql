ALTER TABLE users ADD COLUMN IF NOT EXISTS news_author boolean NOT NULL DEFAULT false;
ALTER TABLE news_items ADD COLUMN IF NOT EXISTS author_id uuid REFERENCES users(id);
ALTER TABLE news_items ALTER COLUMN source_id DROP NOT NULL, ALTER COLUMN x_post_id DROP NOT NULL, ALTER COLUMN source_published_at DROP NOT NULL;
ALTER TABLE news_items DROP CONSTRAINT IF EXISTS news_items_category_check;
ALTER TABLE news_items ADD CONSTRAINT news_items_category_check CHECK (category IN ('updates','ecosystem','events','security','markets','reviews'));
UPDATE news_settings SET enabled=false, auto_publish=false WHERE id=1 AND (enabled OR auto_publish);
