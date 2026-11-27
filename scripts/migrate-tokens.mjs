import {withDB} from '../server/db.js';
import {migrateForumTopics,migrateForumTopicMedia} from '../server/forum-topics.js';
import {migrateBlogCuration} from '../server/blog-curation.js';
import {migrateForumGiveaways} from '../server/forum-giveaways.js';
import {migrateTournament} from '../server/tournament.js';
import {migrateTokens} from '../server/token-claims.js';
// Additive and repeatable: creates the jVYX allocation and claim-batch tables.
await withDB(async db=>{await migrateTokens(db);await migrateTournament(db);await migrateForumGiveaways(db);await migrateForumTopics(db);await migrateForumTopicMedia(db);await migrateBlogCuration(db);});
console.log('jVYX claim tables are ready.');
