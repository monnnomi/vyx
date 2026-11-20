import {readFile} from 'node:fs/promises';
import {withDB} from '../server/db.js';
const migration=await readFile(new URL('../db/manual-news.sql',import.meta.url),'utf8');
await withDB(db=>db.tx(tx=>tx.q(migration)));
console.log('Manual newsroom is ready.');
