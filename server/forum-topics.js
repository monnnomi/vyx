import {messageReactionEmojis} from './message-reactions.js';
import {fail,text,uuid} from './http.js';
import {assertInteraction,hiddenBy} from './social.js';
import {attachMedia,checkMediaRetry,mediaIds,mediaProjection} from './media.js';
import {isAdmin} from './admin.js';
import {storedBlogSettings} from './blog-curation-settings.js';
import {blogPostVersion} from './blog-curation.js';

export async function migrateForumTopics(db) {
 await db.q(`CREATE TABLE IF NOT EXISTS forum_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL, description text NOT NULL, replies_open boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), active_at timestamptz NOT NULL DEFAULT now()
 )`);
 await db.q(`CREATE TABLE IF NOT EXISTS forum_topic_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL REFERENCES forum_topics(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('update','reply')),
  body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), edited_at timestamptz
 )`);
 await db.q('ALTER TABLE forum_topic_messages ADD COLUMN IF NOT EXISTS reply_to uuid REFERENCES forum_topic_messages(id) ON DELETE SET NULL');
 await db.q(`CREATE TABLE IF NOT EXISTS forum_topic_reactions (
  message_id uuid NOT NULL REFERENCES forum_topic_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji text NOT NULL,
  PRIMARY KEY(message_id,user_id)
 )`);
 await db.q('CREATE INDEX IF NOT EXISTS forum_topic_messages_chronology ON forum_topic_messages(topic_id,created_at DESC,id DESC)');
 await db.q('CREATE INDEX IF NOT EXISTS forum_topics_activity ON forum_topics(active_at DESC,id DESC)');
}

export async function migrateForumTopicMedia(db){
 await db.tx(async tx=>{
  await tx.q('ALTER TABLE forum_topic_messages ADD COLUMN IF NOT EXISTS request_id uuid');
  await tx.q('CREATE UNIQUE INDEX IF NOT EXISTS forum_topic_messages_request ON forum_topic_messages(topic_id,author_id,request_id) WHERE request_id IS NOT NULL');
  const [installed]=await tx.q("SELECT 1 FROM pg_constraint WHERE conrelid='media_assets'::regclass AND conname='media_assets_attached_parent'");
  if(installed)return;
  await tx.q(`ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS topic_message_id uuid REFERENCES forum_topic_messages(id),
   DROP CONSTRAINT IF EXISTS media_assets_scope_check,DROP CONSTRAINT IF EXISTS media_assets_check,DROP CONSTRAINT IF EXISTS media_assets_check1,
   ADD CONSTRAINT media_assets_topic_scope CHECK(scope IN('post','comment','room','message','topic')),
   ADD CONSTRAINT media_assets_single_parent CHECK(num_nonnulls(post_id,comment_id,room_message_id,message_id,topic_message_id)<=1),
   ADD CONSTRAINT media_assets_attached_parent CHECK((status='attached')=(num_nonnulls(post_id,comment_id,room_message_id,message_id,topic_message_id)=1))`);
  await tx.q(`CREATE FUNCTION detach_forum_topic_media() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
    UPDATE media_assets SET status='deleting',topic_message_id=NULL,expires_at=clock_timestamp() WHERE topic_message_id=OLD.id;
    RETURN OLD;
   END;
  $$`);
  await tx.q('CREATE TRIGGER detach_forum_topic_media BEFORE DELETE ON forum_topic_messages FOR EACH ROW EXECUTE FUNCTION detach_forum_topic_media()');
  await tx.q('CREATE INDEX IF NOT EXISTS media_topic_message ON media_assets(topic_message_id,position) WHERE topic_message_id IS NOT NULL');
 });
}

function pageOffset(value) {
 const offset=Number(value||0);
 if(!Number.isInteger(offset)||offset<0||offset>100000)fail(400,'Invalid topic page.');
 return offset;
}

