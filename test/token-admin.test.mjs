import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {login} from '../server/oauth.js';
import {token} from '../server/http.js';
import {createAdminHandler} from '../api/admin.js';
import {tokenAdmin,tokenAdminAction,distributorReader,seasonsCallData,tokenUnit} from '../server/token-claims.js';

process.env.PUBLIC_APP_URL='https://joinvyx.com';process.env.VYX_APP_SECRET=token();process.env.VYX_ADMIN_X_IDS='7001';delete process.env.VYX_CHAIN_ID;
const pg=new PGlite();await pg.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
// Server clock pinned after the early-member snapshot (22 Nov 2026) so the test does not depend on today's date.
const time='2026-11-23T00:00:00Z';
const wrap=p=>({q:async(s,v=[])=>{if(s.includes('clock_timestamp()')){s=s.replaceAll('clock_timestamp()',`($${v.length+1}::timestamptz)`);v=[...v,time];}return (await p.query(s,v)).rows;},tx:fn=>p.transaction(tx=>fn(wrap(tx)))}),db=wrap(pg);after(()=>pg.close());
const owner=await db.tx(tx=>login(tx,{id:'7001',username:'boss',name:'Boss',avatar:''}));
const plain=await db.tx(tx=>login(tx,{id:'7002',username:'plain',name:'Plain',avatar:''}));
const addr=i=>'0x'+i.toString(16).padStart(40,'0');
async function member(n,vp,wallet){
 const {user}=await db.tx(tx=>login(tx,{id:String(7100+n),username:'m'+n,name:'Member '+n,avatar:''}));
 await db.q("UPDATE users SET created_at='2026-11-01T00:00:00Z' WHERE id=$1",[user.id]);
 await db.q("INSERT INTO x_task_awards(user_id,x_id,task_id,season,amount,proof_id,created_at) VALUES($1,$2,$3,'season-1',$4,'p','2026-11-10T00:00:00Z')",[user.id,user.x_id,'t'+n,vp]);
 if(wallet)await db.q("INSERT INTO user_wallets(user_id,address,chain_id,message,signature) VALUES($1,$2,4663,'m','0x00')",[user.id,addr(wallet)]);
 return user;
}
async function call(handler,{method='GET',url='/api/admin',user=owner,body={}}={}){
 const headers={origin:'https://joinvyx.com','content-type':'application/json'};if(user)headers.cookie='vyx_session='+user.sessionToken;
 const req={method,url,headers,body},res={headers:{},statusCode:200,setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(d){this.text=d;}};
 await handler(req,res);return {status:res.statusCode,data:JSON.parse(res.text)};
}
const chainWith=seasons=>({readSeasonCount:async()=>seasons.length,readSeason:async i=>seasons[i]});
const down={readSeasonCount:async()=>{throw new Error('rpc down');},readSeason:async()=>{throw new Error('rpc down');}};

