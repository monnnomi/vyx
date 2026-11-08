import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {login} from '../server/oauth.js';
import {nftSelectionStatus,ownNftSelection,nftWhitelist} from '../server/nft-selection.js';
import {adminOverview} from '../server/admin.js';
import {createHandler} from '../api/vyx.js';
import {createAdminHandler} from '../api/admin.js';

const pg=new PGlite();await pg.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
const wrap=p=>({q:async(s,v=[])=> (await p.query(s,v)).rows,tx:fn=>p.transaction(tx=>fn(wrap(tx)))}),db=wrap(pg);
after(()=>pg.close());
const make=id=>db.tx(tx=>login(tx,{id,username:'selection_'+id,name:'Member '+id,avatar:''}));
const alice=await make('9001'),bob=await make('9002'),carol=await make('9003');
process.env.VYX_ADMIN_X_IDS='9001';process.env.PUBLIC_APP_URL='https://joinvyx.com';
const [room]=await db.q("INSERT INTO rooms(owner_id,name,request_id) VALUES($1,'Selection test',gen_random_uuid()) RETURNING id",[alice.user.id]);
async function award(user,season,start,amount){await db.q('INSERT INTO farm_awards(user_id,room_id,window_start,season,amount,activity,units) VALUES($1,$2,$3,$4,$5,1,1)',[user.id,room.id,start,season,amount]);}
await award(alice.user,'season-1','2026-11-01T00:00Z',30000);await award(alice.user,'season-2','2026-12-01T00:00Z',20000);
await award(bob.user,'season-1','2026-11-01T00:00Z',50000);await award(carol.user,'season-1','2026-11-01T00:00Z',49999);
for(let i=0;i<3;i++){const invitee=await make(String(9100+i));await db.q('INSERT INTO referrals(invitee_id,inviter_id) VALUES($1,$2)',[invitee.user.id,alice.user.id]);}

async function call(handler,url,user=null){
 const res={headers:{},statusCode:200,setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(t){this.data=JSON.parse(t);}};
 await handler({method:'GET',url,headers:user?{cookie:'vyx_session='+user.sessionToken}:{}},res);return res;
}

test('selection boundaries require VP for both free and discount tiers',()=>{
 for(const [vp,refs,tier,missingVP,missingRefs] of [[0,0,'full-price',50000,3],[49999,3,'full-price',1,0],[50000,0,'half-price',0,3],[50000,2,'half-price',0,1],[50000,3,'free',0,0],[90000,10,'free',0,0]]){
  const s=nftSelectionStatus(vp,refs);assert.equal(s.tier,tier);assert.equal(s.vpRemaining,missingVP);assert.equal(s.referralsRemaining,missingRefs);
 }
});
test('only confirmed ledger VP across seasons and registered referrals determine eligibility',async()=>{
 const a=await ownNftSelection(db,alice.user),b=await ownNftSelection(db,bob.user),c=await ownNftSelection(db,carol.user);
 assert.equal(a.confirmedVP,50000);assert.equal(a.invitedReferrals,3);assert.equal(a.tier,'free');assert.equal(a.discountPercent,100);
 assert.equal(b.tier,'half-price');assert.equal(b.discountPercent,50);assert.equal(b.referralsRemaining,3);
 assert.equal(c.tier,'full-price');assert.equal(c.vpRemaining,1);assert.equal(c.discountPercent,0);
 assert.ok(a.checkedAt);assert.equal(a.rules.vpBasis,'lifetime-confirmed');
});
test('private route requires a session and ignores attempts to request another account',async()=>{
 const app=createHandler(fn=>fn(db));
 const guest=await call(app,'/api/vyx?action=nft-selection&id='+alice.user.id);assert.equal(guest.statusCode,401);assert.deepEqual(Object.keys(guest.data),['error']);
 const own=await call(app,'/api/vyx?action=nft-selection&id='+alice.user.id+'&user_id='+alice.user.id,bob);
 assert.equal(own.statusCode,200);assert.equal(own.data.tier,'half-price');assert.equal(own.data.invitedReferrals,0);assert.equal(own.headers['cache-control'],'no-store');
});
test('public profiles, search and referral leaderboards never return NFT selection',async()=>{
 const app=createHandler(fn=>fn(db));
 for(const url of ['/api/vyx?action=member-profile&id='+alice.user.id,'/api/vyx?action=search','/api/vyx?action=referrals']){
  for(const user of [null,bob]){const response=await call(app,url,user);assert.equal(response.statusCode,200);assert.doesNotMatch(JSON.stringify(response.data),/nftSelection|discountPercent|vpRemaining|referralsRemaining|vpBasis/);}
 }
});
test('administrator sees per-member results and can filter all three tiers; ordinary members are denied',async()=>{
 const admin=createAdminHandler(fn=>fn(db));
 for(const [user,code] of [[null,401],[bob,403]]){const denied=await call(admin,'/api/admin?filter=nft-free',user);assert.equal(denied.statusCode,code);assert.deepEqual(Object.keys(denied.data),['error']);}
 for(const [filter,person,tier] of [['nft-free',alice,'free'],['nft-half-price',bob,'half-price'],['nft-full-price',carol,'full-price']]){
  const result=await adminOverview(db,alice.user,{filter});assert.ok(result.users.some(u=>u.id===person.user.id));assert.ok(result.users.every(u=>u.nftSelection.tier===tier));
 }
 const result=await call(admin,'/api/admin?filter=nft-free',alice);assert.equal(result.statusCode,200);assert.equal(result.data.users[0].nftSelection.confirmedVP,50000);assert.equal(result.headers['cache-control'],'no-store');
});

