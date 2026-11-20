// Minimal Ethereum primitives for wallet sign-in, with no third-party packages:
// Keccak-256, secp256k1 public-key recovery, EIP-191 personal messages and
// EIP-55 checksummed addresses. Only verification is needed on the server.

const MASK=(1n<<64n)-1n;
const RC=[0x0000000000000001n,0x0000000000008082n,0x800000000000808an,0x8000000080008000n,0x000000000000808bn,0x0000000080000001n,
 0x8000000080008081n,0x8000000000008009n,0x000000000000008an,0x0000000000000088n,0x0000000080008009n,0x000000008000000an,
 0x000000008000808bn,0x800000000000008bn,0x8000000000008089n,0x8000000000008003n,0x8000000000008002n,0x8000000000000080n,
 0x000000000000800an,0x800000008000000an,0x8000000080008081n,0x8000000000008080n,0x0000000080000001n,0x8000000080008008n];
const ROT=[0,1,62,28,27,36,44,6,55,20,3,10,43,25,39,41,45,15,21,8,18,2,61,56,14];
const rotl=(x,n)=>n===0?x:((x<<BigInt(n))|(x>>BigInt(64-n)))&MASK;
function keccakF(s){
 const b=new Array(25),c=new Array(5);
 for(let round=0;round<24;round++){
  for(let x=0;x<5;x++)c[x]=s[x]^s[x+5]^s[x+10]^s[x+15]^s[x+20];
  for(let x=0;x<5;x++){const d=c[(x+4)%5]^rotl(c[(x+1)%5],1);for(let y=0;y<25;y+=5)s[y+x]^=d;}
  for(let x=0;x<5;x++)for(let y=0;y<5;y++)b[y+5*((2*x+3*y)%5)]=rotl(s[x+5*y],ROT[x+5*y]);
  for(let x=0;x<5;x++)for(let y=0;y<5;y++)s[x+5*y]=b[x+5*y]^((~b[(x+1)%5+5*y]&MASK)&b[(x+2)%5+5*y]);
  s[0]^=RC[round];
 }
}
export function keccak256(input){
 const data=typeof input==='string'?Buffer.from(input,'utf8'):Buffer.from(input),rate=136;
 const padded=Buffer.alloc(Math.ceil((data.length+1)/rate)*rate);data.copy(padded);
 padded[data.length]^=0x01;padded[padded.length-1]^=0x80;
 const s=new Array(25).fill(0n);
 for(let off=0;off<padded.length;off+=rate){
  for(let i=0;i<rate/8;i++)s[i]^=padded.readBigUInt64LE(off+i*8);
  keccakF(s);
 }
 const out=Buffer.alloc(32);for(let i=0;i<4;i++)out.writeBigUInt64LE(s[i],i*8);return out;
}

// secp256k1 over Jacobian coordinates.
export const P=0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
export const N=0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
export const G=[0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n];
const mod=(a,m=P)=>{const r=a%m;return r>=0n?r:r+m;};
export function modPow(b,e,m=P){let r=1n;b=mod(b,m);while(e>0n){if(e&1n)r=r*b%m;b=b*b%m;e>>=1n;}return r;}
export const modInv=(a,m=P)=>modPow(a,m-2n,m);
const toJ=p=>p?[p[0],p[1],1n]:null;
function fromJ(p){if(!p||p[2]===0n)return null;const zi=modInv(p[2]),z2=zi*zi%P;return [mod(p[0]*z2),mod(p[1]*z2%P*zi)];}
function dbl(p){
 if(!p||p[1]===0n)return null;const [x,y,z]=p;
 const yy=y*y%P,s=4n*x%P*yy%P,m=3n*x%P*x%P,x3=mod(m*m-2n*s),y3=mod(m*(s-x3)-8n*yy%P*yy),z3=2n*y%P*z%P;return [x3,y3,z3];
}
function add(p,q){
 if(!p)return q;if(!q)return p;
 const [x1,y1,z1]=p,[x2,y2,z2]=q,z1z1=z1*z1%P,z2z2=z2*z2%P;
 const u1=x1*z2z2%P,u2=x2*z1z1%P,s1=y1*z2%P*z2z2%P,s2=y2*z1%P*z1z1%P;
 if(u1===u2)return s1===s2?dbl(p):null;
 const h=mod(u2-u1),r=mod(s2-s1),hh=h*h%P,hhh=h*hh%P,v=u1*hh%P;
 const x3=mod(r*r-hhh-2n*v),y3=mod(r*(v-x3)-s1*hhh),z3=h*z1%P*z2%P;return [x3,y3,z3];
}
function mulJ(p,k){let r=null,q=p;while(k>0n){if(k&1n)r=add(r,q);q=dbl(q);k>>=1n;}return r;}
export function pointMul(point,k){return fromJ(mulJ(toJ(point),mod(k,N)));}
export function pointAdd(a,b){return fromJ(add(toJ(a),toJ(b)));}

const hex=b=>Buffer.from(b).toString('hex');
const big=b=>BigInt('0x'+(hex(b)||'0'));
export function publicKeyToAddress(point){
 const raw=Buffer.alloc(64);raw.write(point[0].toString(16).padStart(64,'0'),0,'hex');raw.write(point[1].toString(16).padStart(64,'0'),32,'hex');
 return '0x'+hex(keccak256(raw).subarray(12));
}

// Returns the lowercase address that produced `signature` (65 bytes r||s||v) over the 32-byte digest.
export function recoverAddress(digest,signature){
 const sig=Buffer.from(String(signature).replace(/^0x/i,''),'hex');
 if(sig.length!==65||digest.length!==32)throw new Error('Invalid signature');
 const r=big(sig.subarray(0,32)),s=big(sig.subarray(32,64));let v=sig[64];if(v>=27)v-=27;
 if(v!==0&&v!==1)throw new Error('Invalid signature');
 if(r<=0n||r>=N||s<=0n||s>=N)throw new Error('Invalid signature');
 const x=r,alpha=mod(x*x%P*x+7n),beta=modPow(alpha,(P+1n)/4n);
 if(beta*beta%P!==alpha)throw new Error('Invalid signature');
 const y=(beta&1n)===BigInt(v)?beta:P-beta,e=mod(big(digest),N),ri=modInv(r,N);
 const sR=mulJ([x,y,1n],s),eG=mulJ(toJ(G),mod(-e,N)),Q=fromJ(mulJ(add(sR,eG),ri));
 if(!Q)throw new Error('Invalid signature');
 return publicKeyToAddress(Q);
}

export function personalMessageHash(message){
 const bytes=Buffer.from(message,'utf8');
 return keccak256(Buffer.concat([Buffer.from('\x19Ethereum Signed Message:\n'+bytes.length,'utf8'),bytes]));
}
export const isAddress=value=>typeof value==='string'&&/^0x[0-9a-fA-F]{40}$/.test(value);
export function checksumAddress(address){
 if(!isAddress(address))throw new Error('Invalid address');
 const lower=address.slice(2).toLowerCase(),h=hex(keccak256(lower));
 return '0x'+[...lower].map((ch,i)=>parseInt(h[i],16)>=8?ch.toUpperCase():ch).join('');
}
// Mixed-case input must carry a valid EIP-55 checksum; all-lower or all-upper input is accepted.
export function normalizeAddress(address){
 if(!isAddress(address))return null;
 const body=address.slice(2);
 if(body!==body.toLowerCase()&&body!==body.toUpperCase()&&checksumAddress(address)!==address)return null;
 return '0x'+body.toLowerCase();
}
