import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {migrateTournament,registerTournamentPayment,tournamentState} from '../server/tournament.js';
import {tokenContracts} from '../server/token-claims.js';

test('a confirmed exact jVYX transfer grants one entry and can be retried safely', async t=>{
 const pg=new PGlite();
 t.after(()=>pg.close());
 const db={q:async(sql,args=[]) => (await pg.query(sql,args)).rows};
 await pg.exec(`CREATE TABLE users(id uuid PRIMARY KEY,name text,handle text);
 CREATE TABLE user_wallets(user_id uuid,address text,chain_id integer);`);
 await migrateTournament(db);
 await migrateTournament(db);
 const user={id:'00000000-0000-0000-0000-000000000001'};
 const from='0x'+'1'.repeat(40), treasury='0x001bdb821e99ce79b92cfb5d7bed1226c5e6926e';
 const hash='0x'+'a'.repeat(64);
 const topic=address=>'0x'+address.slice(2).padStart(64,'0');
 await db.q("INSERT INTO users VALUES($1,'Tester','tester')",[user.id]);
 await db.q('INSERT INTO user_wallets VALUES($1,$2,4663)',[user.id,from]);
 const before=process.env.VYX_TOURNAMENT_OPEN;
 process.env.VYX_TOURNAMENT_OPEN='1';
 t.after(()=>{if(before===undefined)delete process.env.VYX_TOURNAMENT_OPEN;else process.env.VYX_TOURNAMENT_OPEN=before;});
 const receipt={status:'0x1',blockHash:'0x1234',blockNumber:'0x10',logs:[{
  address:tokenContracts[4663].token,
  topics:['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',topic(from),topic(treasury)],
  data:'0x1'
 }]};
 const results={eth_getTransactionReceipt:receipt,
  eth_getBlockByHash:{timestamp:'0x'+(Date.parse('2026-11-25T00:00:00Z')/1000).toString(16)},
  eth_blockNumber:'0x12'};
 t.mock.method(globalThis,'fetch',async(_url,options)=>Response.json({result:results[JSON.parse(options.body).method]}));
 await assert.rejects(registerTournamentPayment(db,user,hash),/required 10,000 jVYX transfer/);
 receipt.logs[0].data='0x'+(10_000n*10n**18n).toString(16);
 assert.deepEqual(await registerTournamentPayment(db,user,hash),{ok:true});
 assert.deepEqual(await registerTournamentPayment(db,user,hash),{ok:true});
 assert.equal((await tournamentState(db,user)).entered,true);
 assert.equal((await tournamentState(db,user)).prizes.reduce((sum,amount)=>sum+amount,0),1_000_000);
 assert.equal((await db.q('SELECT count(*)::int AS count FROM tournament_entries'))[0].count,1);
});
