// Merkle trees for VYX token claims, matching OpenZeppelin MerkleProof
// (sorted-pair Keccak-256) and contracts/src/VYXDistributor.sol:
//   leaf = keccak256(bytes.concat(keccak256(abi.encode(account, allocation))))
import {keccak256,isAddress} from './evm.js';

const word=value=>{
 const n=BigInt(value);if(n<0n||n>=1n<<256n)throw new Error('Allocation out of range');
 return Buffer.from(n.toString(16).padStart(64,'0'),'hex');
};
const addressWord=address=>{if(!isAddress(address))throw new Error('Invalid address');return Buffer.concat([Buffer.alloc(12),Buffer.from(address.slice(2),'hex')]);};
const hex=b=>'0x'+b.toString('hex');
const hashPair=(a,b)=>keccak256(Buffer.compare(a,b)<=0?Buffer.concat([a,b]):Buffer.concat([b,a]));

export function claimLeaf(address,allocation){return keccak256(keccak256(Buffer.concat([addressWord(address),word(allocation)])));}

// entries: [{address, allocation}] with allocation in token base units (wei).
// Returns {root, total, claims:{lowercaseAddress:{allocation, proof:[hex32]}}}.
export function buildClaimTree(entries){
 if(!entries.length)throw new Error('A claim tree needs at least one entry');
 const seen=new Set(),leaves=entries.map(({address,allocation})=>{
  const a=String(address).toLowerCase();if(seen.has(a))throw new Error('Duplicate address '+a);seen.add(a);
  if(BigInt(allocation)<=0n)throw new Error('Allocation must be positive');
  return {address:a,allocation:BigInt(allocation),hash:claimLeaf(a,allocation)};
 });
 const levels=[leaves.map(l=>l.hash)];
 while(levels.at(-1).length>1){
  const prev=levels.at(-1),next=[];
  for(let i=0;i<prev.length;i+=2)next.push(i+1<prev.length?hashPair(prev[i],prev[i+1]):prev[i]);
  levels.push(next);
 }
 const claims={};
 leaves.forEach((leaf,index)=>{
  const proof=[];let i=index;
  for(let d=0;d<levels.length-1;d++){const sib=i^1;if(sib<levels[d].length)proof.push(hex(levels[d][sib]));i>>=1;}
  claims[leaf.address]={allocation:leaf.allocation.toString(),proof};
 });
 return {root:hex(levels.at(-1)[0]),total:leaves.reduce((s,l)=>s+l.allocation,0n).toString(),claims};
}

export function verifyClaim(root,address,allocation,proof){
 let h=claimLeaf(address,allocation);
 for(const p of proof)h=hashPair(h,Buffer.from(p.slice(2),'hex'));
 return hex(h)===String(root).toLowerCase();
}
