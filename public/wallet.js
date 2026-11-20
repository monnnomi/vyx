'use strict';
// Robinhood Chain wallet on the profile. Works with any injected EVM wallet
// (a browser extension or a wallet app's built-in browser). The server writes
// the sign-in message; the browser only asks the wallet to sign it.
let walletBusy=false;
function walletProvider(){return typeof window!=='undefined'&&window.ethereum&&typeof window.ethereum.request==='function'?window.ethereum:null;}
function walletShort(address){return address.slice(0,6)+'…'+address.slice(-4);}
function walletDay(value){return new Date(value).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});}
function walletCardHTML(){
 const w=data.user?.wallet;if(!w)return '';
 const chain=e(w.chain?.name||'Robinhood Chain');
 if(w.address){
  return `<section class="wallet-card is-linked" aria-labelledby="wallet-heading">
   <div class="wallet-card-head"><div><h2 id="wallet-heading">Your wallet</h2><p>${chain}</p></div><span class="wallet-status">${icon('check')} Linked</span></div>
   <div class="wallet-address"><code title="${e(w.address)}">${e(walletShort(w.address))}</code><button class="text-link" data-wallet-copy>Copy address</button>${w.chain?.explorer?`<a class="text-link" href="${e(w.chain.explorer)}/address/${e(w.address)}" target="_blank" rel="noopener noreferrer">View on explorer ${icon('arrowup')}</a>`:''}</div>
   <p class="wallet-note">VYX Points will be sent to this address on ${chain}. Linked ${e(walletDay(w.linkedAt))}.</p>
   <div class="wallet-actions">${walletProvider()?'<button class="secondary" data-wallet-network>Add network to wallet</button>':''}<button class="text-link wallet-unlink" data-wallet-unlink>Unlink wallet</button></div>
  </section>`;
 }
 const wait=w.newAddressAvailableAt?`<p class="wallet-note">You can link a different wallet after ${e(walletDay(w.newAddressAvailableAt))}. Your previous wallet can be linked again now.</p>`:'';
 const action=walletProvider()
  ?'<div class="wallet-actions"><button class="primary" data-wallet-connect>Connect wallet</button></div>'
  :`<p class="wallet-note">No wallet was found in this browser. Install a wallet extension such as MetaMask, or open VYX in your wallet app’s browser.</p><div class="wallet-actions"><a class="secondary" href="https://metamask.app.link/dapp/${e(location.host)}/#profile">Open in MetaMask</a></div>`;
 return `<section class="wallet-card" aria-labelledby="wallet-heading">
  <div class="wallet-card-head"><div><h2 id="wallet-heading">Link your wallet</h2><p>${chain}</p></div></div>
  <p class="wallet-lead">Connect an EVM wallet to receive VYX Points on ${chain}. Signing is free and does not move any funds.</p>
  ${wait}${action}
 </section>`;
}
function walletHex(text){return '0x'+Array.from(new TextEncoder().encode(text),b=>b.toString(16).padStart(2,'0')).join('');}
async function walletAddNetwork(){
 const w=data.user?.wallet,eth=walletProvider();if(!w?.chain||!eth)return;
 await eth.request({method:'wallet_addEthereumChain',params:[{chainId:'0x'+Number(w.chain.id).toString(16),chainName:w.chain.name,nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:[w.chain.rpc],blockExplorerUrls:[w.chain.explorer]}]});
}
function walletError(err){
 if(err?.code===4001)return 'The request was cancelled in your wallet.';
 if(err?.code===-32002)return 'Your wallet already has a request open. Check your wallet.';
 return err?.message||'Your wallet did not respond. Try again.';
}
document.addEventListener('click',async ev=>{
 const b=ev.target.closest('[data-wallet-connect],[data-wallet-unlink],[data-wallet-unlink-confirm],[data-wallet-copy],[data-wallet-network]');if(!b||!data.user)return;
 if(b.hasAttribute('data-wallet-copy')){try{await navigator.clipboard.writeText(data.user.wallet.address);toast('Address copied');}catch{toast('Copy did not work. Select the address instead.');}return;}
 if(b.hasAttribute('data-wallet-unlink')){showModal('<h2 id="modal-title">Unlink this wallet?</h2><p class="modal-subtitle">You can link the same wallet again at any time. A different wallet can be linked 7 days after unlinking.</p><button class="primary" data-wallet-unlink-confirm>Unlink wallet</button>');return;}
 if(walletBusy)return;walletBusy=true;b.disabled=true;
 try{
  if(b.hasAttribute('data-wallet-unlink-confirm')){await api('wallet-unlink',{});closeModal();toast('Wallet unlinked');await refresh();return;}
  if(b.hasAttribute('data-wallet-network')){await walletAddNetwork();toast('Robinhood Chain is in your wallet');return;}
  const eth=walletProvider();if(!eth)return;
  const [address]=await eth.request({method:'eth_requestAccounts'});
  if(!address)throw new Error('Your wallet did not share an address.');
  const challenge=await api('wallet-challenge',{address});
  const signature=await eth.request({method:'personal_sign',params:[walletHex(challenge.message),challenge.address]});
  await api('wallet-link',{nonce:challenge.nonce,signature});
  toast('Wallet linked');await refresh();
 }catch(err){toast(walletError(err));}
 finally{walletBusy=false;b.disabled=false;}
});