test('public whitelist shows only qualified places and never private progress or full-price accounts',async()=>{
 const app=createHandler(fn=>fn(db));
 for(const user of [null,carol]){
  const res=await call(app,'/api/vyx?action=whitelist',user);assert.equal(res.statusCode,200);assert.equal(res.headers['cache-control'],'no-store');
  assert.deepEqual(res.data.counts,{free:1,halfPrice:1,total:2});
  assert.deepEqual(res.data.members.map(m=>[m.id,m.tier]),[[alice.user.id,'free'],[bob.user.id,'half-price']]);
  for(const member of res.data.members)assert.deepEqual(Object.keys(member).sort(),['avatar_url','handle','id','name','tier']);
  assert.doesNotMatch(JSON.stringify(res.data),/confirmedVP|confirmed_vp|invitedReferrals|invited_referrals|vpRemaining|referralsRemaining|x_id|x_username|full-price/);
 }
 const discount=await nftWhitelist(db,{tier:'half-price'});assert.equal(discount.members.length,1);assert.equal(discount.members[0].id,bob.user.id);assert.equal(discount.pagination.total,1);assert.equal(discount.counts.total,2);
 for(const params of [{tier:'full-price'},{tier:"free' OR true --"},{page:0},{page:1.5},{page:100001}])await assert.rejects(nftWhitelist(db,params),e=>e.status===400);
});

test('whitelist moves a member from 50 percent off to free automatically without a duplicate',async()=>{
 for(let i=0;i<3;i++){const invitee=await make(String(9200+i));await db.q('INSERT INTO referrals(invitee_id,inviter_id) VALUES($1,$2)',[invitee.user.id,bob.user.id]);}
 const list=await nftWhitelist(db);assert.deepEqual(list.counts,{free:2,halfPrice:0,total:2});assert.equal(list.members.filter(p=>p.id===bob.user.id).length,1);assert.equal(list.members.find(p=>p.id===bob.user.id).tier,'free');
 assert.equal((await nftWhitelist(db,{tier:'half-price'})).members.length,0);
 // A ledger update is reflected immediately; no separate public eligibility record can drift.
 await award(carol.user,'season-2','2026-12-01T00:00Z',1);
 assert.equal((await nftWhitelist(db)).members.find(p=>p.id===carol.user.id).tier,'half-price');
 assert.equal((await ownNftSelection(db,carol.user)).tier,'half-price');
});

test('whitelist pagination remains bounded and keeps totals even on an empty page',async()=>{
 const added=await db.q("INSERT INTO users(x_id,handle,name) SELECT 'whitelist-'||n,'whitelist_'||n,'Whitelist member '||n FROM generate_series(1,51) n RETURNING id");
 for(const user of added)await award(user,'season-1','2026-11-01T00:00Z',50000);
 const first=await nftWhitelist(db),second=await nftWhitelist(db,{page:2}),empty=await nftWhitelist(db,{page:999});
 assert.equal(first.members.length,50);assert.equal(second.members.length,4);assert.equal(first.pagination.pages,2);assert.equal(empty.members.length,0);assert.equal(empty.pagination.total,54);
 assert.equal(new Set([...first.members,...second.members].map(p=>p.id)).size,54);
});
