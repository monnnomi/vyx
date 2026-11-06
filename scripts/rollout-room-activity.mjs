import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {withDB} from '../server/db.js';
import {listRooms} from '../server/rooms.js';

const schema=await readFile(new URL('../db/schema.sql',import.meta.url),'utf8');
const marker='-- Room discovery activity index.';
const indexSQL=schema.slice(schema.indexOf(marker));assert.ok(indexSQL.startsWith(marker));
const result=await withDB(async db=>{
 // Build the additive index without blocking normal room writes.
 await db.q(indexSQL.replace('CREATE INDEX IF NOT EXISTS','CREATE INDEX CONCURRENTLY IF NOT EXISTS'));
 const [index]=await db.q("SELECT i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relname='room_messages_activity'");
 assert.equal(index.indisvalid,true);
 const start=performance.now(),guest=await listRooms(db,null);
 return {indexValid:true,queryMs:Math.round(performance.now()-start),rooms:guest.rooms.map(r=>({id:r.id,name:r.name})),nextPage:guest.nextPage};
});
await mkdir('../outputs/vyx-room-activity',{recursive:true});
await writeFile('../outputs/vyx-room-activity/rollout.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({indexValid:result.indexValid,queryMs:result.queryMs,visibleRooms:result.rooms.length}));
