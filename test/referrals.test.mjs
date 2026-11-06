import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {startOAuth,consumeAttempt,login} from '../server/oauth.js';
import {referralBoard} from '../server/referrals.js';
import {token} from '../server/http.js';
const pg=new PGlite();await pg.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
const wrap=p=>({q:async(s,v=[])=> (await p.query(s,v)).rows,tx:fn=>p.transaction(tx=>fn(wrap(tx)))}),db=wrap(pg);after(()=>pg.close());
const identity=id=>({id,username:'member'+id,name:'Member '+id,avatar:''});
const owner=await db.tx(tx=>login(tx,identity('701'))),other=await db.tx(tx=>login(tx,identity('702')));
test('OAuth securely retains a valid inviter through the bound sign-in attempt',async()=>{
 const binding=token(),url=new URL(await startOAuth(db,binding,new Date(),'/',owner.user.id));
 await assert.rejects(consumeAttempt(db,url.searchParams.get('state'),token()));
 const attempt=await consumeAttempt(db,url.searchParams.get('state'),binding);assert.equal(attempt.inviter_id,owner.user.id);
 const newbie=await db.tx(tx=>login(tx,identity('703'),attempt.inviter_id));
 await db.tx(tx=>login(tx,identity('703'),other.user.id));
 const rows=await db.q('SELECT * FROM referrals WHERE invitee_id=$1',[newbie.user.id]);assert.equal(rows.length,1);assert.equal(rows[0].inviter_id,owner.user.id);
 const board=await referralBoard(db,owner.user);assert.equal(board.mine.count,1);assert.equal(board.mine.rank,1);assert.ok(board.mine.url.endsWith('/?ref='+owner.user.id));
});
test('existing accounts, self invitations, absent or invalid invitation links do not count',async()=>{
 await db.tx(tx=>login(tx,identity('702'),owner.user.id));await db.tx(tx=>login(tx,identity('701'),owner.user.id));
 for(const ref of ['not-a-uuid','00000000-0000-0000-0000-000000000000',null]){const binding=token(),url=new URL(await startOAuth(db,binding,new Date(),'/',ref));assert.equal((await consumeAttempt(db,url.searchParams.get('state'),binding)).inviter_id,null);}
 assert.equal((await db.q('SELECT * FROM referrals')).length,1);
 assert.equal((await referralBoard(db,null)).mine,null);
});
