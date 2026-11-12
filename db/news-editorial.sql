-- Widen the category vocabulary and add structured presentation. Existing stories stay intact.
ALTER TABLE news_items ADD COLUMN IF NOT EXISTS presentation jsonb NOT NULL DEFAULT '{}';
ALTER TABLE news_items DROP CONSTRAINT IF EXISTS news_items_category_check;
ALTER TABLE news_items ADD CONSTRAINT news_items_category_check CHECK(category IN ('updates','ecosystem','events','security','markets'));
