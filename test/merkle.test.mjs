import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildClaimTree,verifyClaim,claimLeaf} from '../server/merkle.js';

const addr=i=>'0x'+i.toString(16).padStart(40,'0');
test('claim trees prove every allocation and reject altered claims',()=>{
 for(const n of [1,2,3,5,8,13,100]){
  const entries=Array.from({length:n},(_,i)=>({address:addr(i+1),allocation:BigInt(i+1)*10n**18n}));
  const tree=buildClaimTree(entries);
  assert.equal(BigInt(tree.total),entries.reduce((s,e)=>s+e.allocation,0n));
  for(const e of entries){
   const c=tree.claims[e.address];assert.ok(verifyClaim(tree.root,e.address,c.allocation,c.proof));
   assert.equal(verifyClaim(tree.root,e.address,BigInt(c.allocation)+1n,c.proof),false);
   if(n>1)assert.equal(verifyClaim(tree.root,addr(999),c.allocation,c.proof),false);
  }
 }
});
test('a single-entry root is the leaf itself and bad input is refused',()=>{
 const t=buildClaimTree([{address:addr(7),allocation:5n}]);
 assert.equal(t.root,'0x'+claimLeaf(addr(7),5n).toString('hex'));assert.deepEqual(t.claims[addr(7)].proof,[]);
 assert.throws(()=>buildClaimTree([]),/at least one/);
 assert.throws(()=>buildClaimTree([{address:addr(1),allocation:1n},{address:addr(1).toUpperCase().replace('0X','0x'),allocation:2n}]),/Duplicate/);
 assert.throws(()=>buildClaimTree([{address:addr(1),allocation:0n}]),/positive/);
 assert.throws(()=>buildClaimTree([{address:'0x12',allocation:1n}]),/Invalid address/);
});
