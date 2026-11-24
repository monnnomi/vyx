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
 const entry=t.entered ? '<p class="tournament-joined">✓ Entry confirmed</p>' : !t.open ? '' : !data.user ?
  '<button class="primary" data-action="signin">Sign in with X</button>' : !t.wallet ?
  '<a class="tournament-link" href="#profile">Link your wallet →</a>' :
  `<p>Enable X verification under <a href="#tasks">Quests</a> before paying.</p>
   <button class="primary" data-tournament-pay ${pending?'disabled':''}>Join for 10,000 jVYX</button>
   <details ${pending?'open':''}><summary>Verify an existing payment</summary>
   <form data-tournament-receipt><label>Transaction hash <input name="hash" required value="${e(pending)}" pattern="0x[0-9A-Fa-f]{64}"></label><button class="secondary">Verify payment</button></form></details>`;
 const submission=t.entered&&t.open ? `<form data-tournament-post><label>X post URL <input type="url" name="url" required placeholder="https://x.com/…/status/…"></label><button class="primary">Verify post</button></form>` : '';
 return `<div class="tournament-page">
  <header class="tournament-hero">
   <div><p class="tournament-status">${t.closed?'Tournament closed':t.open?'Open for entries':'Entry unavailable'}</p>
   <h1>VYX Tournament</h1><p>Publish about VYX on X and earn points from engagement.</p>
   <div class="tournament-pool"><strong>${fmt(t.prizes.reduce((sum,n)=>sum+n,0))}</strong> jVYX</div>
   <p>Prize pool for the top ${t.prizes.length} · Ends Nov 29, 23:59 (UTC+5)</p></div>
   <img src="/assets/jvyx-token-256.png" alt="" width="256" height="256">
  </header>
  <div class="tournament-grid">
   <section class="tournament-card tournament-entry"><h2>Join the tournament</h2>
    <p class="tournament-cost"><strong>10,000 jVYX</strong><span>+ 0.00002 ETH service fee and network gas</span></p>
    <p>Pay on Robinhood Chain. Your wallet may ask for token approval first.</p>${entry}${submission}
   </section>
   <section class="tournament-card"><h2>How to earn points</h2>
    <p>Submit one original post or quote per day mentioning <a href="https://x.com/vyxsocial" target="_blank" rel="noopener noreferrer">@vyxsocial</a>.</p>
    <dl class="tournament-metrics"><div><dt>100 views</dt><dd>+1</dd></div><div><dt>Like</dt><dd>+3</dd></div><div><dt>Reply</dt><dd>+5</dd></div><div><dt>Repost or quote</dt><dd>+8</dd></div></dl>
    <p>One account per person. Duplicate posts and manipulated engagement are ineligible.</p>
   </section>
  </div>
  <div class="tournament-grid">
   <section class="tournament-card"><h2>Leaderboard</h2><p>Provisional scores. Resubmit your link to refresh after one hour.</p>
    ${t.board.length?`<table><thead><tr><th>Rank</th><th>Participant</th><th>Posts</th><th>Points</th></tr></thead><tbody>${t.board.map((r,i)=>`<tr><td>${i+1}</td><td><strong>${e(r.name)}</strong></td><td>${fmt(r.posts)}</td><td>${fmt(r.score)}</td></tr>`).join('')}</tbody></table>`:'<div class="tournament-empty"><strong>No scored posts yet</strong><p>Verified posts will appear here.</p></div>'}
   </section>
   <section class="tournament-card"><h2>Prizes</h2>
    <div class="tournament-podium">${t.prizes.slice(0,3).map((n,i)=>`<div><span>Rank ${i+1}</span><strong>${fmt(n)}</strong><small>jVYX</small></div>`).join('')}</div>
    <details><summary>See prizes for ranks 4–15</summary>
     <table><thead><tr><th>Rank</th><th>Prize, jVYX</th></tr></thead><tbody>${t.prizes.slice(3).map((n,i)=>`<tr><td>${i+4}</td><td>${fmt(n)}</td></tr>`).join('')}</tbody></table>
    </details><p>Prizes for unfilled places roll over to the next tournament.</p>
   </section>
  </div>
  <a class="tournament-archive" href="#news">News archive →</a>
 </div>`;

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
  const {to,token,approval,allowancePrefix,data:calldata,value,amount}=tournament.payment;
  const addressWord=address=>address.toLowerCase().slice(2).padStart(64,'0');
  const allowance=await wallet.request({method:'eth_call',params:[{to:token,data:allowancePrefix+addressWord(from)+addressWord(to)},'latest']});
  if(BigInt(allowance)<BigInt(amount)){
   const approvalHash=await wallet.request({method:'eth_sendTransaction',params:[{from,to:token,data:approval,value:'0x0'}]});
   let receipt;
   for(let i=0;i<20&&!receipt;i++){
    await new Promise(resolve=>setTimeout(resolve,2000));
    receipt=await wallet.request({method:'eth_getTransactionReceipt',params:[approvalHash]});
   }
   if(receipt?.status!=='0x1')throw Error('Token approval has not succeeded. Check it in your wallet before trying again.');
  }
  await api('tournament-preflight',{});
  const hash=await wallet.request({method:'eth_sendTransaction',params:[{from,to,data:calldata,value}]});
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