test('admin token section shows seasons, freezes through the chain check and runs the batch lifecycle',async()=>{
 const a=await member(1,300,0xa1),b=await member(2,100,null);
 let chain=chainWith([]);
 const handler=createAdminHandler(fn=>fn(db),{tokenChain:()=>chain});

 // Only administrators can read or act.
 assert.equal((await call(handler,{url:'/api/admin?action=tokens',user:null})).status,401);
 assert.equal((await call(handler,{url:'/api/admin?action=tokens',user:plain})).status,403);
 assert.equal((await call(handler,{method:'POST',user:plain,body:{action:'token-sync'}})).status,403);

 const before=await tokenAdmin(db,'2026-11-21T12:00:00Z');
 assert.deepEqual(before.seasons.map(s=>[s.key,s.closed,s.frozen]),[['early-members',false,false],['season-1',false,false],['season-2',false,false]]);
 assert.equal(before.contracts.distributor,'0x431a9fa69f4c42ee85d7dbbcea0460856468bd16');assert.deepEqual(before.batches,[]);

 // A batch needs frozen shares; the sync action freezes closed seasons (the early drop closed on 22 Nov).
 assert.equal((await call(handler,{method:'POST',body:{action:'token-batch',season:'early-members'}})).data.error,'Freeze this season before creating a batch.');
 const sync=await call(handler,{method:'POST',body:{action:'token-sync'}});
 assert.equal(sync.status,200);assert.match(sync.data.log[0],/^Froze early-members: 2 members/);

 const view=(await call(handler,{url:'/api/admin?action=tokens'})).data.seasons[0];
 assert.equal(view.frozen,true);assert.equal(view.members,2);assert.equal(view.withWallet,1);assert.equal(view.needsWallet,1);assert.equal(view.waiting,1);
 assert.equal(view.basisVP,'400');assert.ok(BigInt(view.allocated)<=10_000_000n*tokenUnit);
 assert.deepEqual(view.top.map(t=>[t.x_username,t.status]),[['m1','waiting'],['m2','needs-wallet']]);

 // Create a batch with an explicit UTC start; the owner gets the exact cast commands.
 assert.equal((await call(handler,{method:'POST',body:{action:'token-batch',season:'early-members',startsAt:'not a date'}})).status,400);
 const made=await call(handler,{method:'POST',body:{action:'token-batch',season:'early-members',startsAt:'2026-11-25T00:00:00Z'}});
 assert.equal(made.status,200);assert.equal(made.data.members,1);
 let state=await tokenAdmin(db);
 const batch=state.batches[0];
 assert.equal(batch.id,made.data.id);assert.equal(batch.activatedAt,null);assert.equal(batch.tranches,90);
 assert.equal(batch.steps.length,2);
 assert.ok(batch.steps[0].command.includes(`transfer(address,uint256)" 0x431a9fa69f4c42ee85d7dbbcea0460856468bd16 ${batch.total}`));
 assert.ok(batch.steps[1].command.includes(`${batch.root} ${batch.total} ${Date.parse('2026-11-25T00:00:00Z')/1000} 90 86400`));
 assert.deepEqual(state.seasons[0].schedule,{startsAt:'2026-11-25T00:00:00.000Z',tranches:90,intervalSeconds:86400});
 assert.equal(state.seasons[0].top[0].status,'batched');

 // Discard refuses when the chain cannot be checked or already holds this root.
 assert.equal((await call(handler,{method:'POST',body:{action:'token-discard',id:batch.id}})).status,200);
 const again=await call(handler,{method:'POST',body:{action:'token-batch',season:'early-members'}});
 const second=(await tokenAdmin(db)).batches[0];assert.equal(second.id,again.data.id);
 chain=down;
 const unreachable=await call(handler,{method:'POST',body:{action:'token-discard',id:second.id}});
 assert.equal(unreachable.status,503);assert.equal(unreachable.data.error,'Could not reach Robinhood Chain. Try again.');
 const onchain={root:second.root,total:BigInt(second.total),claimed:0n,start:BigInt(second.start),interval:86400n,tranches:90n};
 chain=chainWith([onchain]);
 assert.equal((await call(handler,{method:'POST',body:{action:'token-discard',id:second.id}})).status,409);

 // The sync action activates the batch the owner added on-chain.
 const live=await call(handler,{method:'POST',body:{action:'token-sync'}});
 assert.deepEqual(live.data.log,[`Batch ${second.id} is live as on-chain season 0.`]);
 state=await tokenAdmin(db);
 assert.equal(state.batches[0].onchainId,0);assert.deepEqual(state.batches[0].steps,[]);
 assert.equal(state.seasons[0].live,1);assert.equal(state.seasons[0].liveAmount,second.total);assert.equal(state.seasons[0].top[0].status,'live');
 assert.equal((await call(handler,{method:'POST',body:{action:'token-discard',id:second.id}})).data.error,'Only an inactive batch can be discarded.');
 assert.equal((await call(handler,{method:'POST',body:{action:'token-nope'}})).status,400);
 // Moderation POSTs still reach the moderation handler.
 assert.equal((await call(handler,{method:'POST',body:{action:'review-deletion',id:b.id,status:'completed'}})).status,400);
 void a;
});

test('the distributor reader sends eth_call to the configured contract and decodes seasons',async()=>{
 const sent=[];const word=n=>BigInt(n).toString(16).padStart(64,'0');
 const fetchImpl=async(url,init)=>{const body=JSON.parse(init.body);sent.push([url,body.params[0]]);
  const data=body.params[0].data;return {json:async()=>({result:data==='0x715f8fe8'?'0x'+word(2):'0x'+'ab'.repeat(32)+word(5)+word(0)+word(9)+word(86400)+word(90)})};};
 const r=distributorReader(undefined,fetchImpl);
 assert.equal(await r.readSeasonCount(),2);
 assert.deepEqual(await r.readSeason(1),{root:'0x'+'ab'.repeat(32),total:5n,claimed:0n,start:9n,interval:86400n,tranches:90n});
 assert.deepEqual(sent.map(([u,p])=>[u,p.to,p.data]),[['https://rpc.mainnet.chain.robinhood.com','0x431a9fa69f4c42ee85d7dbbcea0460856468bd16','0x715f8fe8'],['https://rpc.mainnet.chain.robinhood.com','0x431a9fa69f4c42ee85d7dbbcea0460856468bd16',seasonsCallData(1)]]);
 await assert.rejects(tokenAdminAction(db,{action:'token-batch',season:'nope'},down),/Unknown token season/);
});
