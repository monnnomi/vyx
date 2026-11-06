(()=>{
 let pending=false,lastSent=0;
 async function ping(){
  if(document.hidden||pending||Date.now()-lastSent<20000)return;
  pending=true;
  try{
   const page=location.pathname.startsWith('/admin')?'admin':location.hash.slice(1)||'feed';
   const res=await fetch('/api/presence',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({page})});
   if(res.ok)lastSent=Date.now();
  }catch{}finally{pending=false;}
 }
 ping();setInterval(ping,30000);
 document.addEventListener('visibilitychange',ping);window.addEventListener('hashchange',ping);
 window.addEventListener('vyx-auth-changed',()=>{lastSent=0;ping();});
})();
