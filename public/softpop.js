// Soft Pop presentation helpers. Purely visual: reads values already on the page,
// never calls the API and never changes what is stored or awarded.
(()=>{
  const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches||document.body.dataset.motion==='reduced';
  const ROUND_MS=4*60*60*1000;
  const seen=new WeakSet();

  function roundProgress(){
    document.querySelectorAll('.vyx-round-teaser').forEach(box=>{
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

  function countUp(el){
    if(seen.has(el)||reduced())return;
    seen.add(el);
    const text=el.textContent;
    const m=/^([^\d]*)([\d,]+)(.*)$/s.exec(text);
    if(!m)return;
    const target=Number(m[2].replace(/,/g,''));
    if(!(target>0))return;
    const start=performance.now(),dur=900;
    const step=now=>{
      // Stop if the app re-rendered the value underneath us.
      if(!el.isConnected||(el.dataset.spFinal&&el.dataset.spFinal!==text))return;
      const t=Math.min(1,(now-start)/dur),e=1-Math.pow(1-t,3);
      el.textContent=m[1]+Math.round(target*e).toLocaleString('en-US')+m[3];
      if(t<1)requestAnimationFrame(step);else el.textContent=text;
    };
    el.dataset.spFinal=text;
    requestAnimationFrame(step);
  }

  function shapes(){
    const hero=document.querySelector('.conversation-stage .vyx-welcome');
    if(!hero||hero.querySelector('.sp-shape'))return;
    for(const s of ['s1','s2','s3']){
      const i=document.createElement('i');
      i.className='sp-shape '+s;i.setAttribute('aria-hidden','true');
      hero.appendChild(i);
    }
  }

  const KEYS=['.chat-directory-footer b','.x-task-summary>strong','.vyx-reward-summary strong','.ranking-podium-score','.drop-metrics strong'];
  const lastShown=new Map();
  function enhance(){
    roundProgress();shapes();
    KEYS.forEach(sel=>document.querySelectorAll(sel).forEach((el,i)=>{
      if(seen.has(el))return;
      seen.add(el);
      let target=null;
      if(el.children.length===0)target=el;
      else if(el.firstChild&&el.firstChild.nodeType===3&&el.firstChild.textContent.trim())target=wrap(el);
      if(!target)return;
      // Animate a figure once per value, not on every re-render of the same number.
      const key=sel+'#'+i,text=target.textContent;
      if(lastShown.get(key)===text)return;
      lastShown.set(key,text);
      countUp(target);
    }));
  }
  function wrap(el){
    // "<strong>1,234 <small>…</small></strong>": animate only the leading text node.
    const span=document.createElement('span');span.className='sp-count';
    span.textContent=el.firstChild.textContent;el.replaceChild(span,el.firstChild);return span;
  }

  let queued=false;
  const schedule=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;enhance()})};
  const boot=()=>{enhance();new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});setInterval(roundProgress,15000)};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