export async function forumTopics(db,user,{offset,q}={}) {
 const query=typeof q==='string'?q.trim().slice(0,100):'';
 const topics=await db.q(`SELECT t.id,t.title,t.description,t.active_at,t.replies_open,u.name,u.handle,
   (SELECT count(*)::int FROM forum_topic_messages m WHERE m.topic_id=t.id) AS message_count
  FROM forum_topics t JOIN users u ON u.id=t.owner_id
  WHERE NOT ${hiddenBy('$1','t.owner_id')} AND
    ($3='' OR strpos(lower(t.title),lower($3))>0 OR strpos(lower(u.handle),lower($3))>0)
  ORDER BY t.active_at DESC,t.id DESC LIMIT 26 OFFSET $2`,[user?.id??null,pageOffset(offset),query]);
 const [own]=user?await db.q('SELECT id FROM forum_topics WHERE owner_id=$1',[user.id]):[];
 return {topics:topics.slice(0,25),more:topics.length>25,ownId:own?.id??null};
}

export async function forumTopic(db,user,id,offset) {
 const [topic]=await db.q(`SELECT t.*,u.name,u.handle FROM forum_topics t JOIN users u ON u.id=t.owner_id
  WHERE t.id=$2 AND NOT ${hiddenBy('$1','t.owner_id')}`,[user?.id??null,uuid(id)]);
 if(!topic)fail(404,'Topic not found.');
 const owner=topic.owner_id===user?.id;
 const messages=await db.q(`SELECT m.id,m.body,m.kind,m.author_id,m.created_at,m.edited_at,u.name,u.handle,u.avatar_url,
  ${mediaProjection('m','topic_message_id')},
  r.id AS reply_id,left(r.body,140) AS reply_body,ru.name AS reply_name,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('emoji',a.emoji,'count',a.n,'mine',a.mine) ORDER BY a.emoji)
   FROM (SELECT emoji,count(*)::int AS n,COALESCE(bool_or(user_id=$1),false) AS mine
    FROM forum_topic_reactions WHERE message_id=m.id GROUP BY emoji) a),'[]'::jsonb) AS reactions
  FROM forum_topic_messages m JOIN users u ON u.id=m.author_id
  LEFT JOIN forum_topic_messages r ON r.id=m.reply_to AND NOT ${hiddenBy('$1','r.author_id')}
  LEFT JOIN users ru ON ru.id=r.author_id
  WHERE m.topic_id=$2 AND NOT ${hiddenBy('$1','m.author_id')}
  ORDER BY m.created_at DESC,m.id DESC LIMIT 31 OFFSET $3`,[user?.id??null,topic.id,pageOffset(offset)]);
 if(isAdmin(user)&&await storedBlogSettings(db)){
  const selections=await db.q(`SELECT c.message_id,c.status='approved' AND c.published_at IS NOT NULL
   AND c.reviewed_body=m.body AND c.reviewed_edit IS NOT DISTINCT FROM m.edited_at AS published
   FROM blog_curations c JOIN forum_topic_messages m ON m.id=c.message_id
   WHERE m.topic_id=$1 AND m.id=ANY($2::uuid[])`,[topic.id,messages.map(message=>message.id)]);
  for(const message of messages)if(message.kind==='update'&&message.author_id===topic.owner_id){
   message.homepage_published=selections.some(row=>row.message_id===message.id&&row.published);
   message.homepage_version=blogPostVersion(message);
  }
 }
 return {topic:{...topic,owner},messages:messages.slice(0,30),more:messages.length>30};
}

export async function createForumTopic(db,user,input) {
 const title=text(input.title,3,90),description=text(input.description??'',0,500);
 const [topic]=await db.q(`INSERT INTO forum_topics(owner_id,title,description)
  VALUES($1,$2,$3) ON CONFLICT(owner_id) DO NOTHING RETURNING id`,[user.id,title,description]);
 if(!topic)fail(409,'You already have a topic.');
 return topic;
}

