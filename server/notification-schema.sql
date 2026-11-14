-- Additive: the previous release can keep running while this is applied.
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS likes boolean NOT NULL DEFAULT true;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS messages boolean NOT NULL DEFAULT true;
CREATE TABLE IF NOT EXISTS notification_reads (
 user_id uuid NOT NULL REFERENCES users(id), notification_id text NOT NULL CHECK(length(notification_id)<=160),
 event_at timestamptz NOT NULL, PRIMARY KEY(user_id,notification_id)
);
CREATE INDEX IF NOT EXISTS reactions_post_date ON reactions(post_id,created_at DESC);
CREATE INDEX IF NOT EXISTS follows_recipient_date ON follows(following_id,created_at DESC);
