// Disposable PostgreSQL-compatible performance fixture. No environment or live DB access.
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {reputationSQL} from '../server/reputation.js';
const pg=new PGlite();
try{
 await pg.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
 await pg.exec('DROP INDEX IF EXISTS reactions_post_reputation_idx');
 await pg.exec(`CREATE TEMP TABLE rep_people AS SELECT n,gen_random_uuid() AS id FROM generate_series(1,200) n;
 INSERT INTO users(id,x_id,handle,name) SELECT id,'rep-plan-'||n,'rep_plan_'||n,'Isolated plan member' FROM rep_people;
 CREATE TEMP TABLE rep_rooms AS SELECT n,gen_random_uuid() AS id FROM generate_series(1,20) n;
 INSERT INTO rooms(id,owner_id,name,request_id) SELECT r.id,u.id,'Isolated plan room '||r.n,gen_random_uuid() FROM rep_rooms r JOIN rep_people u ON u.n=r.n;
 INSERT INTO room_members(room_id,user_id) SELECT r.id,u.id FROM rep_rooms r CROSS JOIN rep_people u;
 CREATE TEMP TABLE rep_messages AS SELECT n,gen_random_uuid() AS id,1+(n%200) AS author FROM generate_series(1,20000) n;
 INSERT INTO room_messages(id,room_id,sender_id,body,request_id) SELECT m.id,r.id,u.id,'Isolated recognition query plan message.',gen_random_uuid() FROM rep_messages m JOIN rep_people u ON u.n=m.author JOIN rep_rooms r ON r.n=1+(m.n%20);
 INSERT INTO message_reactions(user_id,room_message_id,emoji) SELECT u.id,m.id,'👍' FROM rep_messages m CROSS JOIN generate_series(1,2) offset_n JOIN rep_people u ON u.n=1+((m.author+offset_n-1)%200);
 CREATE TEMP TABLE rep_posts AS SELECT n,gen_random_uuid() AS id,1+(n%200) AS author FROM generate_series(1,5000) n;
 INSERT INTO posts(id,user_id,body) SELECT p.id,u.id,'Isolated recognition query plan post.' FROM rep_posts p JOIN rep_people u ON u.n=p.author;
 INSERT INTO reactions(user_id,post_id) SELECT u.id,p.id FROM rep_posts p CROSS JOIN generate_series(1,2) offset_n JOIN rep_people u ON u.n=1+((p.author+offset_n-1)%200);
 ANALYZE;`);
 const id=(await pg.query('SELECT id FROM rep_people WHERE n=1')).rows[0].id;
 async function explain(){
  const result=await pg.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+reputationSQL,[id]);
  const plan=result.rows[0]['QUERY PLAN'][0],nodes=[];
  const visit=n=>{nodes.push({node:n['Node Type'],relation:n['Relation Name'],index:n['Index Name'],rows:n['Actual Rows'],filtered:n['Rows Removed by Filter']});for(const child of n.Plans||[])visit(child);};visit(plan.Plan);
  return {executionMs:plan['Execution Time'],nodes};
 }
 const before=await explain();
 await pg.exec('CREATE INDEX IF NOT EXISTS reactions_post_reputation_idx ON reactions(post_id,user_id); ANALYZE reactions;');
 const after=await explain(),totals=(await pg.query(reputationSQL,[id])).rows[0];
 console.log(JSON.stringify({fixture:{accounts:200,roomMessages:20000,roomReactions:40000,posts:5000,postLikes:10000},totals,before,after},null,2));
}finally{await pg.close();}
