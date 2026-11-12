// Original X photo attachments only; no scraping or unrelated image search.
export function cleanNewsPhotos(value){
 if(!Array.isArray(value))return [];
 const photos=[],seen=new Set();
 for(const image of value){
  if(!image||typeof image.url!=='string'||image.url.length>1500)continue;
  try{
   const url=new URL(image.url);
   if(url.protocol!=='https:'||url.hostname!=='pbs.twimg.com'||url.port||url.username||url.password||!/^\/media\/[A-Za-z0-9_-]+(?:\.(?:jpe?g|png|webp|gif))?$/i.test(url.pathname))continue;
   url.hash='';if(seen.has(url.href))continue;seen.add(url.href);
   const size=n=>Number.isInteger(n)&&n>0&&n<=20000?n:null;
   photos.push({url:url.href,alt:typeof image.alt==='string'?image.alt.replace(/[\u0000-\u001f]/g,' ').slice(0,1000):'',width:size(image.width),height:size(image.height)});
   if(photos.length===4)break;
  }catch{}
 }
 return photos;
}
export function extractNewsPhotos(post,includes){
 const keys=Array.isArray(post.attachments?.media_keys)?post.attachments.media_keys.slice(0,4):[];
 const media=Array.isArray(includes?.media)?includes.media:[];
 return cleanNewsPhotos(keys.flatMap(key=>{
  if(typeof key!=='string'||!/^\d+_\d+$/.test(key))return [];
  const matches=media.filter(m=>m?.media_key===key);if(matches.length!==1||matches[0].type!=='photo')return [];
  const m=matches[0];return [{url:m.url,alt:m.alt_text,width:m.width,height:m.height}];
 }));
}
export function newsMediaFields(url){
 const fields=new Set((url.searchParams.get('tweet.fields')||'').split(',').filter(Boolean));fields.add('attachments');
 url.searchParams.set('tweet.fields',[...fields].join(','));
 url.searchParams.set('expansions','attachments.media_keys');
 url.searchParams.set('media.fields','url,type,width,height,alt_text');
}
