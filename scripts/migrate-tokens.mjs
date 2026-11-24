import {withDB} from '../server/db.js';
import {migrateTournament} from '../server/tournament.js';
import {migrateTokens} from '../server/token-claims.js';
// Additive and repeatable: creates the jVYX allocation and claim-batch tables.
await withDB(async db=>{await migrateTokens(db);await migrateTournament(db);});
console.log('jVYX claim tables are ready.');
