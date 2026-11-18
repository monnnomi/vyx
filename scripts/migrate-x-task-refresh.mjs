import {withDB} from '../server/db.js';

await withDB(db => db.q('ALTER TABLE x_task_access ADD COLUMN IF NOT EXISTS sealed_refresh_token text'));
console.log('Quest connections support refresh tokens.');
