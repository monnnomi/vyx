import {fail} from './http.js';
import {reserveXCheckRead} from './x-tasks.js';
import {getTaskAccess} from './x-task-access.js';
import {walletChain} from './wallets.js';
import {tokenContracts} from './token-claims.js';

const opens = Date.parse('2026-11-24T00:00:00Z');
const closes = Date.parse('2026-11-29T19:00:00Z');
const fee = 10_000n * 10n ** 18n;
const serviceFee = 20_000_000_000_000n;
const entryTopic = '0x089d0daa5e8466fdfdab1113e8fdd98c06ef26711cafc429dabce354d007364e';
const entryContract = () => /^0x[a-f\d]{40}$/i.test(process.env.VYX_TOURNAMENT_CONTRACT||'') ? process.env.VYX_TOURNAMENT_CONTRACT.toLowerCase() : null;
const word = n => n.toString(16).padStart(64,'0');
const treasury = '0x001bdb821e99ce79b92cfb5d7bed1226c5e6926e';
const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const prizes = [200000,150000,120000,90000,75000,65000,55000,45000,40000,35000,30000,25000,25000,25000,20000];
const isOpen = () => Date.now() >= opens && Date.now() < closes;
const ready = () => process.env.VYX_TOURNAMENT_OPEN === '1' && walletChain().id === 4663 && Boolean(entryContract());
const postPattern = /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]+\/status\/(\d{1,20})(?:[?#].*)?$/i;

export async function migrateTournament(db) {
 await db.q(`CREATE TABLE IF NOT EXISTS tournament_entries (
  user_id uuid PRIMARY KEY REFERENCES users(id), wallet text NOT NULL UNIQUE,
  tx_hash text NOT NULL UNIQUE, entered_at timestamptz NOT NULL
 )`);
 await db.q("ALTER TABLE tournament_entries ADD COLUMN IF NOT EXISTS scanned_at timestamptz");
 await db.q(`CREATE TABLE IF NOT EXISTS tournament_posts (
  id text PRIMARY KEY, user_id uuid NOT NULL REFERENCES tournament_entries(user_id),
  post_day date NOT NULL, score bigint NOT NULL, measured_at timestamptz NOT NULL,
  UNIQUE (user_id, post_day)
 )`);
}

async function rpc(method, params) {
 try {
  const response = await fetch(walletChain().rpc, {
   method:'POST', headers:{'Content-Type':'application/json'}, signal:AbortSignal.timeout(8000),
   body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})
  });
  const payload = await response.json();
  if (!response.ok || payload.error) throw Error('RPC failure');
  return payload.result;
 } catch { fail(503,'Robinhood Chain is temporarily unavailable. Keep your transaction hash and try again.'); }
}

export async function tournamentState(db,user) {
 const [entry] = user ? await db.q('SELECT tx_hash FROM tournament_entries WHERE user_id=$1',[user.id]) : [];
 const [wallet] = user ? await db.q('SELECT address FROM user_wallets WHERE user_id=$1 AND chain_id=4663',[user.id]) : [];
 const board = await db.q(`SELECT u.name,u.handle,COALESCE(sum(p.score),0)::text AS score,count(p.id)::int AS posts
  FROM tournament_entries t JOIN users u ON u.id=t.user_id LEFT JOIN tournament_posts p ON p.user_id=t.user_id
  GROUP BY t.user_id,t.entered_at,u.name,u.handle HAVING count(p.id)>0
  ORDER BY sum(p.score) DESC,t.entered_at,t.user_id LIMIT 100`);
 return {board,prizes,entered:Boolean(entry),wallet:wallet?.address,closesAt:new Date(closes).toISOString(),
  closed:Date.now()>=closes,open:ready()&&isOpen(),
  payment:entryContract()?{chainId:4663,token:tokenContracts[4663].token,to:entryContract(),
   approval:'0x095ea7b3'+word(BigInt(entryContract()))+word(fee),
   allowancePrefix:'0xdd62ed3e',data:'0xe97dcb62',value:'0x'+serviceFee.toString(16),
   amount:fee.toString()}:null};
}

