import {fail,uuid} from './http.js';
import {canManageStory,newsCategories} from './news-editors.js';
import {newsCommentCount} from './news-comments.js';
import {cleanNewsPhotos} from './news-media.js';
const newsPublisher={name:'VYX',label:'VYX Newsroom',avatar:'/assets/vyx-mark-v1.png'};
const storyTables='FROM news_items n LEFT JOIN news_sources s ON s.id=n.source_id LEFT JOIN users writer ON writer.id=n.author_id';
export function publicNewsItem(row,full=false,viewer=null){
 const list=value=>Array.isArray(value)?value:[];
 const manual=Boolean(row.author_id),manage=canManageStory(viewer,row);
 const publisher=manual&&!row.presentation?.staff?{name:row.writer_name,handle:row.writer_handle,avatar:null}:newsPublisher;
 return {manual,canEdit:manual&&manage,canWithdraw:manage,id:row.id,comments:Number(row.comment_count||0),media:cleanNewsPhotos(row.source_media),language:'en',publisher,kind:row.presentation?.kind||'news',highlights:list(row.presentation?.highlights_en),headings:list(row.presentation?.headings_en),title:row.title_en,summary:row.summary_en,
 ...(full?{paragraphs:list(row.body_en)}:{}),category:row.category,source:{username:row.username,url:row.source_url,publishedAt:row.source_published_at},publishedAt:row.published_at};
}
export async function listNews(db,{category='all',before=null,id=null,viewer=null}={}){
 if(!['all',...newsCategories].includes(category))fail(400,'Invalid news filter.');
 if(id){const [row]=await db.q(`SELECT n.*,s.username,writer.name AS writer_name,writer.handle AS writer_handle,${newsCommentCount('$2')} ${storyTables} WHERE n.id=$1 AND n.status='published'`,[uuid(id),viewer?.id||null]);if(!row)fail(404,'This story is not available.');return {article:publicNewsItem(row,true,viewer)};}
 const cursor=before?uuid(before):null;
 const rows=await db.q(`SELECT n.*,s.username,writer.name AS writer_name,writer.handle AS writer_handle,${newsCommentCount('$3')} ${storyTables}
 WHERE n.status='published' AND ($1='all' OR n.category=$1)
 AND ($2::uuid IS NULL OR (n.published_at,n.id)<(SELECT published_at,id FROM news_items WHERE id=$2 AND status='published'))
 ORDER BY n.published_at DESC,n.id DESC LIMIT 13`,[category,cursor,viewer?.id||null]);
 return {articles:rows.slice(0,12).map(r=>publicNewsItem(r,false,viewer)),next:rows.length>12?rows[11].id:null};
}
