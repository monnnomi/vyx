CREATE TABLE IF NOT EXISTS message_views (
 user_id uuid NOT NULL REFERENCES users(id),
 room_message_id uuid REFERENCES room_messages(id) ON DELETE CASCADE,
 message_id uuid REFERENCES messages(id) ON DELETE CASCADE,
 viewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK ((room_message_id IS NULL) <> (message_id IS NULL)),
 UNIQUE(user_id,room_message_id), UNIQUE(user_id,message_id)
);
CREATE INDEX IF NOT EXISTS message_views_room_idx ON message_views(room_message_id);
CREATE INDEX IF NOT EXISTS message_views_dm_idx ON message_views(message_id);

ALTER TABLE message_reactions DROP CONSTRAINT IF EXISTS message_reactions_emoji_check;
ALTER TABLE message_reactions ADD CONSTRAINT message_reactions_emoji_check
 CHECK(emoji IN ('❤️','👍','🔥','😂','👏','😮','🎉','🚀','💯','👀','🙏','🤝','😍','🤔','😎','🤣','😢','😭','😡','👎','💪','🥳','✅','⚡'));