export async function checkTournamentEntry(db,user) {
 if (!ready() || !isOpen()) fail(409,'Tournament entry is not open.');
 if (Date.now() >= closes-300000) fail(409,'New payments close five minutes before the deadline.');
 const [wallet]=await db.q('SELECT address FROM user_wallets WHERE user_id=$1 AND chain_id=4663',[user.id]);
 if (!wallet) fail(409,'Link your Robinhood Chain wallet in your profile.');
 const [entry]=await db.q('SELECT user_id FROM tournament_entries WHERE user_id=$1 OR wallet=$2',[user.id,wallet.address.toLowerCase()]);
 if (entry) fail(409,'This member or wallet already entered.');
 await getTaskAccess(db,user);
 return {ok:true};
}

export async function registerTournamentPayment(db,user,hash) {
 if (!ready()) fail(409,'Tournament entry is not open.');
 if (typeof hash!=='string'||!/^0x[a-f\d]{64}$/i.test(hash)) fail(400,'Enter a valid transaction hash.');
 hash=hash.toLowerCase();
 const [existing]=await db.q('SELECT tx_hash FROM tournament_entries WHERE user_id=$1',[user.id]);
 if (existing) {
  if (existing.tx_hash===hash) return {ok:true};
  fail(409,'You already joined this tournament.');
 }
 const [wallet]=await db.q('SELECT lower(address) AS address FROM user_wallets WHERE user_id=$1 AND chain_id=4663',[user.id]);
 if (!wallet) fail(409,'Link your Robinhood Chain wallet in your profile.');
 const receipt=await rpc('eth_getTransactionReceipt',[hash]);
 if (!receipt) fail(409,'The transfer is still pending. Recheck the same transaction hash.');
 const topic=address=>'0x'+address.slice(2).padStart(64,'0');
 const paid = receipt.logs.some(log=>!log.removed&&log.address.toLowerCase()===entryContract()
  &&log.topics[0]===entryTopic&&log.topics[1]===topic(wallet.address)&&log.data==='0x'+word(fee)+word(serviceFee));
 if (receipt.status!=='0x1'||!paid||!receipt.logs.some(log=>!log.removed&&log.address.toLowerCase()===tokenContracts[4663].token.toLowerCase()
  &&log.topics[0]===transferTopic&&log.topics[1]===topic(wallet.address)&&log.topics[2]===topic(treasury)&&BigInt(log.data)===fee)){
  fail(400,'This transaction does not contain the required 10,000 jVYX entry and service fee from your linked wallet.');
 }
 const [block,latest]=await Promise.all([rpc('eth_getBlockByHash',[receipt.blockHash,false]),rpc('eth_blockNumber',[])]);
 if (!block || BigInt(latest)-BigInt(receipt.blockNumber)<2n) fail(409,'Wait for two more blocks, then recheck the same hash.');
 const timestamp=Number(block.timestamp)*1000;
 if (!Number.isFinite(timestamp)||timestamp<opens||timestamp>=closes) fail(400,'The transfer falls outside the tournament dates.');
 const [entry]=await db.q(`INSERT INTO tournament_entries(user_id,wallet,tx_hash,entered_at)
  SELECT $1,$2,$3,$4 WHERE EXISTS (SELECT 1 FROM user_wallets WHERE user_id=$1 AND lower(address)=$2 AND chain_id=4663)
  ON CONFLICT DO NOTHING RETURNING user_id`,[user.id,wallet.address,hash,new Date(timestamp)]);
 if (!entry) {
  const [same]=await db.q('SELECT user_id FROM tournament_entries WHERE user_id=$1 AND tx_hash=$2',[user.id,hash]);
  if (!same) fail(409,'This wallet or transfer is already registered, or the linked wallet changed.');
 }
 return {ok:true};
}

const postFields='author_id,created_at,public_metrics,entities,referenced_tweets';

export function tournamentPostScore(post,entry,user) {
 const published=Date.parse(post?.created_at);
 if(post?.author_id!==String(user.x_id)||!Number.isFinite(published)||published<Math.max(opens,Date.parse(entry.entered_at))
  ||published>=closes||post.referenced_tweets?.some(ref=>ref.type!=='quoted')
  ||!post.entities?.hashtags?.some(tag=>tag.tag.toLowerCase()==='vyx')||!post.public_metrics)return null;
 const m=post.public_metrics;
 const score=Math.floor((m.impression_count??0)/100)+3*(m.like_count??0)+5*(m.reply_count??0)+8*(m.retweet_count??0);
 return {score,day:new Date(published+5*3600000).toISOString().slice(0,10)};
}

