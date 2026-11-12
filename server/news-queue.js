import {createHash} from 'node:crypto';
import {obviousNewsNoise} from './news-policy.js';
const hash=s=>createHash('sha256').update(s).digest('hex');
export function normalizeNewsPost(post,source,now=new Date()){
 if(!/^[0-9]{1,20}$/.test(String(post.id))||String(post.author_id)!==source.x_user_id)return null;
 if(post.referenced_tweets?.some(r=>['retweeted','replied_to'].includes(r.type)))return null;
 const date=Date.parse(post.created_at),age=now.getTime()-date;
 if(!Number.isFinite(date)||age< -600000||age>172800000)return null;
 const text=post.note_tweet?.text||post.text;
 if(typeof text!=='string'||text.trim().length<60||text.length>8000||/[\u0000-\u0008]/.test(text)||/(?:…|\.\.\.)$/.test(text.trim()))return null;
 if(obviousNewsNoise(text))return null;
 return {id:String(post.id),body:text.trim(),publishedAt:new Date(date).toISOString(),url:`https://x.com/${source.username}/status/${post.id}`,hash:hash(text.toLowerCase().replace(/https?:\/\/\S+/g,'').replace(/\s+/g,' ').trim())};
}
export async function enqueueNewsPost(db,post,source,now=new Date()){
 const p=normalizeNewsPost(post,source,now);if(!p)return null;
 const [row]=await db.q(`INSERT INTO news_items(source_id,x_post_id,source_url,source_text,source_published_at,content_hash)
 SELECT $1,$2,$3,$4,$5,$6 FROM news_sources WHERE id=$1 AND enabled AND NOT archived ON CONFLICT DO NOTHING RETURNING id`,[source.id,p.id,p.url,p.body,p.publishedAt,p.hash]);
 return row?.id||null;
}
