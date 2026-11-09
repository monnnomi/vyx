CREATE TABLE IF NOT EXISTS post_views (
 user_id uuid NOT NULL REFERENCES users(id),
 post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
 viewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(user_id,post_id)
);
CREATE INDEX IF NOT EXISTS post_views_post_idx ON post_views(post_id);
