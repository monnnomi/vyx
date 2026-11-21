'use strict';
// jVYX on the profile: frozen allocations, daily unlocks and the on-chain claim.
// The server sends each member's Merkle proof; the wallet sends one claim
// transaction to VYXDistributor for every live season at once.
let jvyxBusy=false;const jvyxClaimed={};
const JVYX_CLAIM='0xe1021f44',JVYX_CLAIMED='0x120aa877';
function jvyxWord(n){return BigInt(n).toString(16).padStart(64,'0');}
// ABI encoding of claim(uint256[] ids, uint256[] allocations, bytes32[][] proofs).
function jvyxClaimCalldata(ids,allocations,proofs){
 const list=xs=>jvyxWord(xs.length)+xs.map(jvyxWord).join('');
 const a=list(ids),b=list(allocations),inner=proofs.map(p=>jvyxWord(p.length)+p.map(h=>h.slice(2).toLowerCase()).join(''));
 let offset=proofs.length*32,heads='';
 for(const x of inner){heads+=jvyxWord(offset);offset+=x.length/2;}
 const c=jvyxWord(proofs.length)+heads+inner.join('');
 return JVYX_CLAIM+jvyxWord(96)+jvyxWord(96+a.length/2)+jvyxWord(96+a.length/2+b.length/2)+a+b+c;
}
// Mirrors VYXDistributor.unlocked().
function jvyxUnlocked(item,nowMs){
 const start=Date.parse(item.startsAt)/1000,now=Math.floor(nowMs/1000),amount=BigInt(item.amount);
 if(now<start)return 0n;if(item.tranches<=1)return amount;
 const steps=BigInt(1+Math.floor((now-start)/item.intervalSeconds));
 return steps>=BigInt(item.tranches)?amount:amount*steps/BigInt(item.tranches);
}
function jvyxFormat(wei){
 const v=BigInt(wei),whole=v/10n**18n,frac=(v%10n**18n)*100n/10n**18n;
 return whole.toLocaleString('en-US')+(frac?'.'+frac.toString().padStart(2,'0').replace(/0$/,''):'');
}
function jvyxEth(wei){return (Number(BigInt(wei))/1e18).toString();}
function tokenCardHTML(){
 const t=data.user?.tokens;if(!t||!t.items?.length)return '';
 const now=Date.now(),live=t.items.filter(i=>i.status==='live');
 const total=t.items.reduce((s,i)=>s+BigInt(i.amount),0n),unlocked=live.reduce((s,i)=>s+jvyxUnlocked(i,now),0n);
 const claimed=live.reduce((s,i)=>s+(jvyxClaimed[i.onchainId]?.[i.address.toLowerCase()]??0n),0n),known=live.every(i=>jvyxClaimed[i.onchainId]?.[i.address.toLowerCase()]!==undefined);
 const row=i=>{
  const note=i.status==='live'?`${jvyxFormat(jvyxUnlocked(i,now))} unlocked · ${i.tranches>1?`unlocks daily over ${i.tranches} days`:'fully unlocked'}`
   :i.status==='needs-wallet'?'Link your wallet below to receive these tokens.':'Being prepared for your wallet. Check back soon.';
  return `<li><div><strong>${e(i.label)}</strong><small>${note}</small></div><span>${e(jvyxFormat(i.amount))} ${e(t.symbol)}</span></li>`;
 };
 const hasWallet=typeof walletProvider==='function'&&Boolean(walletProvider());
 const add=hasWallet&&t.token?`<button class="secondary" data-jvyx-watch>Add ${e(t.symbol)} to wallet</button>`:'';
 const action=live.length&&hasWallet
  ?`<div class="wallet-actions"><button class="primary" data-jvyx-claim>Claim ${e(t.symbol)}</button>${add}</div><p class="wallet-note">Each claim is one transaction: network gas plus a ${e(jvyxEth(t.claimFee))} ETH service fee.</p>`
  :live.length?'<p class="wallet-note">Open VYX in a browser with your wallet to claim.</p>':add?`<div class="wallet-actions">${add}</div>`:'';
 return `<section class="wallet-card token-card" aria-labelledby="token-heading">
  <div class="wallet-card-head"><div><h2 id="token-heading">${e(t.name)}</h2><p>${e(t.symbol)} on Robinhood Chain</p></div>${t.token?`<a class="text-link" href="${e(t.explorer)}/token/${e(t.token)}" target="_blank" rel="noopener noreferrer">Token ${icon('arrowup')}</a>`:''}</div>
  <div class="token-totals"><div><small>Total</small><strong>${e(jvyxFormat(total))}</strong></div><div><small>Unlocked</small><strong>${e(jvyxFormat(unlocked))}</strong></div>${live.length&&known?`<div><small>Claimed</small><strong>${e(jvyxFormat(claimed))}</strong></div>`:''}</div>
  <ul class="token-items">${t.items.map(row).join('')}</ul>
  ${action}
 </section>`;
}
async function jvyxEnsureChain(eth,t){
 const id='0x'+Number(t.chainId).toString(16);
 if((await eth.request({method:'eth_chainId'}))===id)return;
 try{await eth.request({method:'wallet_switchEthereumChain',params:[{chainId:id}]});}
 catch(err){if(err?.code!==4902)throw err;await walletAddNetwork();await eth.request({method:'wallet_switchEthereumChain',params:[{chainId:id}]});}
}
async function jvyxReadClaimed(eth,t,items){
 for(const i of items){
  const data=JVYX_CLAIMED+jvyxWord(i.onchainId)+jvyxWord(BigInt(i.address));
  const out=await eth.request({method:'eth_call',params:[{to:t.distributor,data},'latest']});
  (jvyxClaimed[i.onchainId]||={})[i.address.toLowerCase()]=BigInt(out&&out!=='0x'?out:0);
 }
}
async function jvyxClaim(){
 const t=data.user.tokens,eth=walletProvider();if(!eth||!t?.distributor)return;
 const [account]=await eth.request({method:'eth_requestAccounts'});
 const mine=t.items.filter(i=>i.status==='live'&&i.address.toLowerCase()===String(account||'').toLowerCase());
 if(!mine.length){const want=t.items.find(i=>i.status==='live');throw new Error(`Switch your wallet to ${want.address.slice(0,6)}…${want.address.slice(-4)} to claim.`);}
 await jvyxEnsureChain(eth,t);await jvyxReadClaimed(eth,t,mine);
 const now=Date.now(),due=mine.filter(i=>jvyxUnlocked(i,now)>jvyxClaimed[i.onchainId][i.address.toLowerCase()]);
 if(!due.length){render();throw new Error('Nothing to claim yet. More tokens unlock tomorrow.');}
 const hash=await eth.request({method:'eth_sendTransaction',params:[{from:account,to:t.distributor,value:'0x'+BigInt(t.claimFee).toString(16),
  data:jvyxClaimCalldata(due.map(i=>i.onchainId),due.map(i=>i.amount),due.map(i=>i.proof))}]});
 toast('Claim sent. Your tokens arrive when the transaction confirms.');
 return hash;
}
// The ERC-20 contract has no image; wallets show this one when the token is added from VYX.
const JVYX_IMAGE='/assets/jvyx-token-256.png';
function jvyxWatchParams(t,origin){return {type:'ERC20',options:{address:t.token,symbol:t.symbol,decimals:t.decimals,image:origin+JVYX_IMAGE}};}
async function jvyxWatch(){
 const t=data.user.tokens,eth=walletProvider();if(!eth||!t?.token)return;
 await jvyxEnsureChain(eth,t);
 if(await eth.request({method:'wallet_watchAsset',params:jvyxWatchParams(t,location.origin)}))toast(`${t.symbol} is in your wallet.`);
}
document.addEventListener('click',async ev=>{
 const w=ev.target.closest('[data-jvyx-watch]');if(!w||!data.user)return;
 w.disabled=true;
 try{await jvyxWatch();}catch(err){toast(walletError(err));}
 finally{w.disabled=false;}
});
document.addEventListener('click',async ev=>{
 const b=ev.target.closest('[data-jvyx-claim]');if(!b||!data.user||jvyxBusy)return;
 jvyxBusy=true;b.disabled=true;
 try{const hash=await jvyxClaim();if(hash)setTimeout(async()=>{try{const eth=walletProvider();await jvyxReadClaimed(eth,data.user.tokens,data.user.tokens.items.filter(i=>i.status==='live'));render();}catch{}},8000);}
 catch(err){toast(walletError(err));}
 finally{jvyxBusy=false;b.disabled=false;}
});
