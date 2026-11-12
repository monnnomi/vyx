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
