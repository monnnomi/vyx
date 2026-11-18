// Update the progress indicators from values already rendered by the app.
(()=>{
  const ROUND_MS=4*60*60*1000;
  function roundProgress(){
    document.querySelectorAll('.vyx-round-teaser,.vyx-room-progress').forEach(box=>{
      const end=box.querySelector('[data-farm-end]');
      if(!end)return;
      const left=new Date(end.dataset.farmEnd).getTime()-Date.now();
      // The countdown text is owned by the app; only the ring is ours. Fall back to the text
      // when the fixture clock makes the timestamp unusable.
      let p=1-left/ROUND_MS;
      if(!(p>=0&&p<=1)){
        const m=/^(\d+):(\d+):(\d+)$/.exec(end.textContent.trim());
        p=m?1-((+m[1]*3600+ +m[2]*60+ +m[3])*1000)/ROUND_MS:0;
      }
      box.style.setProperty('--sp-round',Math.min(1,Math.max(0,p)).toFixed(4));
    });
  }

  function questProgress(){
    const box=document.querySelector('.x-task-summary');if(!box)return;
    const total=Number(box.dataset.taskTotal)||0;
    const earned=Math.min(total,Math.max(0,Number(box.dataset.taskEarned)||0));
    box.style.setProperty('--sp-p',total>0?(earned/total).toFixed(4):'0');
  }

  let frame;
  function update(){
    frame=0;
    roundProgress();
    questProgress();
  }
  function mount(){
    update();
    new MutationObserver(changes=>{
      if(!frame && changes.some(change=>Array.from(change.addedNodes).some(node=>node.nodeType===1))){
        frame=requestAnimationFrame(update);
      }
    }).observe(document.body,{childList:true,subtree:true});
    setInterval(roundProgress,15000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);
  else mount();
})();
