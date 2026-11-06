
CREATE TABLE IF NOT EXISTS message_reactions (
 user_id uuid NOT NULL REFERENCES users(id),
 room_message_id uuid REFERENCES room_messages(id) ON DELETE CASCADE,
 message_id uuid REFERENCES messages(id) ON DELETE CASCADE,
 emoji text NOT NULL CHECK(emoji IN ('❤️','👍','🔥','😂','👏','😮')),
 CHECK ((room_message_id IS NULL) <> (message_id IS NULL)),
 UNIQUE(user_id,room_message_id), UNIQUE(user_id,message_id)
);
CREATE INDEX IF NOT EXISTS message_reactions_room_idx ON message_reactions(room_message_id);
CREATE INDEX IF NOT EXISTS message_reactions_dm_idx ON message_reactions(message_id);
