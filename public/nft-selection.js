'use strict';
let nftSelectionData=null,nftSelectionOwner=null,nftSelectionState='loading',nftSelectionRequest=0;

async function loadNftSelection(){
 const owner=data.user?.id,request=++nftSelectionRequest;
 nftSelectionOwner=owner;nftSelectionData=null;nftSelectionState='loading';
 if(!owner)return;
 try{
  const result=await api('nft-selection');
  if(request!==nftSelectionRequest||owner!==data.user?.id)return;
  nftSelectionData=result;nftSelectionState='ready';
 }catch{
  if(request===nftSelectionRequest&&owner===data.user?.id)nftSelectionState='error';
 }
}

function nftEligibilityHTML(){
 if(!data.user)return '';
 const own=nftSelectionOwner===data.user.id,d=own?nftSelectionData:null;
 const header=`<header><div><span class="eyebrow">JUST FOR YOU</span><h2 id="nft-selection-heading">Your NFT eligibility</h2></div><span class="nft-private">Private</span></header>`;
 if(!own||nftSelectionState==='loading')return `<section class="nft-selection" aria-labelledby="nft-selection-heading">${header}<p role="status">Checking your confirmed VP and invitations…</p></section>`;
 if(nftSelectionState==='error'||!d)return `<section class="nft-selection" aria-labelledby="nft-selection-heading">${header}<p role="status">Your eligibility could not be loaded.</p><button class="secondary" data-nft-selection-refresh>Try again</button></section>`;
 const labels={'free':'Free NFT','half-price':'50% off','full-price':'Full price'};
 const message=d.tier==='free'?'You meet both requirements for a free NFT.':d.tier==='half-price'?`You qualify for 50% off. Invite ${fmt(d.referralsRemaining)} more ${d.referralsRemaining===1?'member':'members'} for a free NFT.`:`Earn ${fmt(d.vpRemaining)} more confirmed VP to unlock 50% off.${d.referralsRemaining?` For a free NFT, you also need ${fmt(d.referralsRemaining)} more ${d.referralsRemaining===1?'invitation':'invitations'}.`:' Your invitation requirement for a free NFT is already complete.'}`;
 return `<section class="nft-selection tier-${e(d.tier)}" aria-labelledby="nft-selection-heading">${header}<div class="nft-selection-result"><strong>${labels[d.tier]}</strong><p>${message}</p></div><div class="nft-selection-progress"><div><span>Confirmed lifetime VP</span><strong>${fmt(d.confirmedVP)} <small>/ ${fmt(d.rules.vp)}</small></strong><progress aria-label="VP requirement" max="${d.rules.vp}" value="${Math.min(d.confirmedVP,d.rules.vp)}"></progress><small>${d.vpRemaining?`${fmt(d.vpRemaining)} VP to go`:'Requirement met'}</small></div><div><span>Registered referrals</span><strong>${fmt(d.invitedReferrals)} <small>/ ${d.rules.referrals}</small></strong><progress aria-label="Referral requirement" max="${d.rules.referrals}" value="${Math.min(d.invitedReferrals,d.rules.referrals)}"></progress><small>${d.referralsRemaining?`${fmt(d.referralsRemaining)} more for a free NFT`:'Requirement met'}</small></div></div><details class="nft-selection-rules"><summary>Selection criteria</summary><ul><li>50,000+ VP and 3 invited referrals: free NFT.</li><li>50,000+ VP: 50% off.</li><li>Everyone else: full price.</li></ul><p>Only confirmed lifetime VP and referrals registered through your link count. This is your current eligibility; it updates as you progress.</p></details><footer><small>Visible to you and VYX administrators.</small><button class="text-link" data-nft-selection-refresh>Refresh status</button></footer></section>`;
}

document.addEventListener('click',async ev=>{
 const button=ev.target.closest('[data-nft-selection-refresh]');if(!button||page!=='profile'||!data.user)return;
 const owner=data.user.id;button.disabled=true;
 const loading=loadNftSelection();render();await loading;
 if(page==='profile'&&owner===data.user?.id)render();
});
window.addEventListener('vyx-auth-changed',()=>{nftSelectionRequest++;nftSelectionData=null;nftSelectionOwner=null;nftSelectionState='loading';});
