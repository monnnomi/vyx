import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {conversations,mutate} from '../server/service.js';
test('direct conversation summaries reflect mutual-follow compose permission after unfollowing',async()=>{
 const pg=new PGlite();try{
  await pg.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
  const wrap=p=>({q:async(s,v=[])=>(await p.query(s,v)).rows,tx:fn=>p.transaction(tx=>fn(wrap(tx)))}),db=wrap(pg);
  const [a,b]=await db.q("INSERT INTO users(x_id,handle,name) VALUES('direct_a','direct_a','Alice'),('direct_b','direct_b','Bob') RETURNING *");
  await db.q('INSERT INTO follows(follower_id,following_id) VALUES($1,$2),($2,$1)',[a.id,b.id]);
  await mutate(db,a,'message',{id:b.id,body:'A private conversation.',requestId:randomUUID()});
  let list=await conversations(db,a);assert.equal(list.length,1);assert.equal(list[0].following,true);assert.equal(list[0].follows_you,true);assert.equal(list[0].body,'A private conversation.');
  await db.q('DELETE FROM follows WHERE follower_id=$1 AND following_id=$2',[b.id,a.id]);
  list=await conversations(db,a);assert.equal(list[0].following,true);assert.equal(list[0].follows_you,false);
  await assert.rejects(mutate(db,a,'message',{id:b.id,body:'Now blocked.',requestId:randomUUID()}),e=>e.status===403);
 }finally{await pg.close();}
});
