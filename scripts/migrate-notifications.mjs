import {readFile} from 'node:fs/promises';
import {withDB} from '../server/db.js';
const sql=await readFile(new URL('../server/notification-schema.sql',import.meta.url),'utf8');
await withDB(db=>db.tx(tx=>tx.q(sql)));
console.log('Notification schema is ready.');
