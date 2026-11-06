// Original VYX sound design: a latch, rising air, a low impact and glass overtones.
// Deterministic noise is audio texture only; this script has no reward logic.
import {writeFile,mkdir} from 'node:fs/promises';
const rate=22050,seconds=4.2,frames=Math.ceil(rate*seconds),channels=2;
const samples=[new Float64Array(frames),new Float64Array(frames)];
let seed=78231,low=0,previous=0;
const noise=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/2147483648-1;};
for(let i=0;i<frames;i++){
 const t=i/rate,n=noise();low+=.09*(n-low);const hiss=n-previous;previous=n;
 let center=0,left=0,right=0;
 for(const hit of [.07,.37]){const u=t-hit;if(u>=0&&u<.14)center+=(.11*n+.08*Math.sin(2*Math.PI*1620*u))*Math.exp(-u*55)*(1-Math.exp(-u*900));}
 if(t>.28&&t<1.28){const u=(t-.28);const lift=Math.pow(u,2.5);center+=.10*low*lift+.018*Math.sin(2*Math.PI*(91*u+62*u*u))*lift;}
 const impact=t-1.28;
 if(impact>=0){const env=(1-Math.exp(-impact*180))*Math.exp(-impact*5);center+=.31*Math.sin(2*Math.PI*(58*impact+10*(1-Math.exp(-impact*12))))*env+.08*low*Math.exp(-impact*12);}
 const notes=[293.665,440,587.33,739.989,880,1174.66,1760];
 for(let k=0;k<notes.length;k++){
  const u=t-(1.28+k*.075);if(u<0)continue;
  const env=(1-Math.exp(-u*70))*Math.exp(-u*(1.5+k*.15));
  const bell=(Math.sin(2*Math.PI*notes[k]*u)+.22*Math.sin(2*Math.PI*notes[k]*2.006*u)+.06*Math.sin(2*Math.PI*notes[k]*3.98*u))*env*.052/(1+k*.18);
  const pan=(k%2?1:-1)*(.12+k*.045);left+=bell*Math.sqrt((1-pan)/2);right+=bell*Math.sqrt((1+pan)/2);
 }
 if(t>1.28&&t<2.8){const u=t-1.28,env=(1-Math.exp(-u*12))*Math.exp(-u*3.5);center+=hiss*.025*env;}
 const fade=Math.min(1,t/.006,(seconds-t)/.12);
 samples[0][i]=(center+left)*Math.max(0,fade);samples[1][i]=(center+right)*Math.max(0,fade);
}
let peak=0;for(const c of samples)for(const x of c)peak=Math.max(peak,Math.abs(x));
const bytes=frames*channels*2,out=Buffer.alloc(44+bytes);out.write('RIFF');out.writeUInt32LE(36+bytes,4);out.write('WAVEfmt ',8);out.writeUInt32LE(16,16);out.writeUInt16LE(1,20);out.writeUInt16LE(channels,22);out.writeUInt32LE(rate,24);out.writeUInt32LE(rate*channels*2,28);out.writeUInt16LE(channels*2,32);out.writeUInt16LE(16,34);out.write('data',36);out.writeUInt32LE(bytes,40);
for(let i=0;i<frames;i++)for(let c=0;c<channels;c++)out.writeInt16LE(Math.round(samples[c][i]/peak*.78*32767),44+(i*channels+c)*2);
await mkdir(new URL('../public/assets/audio/',import.meta.url),{recursive:true});await writeFile(new URL('../public/assets/audio/chest-open.wav',import.meta.url),out);
console.log('Original 4.2-second stereo chest sound built ('+out.length+' bytes).');
