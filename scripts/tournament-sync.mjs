import {withDB} from '../server/db.js';
import {syncTournament} from '../server/tournament.js';

const result=await withDB(syncTournament);
console.log(JSON.stringify(result));
