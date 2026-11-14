import {waitUntil as vercelWaitUntil} from '@vercel/functions';
const pending=new Set();
export function waitUntil(promise){
 if(process.env.VYX_RUNTIME!=='node')return vercelWaitUntil(promise);
 const task=Promise.resolve(promise).catch(()=>console.error('VYX background task failed')).finally(()=>pending.delete(task));
 pending.add(task);
}
export async function drainBackground(){await Promise.allSettled([...pending]);}
