
ALTER TABLE oauth_attempts ADD COLUMN IF NOT EXISTS inviter_id uuid REFERENCES users(id);
CREATE TABLE IF NOT EXISTS referrals (
 invitee_id uuid PRIMARY KEY REFERENCES users(id),
 inviter_id uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), CHECK(invitee_id<>inviter_id)
);
CREATE INDEX IF NOT EXISTS referrals_inviter_idx ON referrals(inviter_id,created_at);
