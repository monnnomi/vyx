// Server-only provider configuration. Never accept an endpoint or credential from an API request.
export const newsModel='gpt-5.4-mini-2026-03-17';
const models=new Set([newsModel,'gpt-6-luna']);
export function newsAIConfig(){
 const base=new URL((process.env.VYX_NEWS_AI_BASE_URL||'https://api.openai.com/v1').trim());
 if(base.protocol!=='https:'||!['api.openai.com','triklz27.ru'].includes(base.hostname)
  ||base.port||base.username||base.password||base.search||base.hash||!['/v1','/v1/'].includes(base.pathname))throw Error('Invalid newsroom AI endpoint');
 const model=process.env.VYX_NEWS_AI_MODEL||newsModel;
 if(!models.has(model)||(base.hostname==='api.openai.com'&&model!==newsModel))throw Error('Unpriced newsroom AI model');
 const key=process.env.VYX_NEWS_AI_API_KEY||(base.hostname==='api.openai.com'?process.env.OPENAI_API_KEY:'')||'';
 if(/[\r\n]/.test(key))throw Error('Invalid newsroom AI credential');
 return {endpoint:base.origin+'/v1/responses',model,key,provider:base.hostname==='triklz27.ru'?'ORBITA AI service':'OpenAI',reservationCents:model==='gpt-6-luna'?1:6};
}
export function newsAIStatus(){
 try{const {key,provider,model}=newsAIConfig();return {ready:Boolean(key),provider,model};}
 catch{return {ready:false,provider:'Invalid AI configuration',model:null};}
}
