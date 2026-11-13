import {newsAIConfig} from './news-ai.js';
import {reserveNewsCost} from './news-budget.js';
export function newsAITimeout(deadline,now=Date.now()){
 const remaining=Math.floor(Math.min(30000,deadline-now));
 if(!Number.isFinite(remaining)||remaining<4000)throw Error('news-run-deadline');
 return remaining;
}
export async function newsAIRequest(db,fetcher,name,format,payload,instructions,deadline,maxOutputTokens=3200){
 const config=newsAIConfig();if(!config.key)throw Error('AI credential missing');
 const input=JSON.stringify(payload);if(Buffer.byteLength(input+instructions)>48000)throw Error('input-too-large');
 const timeoutMs=newsAITimeout(deadline);
 await reserveNewsCost(db,'ai',config.reservationCents);
 const r=await fetcher(config.endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(timeoutMs),headers:{Authorization:'Bearer '+config.key,'Content-Type':'application/json'},body:JSON.stringify({model:config.model,store:false,instructions,input,max_output_tokens:maxOutputTokens,reasoning:{effort:'none'},text:{format:{type:'json_schema',name,strict:true,schema:format}}})});
 if(!r.ok)throw Error('upstream-'+r.status);
 const raw=await r.text();if(Buffer.byteLength(raw)>250000)throw Error('oversized-response');const result=JSON.parse(raw);
 if(result.status!=='completed')throw Error('incomplete-ai-output');
 const output=(result.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');
 return JSON.parse(output);
}
