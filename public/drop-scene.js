'use strict';
const DROP_SCENE_TIMING={arrival:2300,opening:3400,release:1280};
// Presentation only. It has no balance, award or random-reward logic.
function dropSceneHTML(state='ready',tier=null){
 const dust=Array.from({length:24},(_,i)=>`<i style="--x:${(i*37+11)%100}%;--y:${(i*23+7)%100}%;--delay:${(i%9)*-.7}s;--duration:${6+i%5}s;--size:${i%4===0?3:2}px"></i>`).join('');
 const collectible=Number.isInteger(tier)&&tier>=0&&tier<4;
 const src=collectible?'/assets/chest-'+['spark','lunar','mystic','radiance'][tier]+'-editorial.webp':'/assets/wonder/reliquary-closed.webp';
 const art=collectible?`<img class="wonder-collectible-body" src="${src}" alt=""><img class="wonder-collectible-lid" src="${src}" alt="">`:`<img class="wonder-chest-closed" src="${src}" alt=""><img class="wonder-chest-open" src="/assets/wonder/reliquary-open.webp" alt="">`;
 const sparks=Array.from({length:28},(_,i)=>`<i style="--dx:${Math.cos(i*2.4)*(85+i%5*24)}px;--dy:${-70-i%7*24}px;--flight:${1.0+i%5*.12}s;--spark-delay:${1280+i%4*35}ms;--spark-color:${i%3?'#ffe2a3':'#d4b7ff'}"></i>`).join('');
 return `<div class="sky-scene wonder-scene ${collectible?'wonder-collectible':''}" data-sky-state="${state}" aria-hidden="true"><div class="wonder-environment"></div><div class="wonder-vignette"></div><div class="wonder-halo"><i></i><i></i></div><div class="wonder-shaft"></div><div class="wonder-rays"></div><div class="wonder-dust">${dust}</div><div class="wonder-floor"></div><div class="wonder-object"><div class="wonder-object-glow"></div>${art}<div class="wonder-seam"></div></div><div class="wonder-release"></div><div class="wonder-sparks">${sparks}</div><div class="wonder-wave"></div><div class="wonder-flare"></div><span class="scene-coordinate">VYX / THE UNEXPECTED</span><span class="scene-serial">MADE TOGETHER</span></div>`;
}
