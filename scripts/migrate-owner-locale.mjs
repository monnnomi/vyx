import {withDB} from '../server/db.js';
await withDB(db=>db.q("ALTER TABLE users ADD COLUMN IF NOT EXISTS interface_locale text NOT NULL DEFAULT 'en' CHECK (interface_locale IN ('en','ru'))"));
console.log('Owner interface preference is ready.');