async function saveTournamentPost(db,user,id,{score,day}) {
 const [saved]=await db.q(`INSERT INTO tournament_posts(id,user_id,post_day,score,measured_at)
  SELECT $1,$2,$3,$4,now() WHERE now()<$5 ON CONFLICT(user_id,post_day) DO UPDATE SET score=EXCLUDED.score,measured_at=EXCLUDED.measured_at
  WHERE tournament_posts.id=EXCLUDED.id RETURNING id`,[id,user.id,day,score,new Date(closes)]);
 return Boolean(saved);
}

async function fetchTournamentPosts(db,token,path,params) {
 const url=new URL('https://api.x.com/2/'+path);
 url.search=new URLSearchParams({'tweet.fields':postFields,...params});
 await reserveXCheckRead(db,url.href);
 let response;
 try { response=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(8000),redirect:'error'}); }
 catch { fail(503,'X is temporarily unavailable. Try again later.'); }
 if (!response.ok) fail(response.status===429?503:409,'X could not verify this post. Check its visibility and your X connection.');
 return response.json();
}

export async function scoreTournamentPost(db,user,url) {
 if (!ready()||!isOpen()) fail(409,'Tournament submissions are closed.');
 const id=typeof url==='string'&&url.match(postPattern)?.[1];
 if (!id) fail(400,'Enter a link to a post on X.');
 const [entry]=await db.q('SELECT entered_at FROM tournament_entries WHERE user_id=$1',[user.id]);
 if (!entry) fail(403,'Join the tournament before submitting a post.');
 const [previous]=await db.q('SELECT measured_at FROM tournament_posts WHERE id=$1 AND user_id=$2',[id,user.id]);
 if (previous&&Date.now()-new Date(previous.measured_at).getTime()<3600000) fail(429,'You can refresh this post once an hour.');
 const {token}=await getTaskAccess(db,user);
 const {data:post}=await fetchTournamentPosts(db,token,'tweets/'+id,{});
 const scored=tournamentPostScore(post,entry,user);
 if(!scored) fail(400,'Publish your own original post or quote with #VYX after your tournament entry is confirmed.');
 if(!await saveTournamentPost(db,user,id,scored))fail(409,'Only one post per day counts, and submissions must arrive before closing.');
 return {ok:true,score:scored.score};
}

export async function syncTournament(db) {
 if(!ready()||!isOpen())return {scanned:0,scored:0};
 const entries=await db.q(`SELECT t.user_id AS id,t.entered_at,u.x_id FROM tournament_entries t
  JOIN users u ON u.id=t.user_id WHERE t.scanned_at IS NULL OR t.scanned_at<now()-interval '2 hours'
  ORDER BY t.scanned_at NULLS FIRST,t.entered_at LIMIT 3`);
 let scanned=0,scored=0;
 for(const user of entries){
  try{
   const {token}=await getTaskAccess(db,user);
   const params={max_results:'10',exclude:'retweets,replies',start_time:new Date(Math.max(opens,Date.parse(user.entered_at))).toISOString()};
   const {data:recent=[]}=await fetchTournamentPosts(db,token,'users/'+encodeURIComponent(user.x_id)+'/tweets',params);
   for(const post of recent.reverse()){
    const result=tournamentPostScore(post,user,user);
    if(result&&await saveTournamentPost(db,user,post.id,result))scored++;
   }
   const known=await db.q(`SELECT id FROM tournament_posts WHERE user_id=$1 AND measured_at<now()-interval '2 hours' ORDER BY measured_at LIMIT 7`,[user.id]);
   if(known.length){
    const {data:posts=[]}=await fetchTournamentPosts(db,token,'tweets',{ids:known.map(post=>post.id).join(',')});
    for(const post of posts){
     const result=tournamentPostScore(post,user,user);
     if(result&&await saveTournamentPost(db,user,post.id,result))scored++;
    }
   }
   scanned++;
  }catch(error){
   if(error.status===503)break;
   if(error.status!==409)throw error;
  }
  await db.q('UPDATE tournament_entries SET scanned_at=now() WHERE user_id=$1',[user.id]);
 }
 return {scanned,scored};
}