export async function changeForumTopic(db,user,action,input) {
 const id=uuid(input.topicId);
 return db.tx(async tx=>{
  const [topic]=await tx.q('SELECT owner_id,replies_open FROM forum_topics WHERE id=$1 FOR UPDATE',[id]);
  if(!topic)fail(404,'Topic not found.');
  const owner=topic.owner_id===user.id;
  if(action==='topic-settings'){
   if(!owner)fail(403,'Only the topic owner can change its settings.');
   if(typeof input.repliesOpen!=='boolean')fail(400,'Choose whether members can reply.');
   await tx.q('UPDATE forum_topics SET title=$2,description=$3,replies_open=$4 WHERE id=$1',
    [id,text(input.title,3,90),text(input.description??'',0,500),input.repliesOpen]);
  }else if(action==='topic-message'){
   await assertInteraction(tx,user.id,topic.owner_id);
   if(!owner&&!topic.replies_open)fail(409,'The owner has closed replies.');
   let replyTo=null;
   if(input.replyTo!=null){
    replyTo=uuid(input.replyTo);
    const [parent]=await tx.q(`SELECT author_id FROM forum_topic_messages WHERE id=$1 AND topic_id=$2
     AND NOT ${hiddenBy('$3','author_id')}`,[replyTo,id,user.id]);
    if(!parent)fail(404,'The message you are replying to is unavailable.');
    await assertInteraction(tx,user.id,parent.author_id);
   }
   const ids=mediaIds(input.mediaIds),content=text(input.body,ids.length?0:1,3500);
   const requestId=input.requestId==null?null:uuid(input.requestId);
   if(requestId){
    const [previous]=await tx.q('SELECT id,body,reply_to FROM forum_topic_messages WHERE topic_id=$1 AND author_id=$2 AND request_id=$3',[id,user.id,requestId]);
    if(previous){
     if(previous.body!==content||previous.reply_to!==replyTo)fail(409,'Please start a new message request.');
     await checkMediaRetry(tx,'topic',previous.id,ids);
     return {ok:true};
    }
   }
   const [message]=await tx.q('INSERT INTO forum_topic_messages(topic_id,author_id,kind,body,reply_to,request_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
    [id,user.id,owner&&!replyTo?'update':'reply',content,replyTo,requestId]);
   await attachMedia(tx,user,'topic',id,message.id,ids);
   await tx.q('UPDATE forum_topics SET active_at=now() WHERE id=$1',[id]);
  }else{
   const messageId=uuid(input.messageId);
   const [message]=await tx.q('SELECT author_id FROM forum_topic_messages WHERE topic_id=$1 AND id=$2',[id,messageId]);
   if(!message)fail(404,'Message not found.');
   const author=message.author_id===user.id;
   if(action==='topic-reaction'){
    const {emoji,enabled}=input;
    if(!messageReactionEmojis.includes(emoji)||typeof enabled!=='boolean')fail(400,'Choose a reaction.');
    await assertInteraction(tx,user.id,topic.owner_id);
    await assertInteraction(tx,user.id,message.author_id);
    if(enabled)await tx.q(`INSERT INTO forum_topic_reactions(message_id,user_id,emoji) VALUES($1,$2,$3)
     ON CONFLICT(message_id,user_id) DO UPDATE SET emoji=EXCLUDED.emoji`,[messageId,user.id,emoji]);
    else await tx.q('DELETE FROM forum_topic_reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3',[messageId,user.id,emoji]);
   }else if(action==='topic-message-edit'){
    if(!author)fail(403,'Only the author can edit this message.');
    const [attached]=await tx.q("SELECT 1 FROM media_assets WHERE topic_message_id=$1 AND status='attached' LIMIT 1",[messageId]);
    await tx.q('UPDATE forum_topic_messages SET body=$2,edited_at=now() WHERE id=$1',[messageId,text(input.body,attached?0:1,3500)]);
   }else if(action==='topic-message-delete'){
    if(!owner&&!author)fail(403,'Only the topic owner or author can remove this message.');
    await tx.q('DELETE FROM forum_topic_messages WHERE id=$1',[messageId]);
   }
  }
  return {ok:true};
 });
}
