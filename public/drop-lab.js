'use strict';
let labEpoch=0;
const lab=s=>document.querySelector(s);
function labReduced(){return lab('#lab-motion').checked||matchMedia('(prefers-reduced-motion: reduce)').matches;}
function labReset(){stopWonderAudio();labEpoch++;lab('#lab-scene').innerHTML=dropSceneHTML('ready');lab('#lab-state').textContent='Ready when you are.';lab('#lab-caption').textContent='A preview of the light, motion and sound. No account needed.';lab('#lab-result').hidden=true;lab('#lab-start').disabled=false;lab('#lab-start').textContent='Preview opening';}
function labResult(){lab('#lab-state').textContent='Your contribution, revealed.';lab('#lab-caption').textContent='Illustrative result · no points credited';lab('#lab-result').hidden=false;lab('#lab-start').disabled=false;lab('#lab-start').textContent='Play again';}
lab('#lab-start').addEventListener('click',()=>{
 labReset();prepareWonderAudio();const epoch=labEpoch;lab('#lab-start').disabled=true;
 if(labReduced()){labResult();playWonderChime();return;}
 lab('.sky-scene').dataset.skyState='arriving';lab('#lab-state').textContent='A moment is arriving…';lab('#lab-caption').textContent='The real VYX opening shows only a confirmed result.';
 setTimeout(()=>{if(epoch!==labEpoch)return;lab('.sky-scene').dataset.skyState='opening';lab('#lab-state').textContent='Opening your drop…';playWonderOpening();setTimeout(()=>{if(epoch===labEpoch)labResult();},DROP_SCENE_TIMING.opening);},DROP_SCENE_TIMING.arrival);
});
lab('#lab-skip').addEventListener('click',()=>{stopWonderAudio();labEpoch++;labResult();});
lab('#lab-reset').addEventListener('click',labReset);
lab('#lab-motion').addEventListener('change',ev=>{document.body.dataset.motion=ev.target.checked?'reduced':'auto';labReset();});
lab('#lab-sound').innerHTML=wonderSoundButton();preloadWonder();labReset();
