import {withDB} from './db.js';

const origin='https://joinvyx.com';
const homeDescription='VYX is an independent crypto forum for project research, personal blogs, discussions, and community giveaways.';
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const topicUrl=id=>origin+'/topics/'+id;
const topicPath=/^\/topics\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;
const shortened=(value,limit)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,limit);

function page(title,description,url,body){
 const image=origin+'/assets/vyx-apple-touch-v1.png';
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
 <title>${escape(title)}</title><meta name="description" content="${escape(description)}"><link rel="canonical" href="${escape(url)}">
 <meta property="og:type" content="website"><meta property="og:site_name" content="VYX">
 <meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}">
 <meta property="og:url" content="${escape(url)}"><meta property="og:image" content="${image}">
 <meta name="twitter:card" content="summary"><meta name="twitter:site" content="@vyxsocial">
 <link rel="icon" href="/assets/vyx-apple-touch-v1.png"><link rel="stylesheet" href="/public-forum.css"></head>
 <body><header><nav aria-label="VYX"><a href="/">VYX Crypto Forum</a><a href="/topics">Topics</a><a href="/about">About</a></nav></header>
 <main>${body}</main><footer><a href="/privacy.html">Privacy</a> · <a href="https://x.com/vyxsocial">VYX on X</a></footer></body></html>`;
}

function send(req,res,type,body,status=200){
 res.statusCode=status;
 res.setHeader('Content-Type',type+'; charset=utf-8');
 res.setHeader('Cache-Control',status===200?'public, max-age=60':'no-store');
 res.end(req.method==='HEAD'?undefined:body);
}

export async function servePublicForum(path,req,res,useDB=withDB){
 const match=path.match(topicPath);
 if(!match&&!['/about','/topics','/sitemap.xml'].includes(path))return false;
 const html=(body,status)=>send(req,res,'text/html',body,status);
 if(path==='/about'){
  html(page('About VYX | Crypto forum and community blogs',homeDescription,origin+path,`
   <h1>About VYX</h1><p>${homeDescription}</p>
   <h2>Crypto research and personal blogs</h2><p>Members write about crypto projects they are exploring, share notes about their experience, and discuss what worked or went wrong. Topics are personal spaces where authors post updates and moderate replies.</p>
   <h2>Community giveaways</h2><p>VYX occasionally runs giveaways for forum members. Some rounds are reserved for members who publish on VYX. Each announcement explains the prize and entry rules.</p>
   <p><a href="/topics">Read public topics</a> · <a href="/#giveaways">See giveaways</a> · <a href="/">Open the forum</a></p>`));
  return true;
 }
 if(path==='/sitemap.xml'){
  const rows=await useDB(db=>db.q('SELECT id,active_at FROM forum_topics ORDER BY active_at DESC,id DESC LIMIT 49997'));
  const urls=['/','/about','/topics'].map(path=>`<url><loc>${origin+path}</loc></url>`);
  for(const row of rows)urls.push(`<url><loc>${topicUrl(row.id)}</loc><lastmod>${new Date(row.active_at).toISOString()}</lastmod></url>`);
  send(req,res,'application/xml',`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`);
  return true;
 }
 if(path==='/topics'){
  const rows=await useDB(db=>db.q(`SELECT t.id,t.title,t.description,u.name FROM forum_topics t
   JOIN users u ON u.id=t.owner_id ORDER BY t.active_at DESC,t.id DESC LIMIT 100`));
  html(page('Crypto research topics and community blogs | VYX',
   'Browse public crypto research topics, project notes, and personal blogs from the VYX community.',origin+path,`
   <h1>Crypto research topics</h1><p>Read project notes and personal updates from VYX members.</p>
   ${rows.length?`<ul class="topics">${rows.map(row=>`<li><h2><a href="/topics/${row.id}">${escape(row.title)}</a></h2>
    <p>By ${escape(row.name)}</p><p>${escape(shortened(row.description,220))}</p></li>`).join('')}</ul>`:'<p>No public topics yet.</p>'}
   <p><a href="/#topics">Search topics or start your own</a></p>`));
  return true;
 }
 const id=match[1].toLowerCase();
 const result=await useDB(async db=>{
  const [topic]=await db.q(`SELECT t.title,t.description,u.name FROM forum_topics t
   JOIN users u ON u.id=t.owner_id WHERE t.id=$1`,[id]);
  if(!topic)return null;
  const updates=await db.q(`SELECT body,created_at,edited_at FROM forum_topic_messages
   WHERE topic_id=$1 AND kind='update' ORDER BY created_at DESC,id DESC LIMIT 30`,[id]);
  return {topic,updates};
 });
 if(!result){send(req,res,'text/plain','Topic not found.',404);return true;}
 const {topic,updates}=result;
 const description=shortened(topic.description||updates[0]?.body||`Read ${topic.title} by ${topic.name} on VYX.`,160);
 html(page(topic.title+' | VYX Crypto Forum',description,topicUrl(id),`
  <article><h1>${escape(topic.title)}</h1><p>By ${escape(topic.name)}</p>
   ${topic.description?`<p class="message">${escape(topic.description)}</p>`:''}
   <p><a href="/?topic=${id}#topics">Open the discussion on VYX</a></p>
   ${updates.length?`<h2>Author updates</h2>${updates.map(update=>{
    const timestamp=new Date(update.created_at).toISOString();
    return `<section class="update"><time datetime="${timestamp}">${timestamp.slice(0,10)}</time><p class="message">${escape(update.body)}</p></section>`;
   }).join('')}`:''}
  </article>`));
 return true;
}
