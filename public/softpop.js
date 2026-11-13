// Soft Pop presentation helpers. Purely visual: reads values already on the page,
// never calls the API and never changes what is stored or awarded.
(()=>{
  const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches||document.body.dataset.motion==='reduced';
  const ROUND_MS=4*60*60*1000;
  const seen=new WeakSet();

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

  const SVG={
    star:'<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 3l6.5 12.2 13.3-4-4 13.3L60 31l-12.2 6.5 4 13.3-13.3-4L32 59l-6.5-12.2-13.3 4 4-13.3L4 31l12.2-6.5-4-13.3 13.3 4z" fill="var(--sp-mint)" stroke="var(--sp-edge)" stroke-width="2.5" stroke-linejoin="round"/></svg>',
    bubble:'<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M8 10h48a4 4 0 014 4v28a4 4 0 01-4 4H28L14 58V46H8a4 4 0 01-4-4V14a4 4 0 014-4z" fill="var(--sp-sky)" stroke="var(--sp-edge)" stroke-width="2.5" stroke-linejoin="round"/><path d="M17 23h30M17 32h19" stroke="var(--sp-edge)" stroke-width="2.5" stroke-linecap="round"/></svg>',
    coin:'<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="28" fill="var(--sp-sun)" stroke="var(--sp-edge)" stroke-width="2.5"/><circle cx="32" cy="32" r="21" fill="none" stroke="var(--sp-edge)" stroke-width="1.5" stroke-dasharray="3 4"/><text x="32" y="39" text-anchor="middle" font-family="DM Sans,sans-serif" font-weight="800" font-size="19" fill="#15172b">VP</text></svg>',
    block:'<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="5" y="5" width="54" height="54" rx="16" fill="var(--sp-coral)" stroke="var(--sp-edge)" stroke-width="2.5"/></svg>',
    ring:'<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="22" fill="none" stroke="var(--sp-violet)" stroke-width="12"/><circle cx="32" cy="32" r="28" fill="none" stroke="var(--sp-edge)" stroke-width="2.5"/><circle cx="32" cy="32" r="16" fill="none" stroke="var(--sp-edge)" stroke-width="2.5"/></svg>'
  };
  const SHAPES=[['s1','block',26],['s2','coin',40],['s3','star',18],['s4','bubble',32],['s5','ring',14]];

  function shapes(hero){
    if(hero.querySelector('.sp-shape'))return;
    for(const [cls,kind,depth] of SHAPES){
      const i=document.createElement('i');
      i.className='sp-shape '+cls;i.setAttribute('aria-hidden','true');i.style.setProperty('--d',depth);
      i.innerHTML='<b>'+SVG[kind]+'</b>';
      hero.appendChild(i);
    }
  }

  // "Line one<br>Line two<br><span>Line three</span>" -> masked lines that slide up one after another.
  function splitHeadline(hero){
    const h=hero.querySelector('h1');
    if(!h||h.dataset.spSplit)return;
    h.dataset.spSplit='1';
    const lines=[[]];
    [...h.childNodes].forEach(n=>{if(n.nodeName==='BR')lines.push([]);else lines[lines.length-1].push(n)});
    h.textContent='';
    lines.filter(l=>l.length).forEach((nodes,i)=>{
      const line=document.createElement('span');line.className='sp-line';
      const inner=document.createElement('span');inner.className='sp-line-in';inner.style.animationDelay=(0.08+i*0.12)+'s';
      nodes.forEach(n=>inner.appendChild(n));line.appendChild(inner);h.appendChild(line);
    });
  }

  // Two rows of the real, currently listed rooms. Clicking a pill opens that room through the
  // existing list button, so there is no second code path for joining.
  function marquee(hero){
    const rows=[...document.querySelectorAll('.chat-room-list .room-row[data-room-open]')];
    const sig=rows.map(r=>r.dataset.roomOpen).join('|');
    let band=hero.querySelector('.sp-marquee');
    if(!rows.length){if(band)band.remove();return}
    if(band&&band.dataset.sig===sig)return;
    if(!band){
      band=document.createElement('div');band.className='sp-marquee';band.setAttribute('aria-hidden','true');
      const before=hero.querySelector('.vyx-quick-start');
      hero.insertBefore(band,before);
      band.addEventListener('click',e=>{
        const pill=e.target.closest('[data-sp-room]');if(!pill)return;
        const btn=[...document.querySelectorAll('.chat-room-list .room-row[data-room-open]')].find(r=>r.dataset.roomOpen===pill.dataset.spRoom);
        if(btn)btn.click();
      });
    }
    band.dataset.sig=sig;band.textContent='';
    const items=rows.map(r=>({id:r.dataset.roomOpen,name:(r.querySelector('.room-row-name')||r).textContent.trim()})).filter(x=>x.name);
    if(!items.length){band.remove();return}
    for(let t=0;t<2;t++){
      const track=document.createElement('div');track.className='sp-track'+(t?' rev':'');
      let list=t?[...items].reverse():[...items];
      while(list.length<8)list=list.concat(list);
      for(let half=0;half<2;half++)list.forEach((it,i)=>{
        const b=document.createElement('button');b.type='button';b.tabIndex=-1;b.className='sp-pill c'+((i+t*2)%5);
        b.dataset.spRoom=it.id;b.textContent=it.name;track.appendChild(b);
      });
      track.style.animationDuration=Math.max(28,list.length*5)+'s';
      band.appendChild(track);
    }
  }

  let pointerBound=new WeakSet();
  function pointer(hero){
    if(pointerBound.has(hero))return;pointerBound.add(hero);
    let raf=0,mx=0,my=0;
    hero.addEventListener('pointermove',e=>{
      if(reduced()||e.pointerType==='touch')return;
      const r=hero.getBoundingClientRect();
      mx=((e.clientX-r.left)/r.width-.5)*2;my=((e.clientY-r.top)/r.height-.5)*2;
      if(!raf)raf=requestAnimationFrame(()=>{raf=0;hero.style.setProperty('--mx',mx.toFixed(3));hero.style.setProperty('--my',my.toFixed(3))});
    });
    hero.addEventListener('pointerleave',()=>{hero.style.setProperty('--mx',0);hero.style.setProperty('--my',0)});
  }

  // Phone: one "round island" replaces the pitch card's timer line and the floating rewards bar.
  // It mirrors values the app already renders and forwards taps to the app's own button.
  const phone=matchMedia('(max-width:720px)');
  function island(){
    const dir=document.querySelector('.chat-directory');
    const head=dir&&dir.querySelector('.chat-directory-heading');
    let el=dir&&dir.querySelector('.sp-island');
    if(!head||!phone.matches){if(el)el.remove();return}
    const foot=dir.querySelector('.chat-directory-footer button');
    const vp=dir.querySelector('.chat-directory-footer b');
    const src=dir.querySelector('.vyx-mobile-start [data-farm-end]')||document.querySelector('[data-farm-end]');
    document.body.classList.toggle('sp-member',!!vp);
    if(!el){
      el=document.createElement('button');el.type='button';el.className='sp-island';
      el.innerHTML='<span class="sp-island-ring" aria-hidden="true"></span><span class="sp-island-copy"><span class="sp-island-label">Round closes in</span><span class="sp-island-time"></span></span><span class="sp-island-chip"></span>';
      el.addEventListener('click',()=>{const b=document.querySelector('.chat-directory-footer button');if(b)b.click()});
      head.after(el);
    }
    const time=src?src.textContent.trim():'';
    const chip=vp?vp.textContent.trim():'Join';
    const t=el.querySelector('.sp-island-time'),c=el.querySelector('.sp-island-chip');
    if(t.textContent!==time)t.textContent=time;
    if(c.textContent!==chip)c.textContent=chip;
    el.hidden=!time||!foot;
    el.setAttribute('aria-label',(time?'Round closes in '+time+'. ':'')+(vp?'Your rewards: '+chip:'Connect to join the conversation'));
    const m=/^(\d+):(\d+):(\d+)$/.exec(time);
    if(m)el.style.setProperty('--sp-round',Math.min(1,Math.max(0,1-((+m[1]*3600+ +m[2]*60+ +m[3])*1000)/ROUND_MS)).toFixed(4));
  }

  // Quests use the server-backed total, independent of text or number animations.
  function questProgress(){
    const box=document.querySelector('.x-task-summary');if(!box)return;
    const total=Number(box.dataset.taskTotal)||0;
    const earned=Math.min(total,Math.max(0,Number(box.dataset.taskEarned)||0));
    box.style.setProperty('--sp-p',total>0?(earned/total).toFixed(4):'0');
  }

  // Legibility floor: older stylesheets set many labels at 6-10px. Lift any text below 12px,
  // once per element, leaving the illustrated drop scene alone.
  const sized=new WeakSet();
  function legible(){
    const walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    let n;const todo=[];
    while((n=walk.nextNode())){
      const el=n.parentElement;
      if(!el||sized.has(el)||!n.textContent.trim())continue;
      sized.add(el);
      if(el.closest('svg,.wonder-scene,.sky-scene,script,style'))continue;
      todo.push(el);
    }
    const small=todo.filter(el=>parseFloat(getComputedStyle(el).fontSize)<12);
    small.forEach(el=>{el.style.fontSize='12px'});
  }
  let legibleQueued=false;
  function queueLegible(){
    if(legibleQueued)return;legibleQueued=true;
    (window.requestIdleCallback||(f=>setTimeout(f,120)))(()=>{legibleQueued=false;legible()});
  }

  function hero(){
    const el=document.querySelector('.conversation-stage .vyx-welcome');
    if(!el)return;
    splitHeadline(el);shapes(el);marquee(el);pointer(el);
  }

  const KEYS=['.chat-directory-footer b','.x-task-summary>strong','.vyx-reward-summary strong','.ranking-podium-score','.drop-metrics strong'];
  const lastShown=new Map();
  function enhance(){
    roundProgress();hero();island();questProgress();queueLegible();
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
  const boot=()=>{enhance();new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});setInterval(roundProgress,15000);setInterval(island,1000);phone.addEventListener('change',island)};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
