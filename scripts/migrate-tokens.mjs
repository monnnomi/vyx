import {withDB} from '../server/db.js';
import {migrateTokens} from '../server/token-claims.js';
// Additive and repeatable: creates the jVYX allocation and claim-batch tables.
await withDB(db=>migrateTokens(db));
console.log('jVYX claim tables are ready.');
