-- Read-time reputation: index existing likes without storing or backfilling a score.
CREATE INDEX IF NOT EXISTS reactions_post_reputation_idx ON reactions(post_id,user_id);
