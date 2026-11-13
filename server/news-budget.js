import {fail} from './http.js';
import {taskQueueHasWork} from './x-task-queue.js';

export const newsClock=async db=>new Date((await db.q('SELECT clock_timestamp() AS news_now'))[0].news_now);
const stamp=(day,hour)=>new Date(Date.parse(day+'T00:00:00Z')+hour*3600000).toISOString();
export function calculateNewsPacing({now,limit,usage=0,windows=[],enabled=true}){
 const date=new Date(now),day=date.toISOString().slice(0,10),slot=Math.floor(date.getUTCHours()/3);
 const scheduled=Math.floor(limit*0.96),carryCap=Math.ceil(limit*0.24);
 let allowance=0,spent=0,carry=0,grant=0;
 for(let i=0;i<=slot;i++){
  grant=Math.floor(scheduled*(i+1)/8)-Math.floor(scheduled*i/8);
  const row=windows.find(w=>Number(w.slot)===i);
  allowance=row?Number(row.allowance_cents):Math.min(carryCap,grant+carry);
  spent=row?Number(row.reserved_cents):0;
  carry=Math.max(0,allowance-spent);
 }
 const dailyRemaining=Math.max(0,limit-Number(usage));
 return {enabled,day,slot,grantCents:grant,allowanceCents:allowance,reservedCents:spent,
  remainingCents:enabled?Math.min(dailyRemaining,Math.max(0,allowance-spent)):dailyRemaining,
  dailyRemainingCents:dailyRemaining,carryCapCents:carryCap,safetyCents:limit-scheduled,
  startsAt:stamp(day,slot*3),endsAt:stamp(day,(slot+1)*3),resetAt:stamp(day,24)};
}
export async function newsSpendState(db,settings=null,now=null){
 settings||=(await db.q('SELECT * FROM news_settings WHERE id=1'))[0];now||=await newsClock(db);
 const day=now.toISOString().slice(0,10);
 const [usage]=await db.q('SELECT * FROM news_budget WHERE day=$1',[day]);
 const windows=await db.q('SELECT slot,allowance_cents,reserved_cents FROM news_budget_windows WHERE day=$1 ORDER BY slot',[day]);
 return calculateNewsPacing({now,limit:settings.daily_budget_cents,usage:usage?.reserved_cents||0,windows,enabled:settings.pacing_enabled});
}
// Caller owns the news_settings row lock/transaction. All X and AI paths share it.
export async function reserveNewsCostTx(tx,kind,cents,{keepForAI=0,keepInWindow=0}={}){
 if(!['x','ai'].includes(kind)||!Number.isInteger(cents)||cents<=0)throw Error('Invalid reservation');
 const [settings]=await tx.q('SELECT * FROM news_settings WHERE id=1 FOR UPDATE');
 if(!settings.enabled)fail(503,'Newsroom automation paused.');
 if(await taskQueueHasWork(tx,{includeRunning:true}))fail(503,'News is waiting for automatic quest verification.');
 const state=await newsSpendState(tx,settings);
 if(cents>state.dailyRemainingCents)fail(503,'Daily news allowance reached.');
 if(kind==='x'&&cents+keepForAI>state.dailyRemainingCents)fail(503,'Collection allowance reached; funds held for the writer.');
 if(cents+(state.enabled?keepInWindow:0)>state.remainingCents)fail(503,'Three-hour news allowance reached; waiting for the next window.');
 await tx.q(`INSERT INTO news_budget(day,reserved_cents,x_cents,ai_cents) VALUES($1,$2,$3,$4)
  ON CONFLICT(day) DO UPDATE SET reserved_cents=news_budget.reserved_cents+EXCLUDED.reserved_cents,x_cents=news_budget.x_cents+EXCLUDED.x_cents,ai_cents=news_budget.ai_cents+EXCLUDED.ai_cents`,[state.day,cents,kind==='x'?cents:0,kind==='ai'?cents:0]);
 if(state.enabled)await tx.q(`INSERT INTO news_budget_windows(day,slot,allowance_cents,reserved_cents,x_cents,ai_cents)
  VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(day,slot) DO UPDATE SET reserved_cents=news_budget_windows.reserved_cents+EXCLUDED.reserved_cents,x_cents=news_budget_windows.x_cents+EXCLUDED.x_cents,ai_cents=news_budget_windows.ai_cents+EXCLUDED.ai_cents`,[state.day,state.slot,state.allowanceCents,cents,kind==='x'?cents:0,kind==='ai'?cents:0]);
 return {day:state.day,slot:state.enabled?state.slot:null};
}
export async function reserveNewsCost(db,kind,cents){return (await db.tx(tx=>reserveNewsCostTx(tx,kind,cents))).day;}
export async function newsPublicationState(db,settings=null,now=null){
 settings||=(await db.q('SELECT * FROM news_settings WHERE id=1'))[0];now||=await newsClock(db);
 const day=now.toISOString().slice(0,10),slot=Math.floor(now.getUTCHours()/4),start=stamp(day,slot*4),end=stamp(day,(slot+1)*4);
 const [counts]=await db.q(`SELECT count(*)::int AS today,count(*) FILTER(WHERE published_at>=$2 AND published_at<$3)::int AS current_window
  FROM news_items WHERE published_at>=$1 AND published_at<$4`,[stamp(day,0),start,end,stamp(day,24)]);
 return {allowed:counts.today<6&&(!settings.pacing_enabled||!settings.auto_publish||counts.current_window===0),today:counts.today,
  currentWindow:counts.current_window,startsAt:start,endsAt:end,nextAt:counts.today>=6?stamp(day,24):end};
}
