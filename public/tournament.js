'use strict';
let tournament=null;
let tournamentBusy=false;

async function loadTournament(){
 tournament=await api('tournament');
}

function renderTournament(){
 const t=tournament;
 if(!t)return '<section class="panel"><h2>Tournament</h2><p>Loading tournament…</p></section>';
 const transferKey=data.user?'vyx-tournament-payment:'+data.user.id:'';
 const pending=transferKey ? localStorage.getItem(transferKey)||'' : '';
 const entry=t.entered ? '<p>You’ve joined the tournament.</p>' : !t.open ? '' : !data.user ?
  '<p>Sign in with X to join.</p>' : !t.wallet ? '<p><a href="#profile">Link your wallet in your profile</a> to join.</p>' :
  `<p>Connect X verification under <a href="#tasks">Quests</a> before paying.</p>
   <button class="primary" data-tournament-pay ${pending?'disabled':''}>Pay 10,000 jVYX</button>
   <form data-tournament-receipt><label>Payment transaction hash <input name="hash" required value="${e(pending)}" pattern="0x[0-9A-Fa-f]{64}"></label> <button class="secondary">Verify payment</button></form>`;
 const submission=t.entered&&t.open ? `<form data-tournament-post><label>X post URL <input type="url" name="url" required placeholder="https://x.com/…/status/…"></label> <button class="secondary">Verify post</button></form>` : '';
 return `<section class="news-page">
  <header class="news-page-head"><h1>VYX Tournament</h1><p>Publish about VYX on X. Compete for 1,000,000 jVYX across 15 places.</p>
  <p><strong>${t.closed?'Closed':t.open?'Open for entries':'Entry opens after verification is enabled'}</strong> · Ends November 29, 23:59 Yekaterinburg time</p></header>
  <section class="panel"><h2>Entry</h2><p>10,000 jVYX to the VYX treasury on Robinhood Chain, plus network gas.</p>${entry}${submission}
  <p>One original post or quote per day mentioning @vyxsocial. One account per participant. Duplicate posts and manipulated engagement are ineligible.</p>
  <p>1 point per 100 views · 3 per like · 5 per reply · 8 per repost or quote.</p></section>
  <section class="panel"><h2>Leaderboard</h2><p>Provisional scores. Submit the same link again to refresh its metrics once an hour.</p>
  ${t.board.length?`<ol>${t.board.map(r=>`<li><strong>${e(r.name)}</strong> · ${fmt(r.score)} points · ${fmt(r.posts)} posts</li>`).join('')}</ol>`:'<p>No scored posts yet.</p>'}</section>
  <section class="panel"><h2>Prizes</h2><ol>${t.prizes.map(n=>`<li>${fmt(n)} jVYX</li>`).join('')}</ol>
  <p>Prizes for unfilled places roll over to the next tournament.</p></section>
  <a href="#news">News archive</a>
 </section>`;
}

async function tournamentAction(button,action){
 if(tournamentBusy)return;
 tournamentBusy=true;
 button.disabled=true;
 try{await action();await loadTournament();if(page==='tournament')render();}
 catch(err){toast(err.message);}
 finally{tournamentBusy=false;if(button.isConnected)button.disabled=false;}
}
document.addEventListener('click',event=>{
 const button=event.target.closest('[data-tournament-pay]');
 if(!button)return;
 void tournamentAction(button,async()=>{
  const key='vyx-tournament-payment:'+data.user.id;
  if(localStorage.getItem(key))throw Error('Verify the existing payment before starting a new one.');
  await api('tournament-preflight',{});
  const wallet=walletProvider();
  if(!wallet)throw Error('Open your browser wallet to continue.');
  const [from]=await wallet.request({method:'eth_requestAccounts'});
  if(from?.toLowerCase()!==tournament.wallet.toLowerCase())throw Error('Select your linked wallet.');
  await jvyxEnsureChain(wallet,tournament.payment);
  const {to,data:calldata}=tournament.payment;
  const hash=await wallet.request({method:'eth_sendTransaction',params:[{from,to,data:calldata,value:'0x0'}]});
  localStorage.setItem(key,hash);
  const input=document.querySelector('[data-tournament-receipt] input');
  if(input)input.value=hash;
  toast('Payment submitted. Verify the hash once confirmed.');
 });
});
document.addEventListener('submit',event=>{
 const form=event.target;
 if(!form.matches('[data-tournament-receipt],[data-tournament-post]'))return;
 event.preventDefault();
 const button=form.querySelector('button');
 void tournamentAction(button,async()=>{
  if(form.hasAttribute('data-tournament-receipt')){
   await api('tournament-payment',{hash:form.elements.hash.value.trim()});
   localStorage.removeItem('vyx-tournament-payment:'+data.user.id);
   toast('Tournament entry verified.');
  }else{
   const result=await api('tournament-post',{url:form.elements.url.value.trim()});
   toast(`Post verified · ${fmt(result.score)} points.`);
  }
 });
});
