import {readFile} from 'node:fs/promises';
import {withDB} from '../server/db.js';
const schema=await readFile(new URL('../db/schema.sql',import.meta.url),'utf8');
await withDB(db=>db.tx(tx=>tx.q(schema)));
console.log('VYX database is ready.');
