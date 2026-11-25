import {fail,text,uuid} from './http.js';
import {assertInteraction,hiddenBy} from './social.js';

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
 await db.q('CREATE INDEX IF NOT EXISTS forum_topic_messages_chronology ON forum_topic_messages(topic_id,created_at DESC,id DESC)');
 await db.q('CREATE INDEX IF NOT EXISTS forum_topics_activity ON forum_topics(active_at DESC,id DESC)');
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
 const messages=await db.q(`SELECT m.id,m.body,m.kind,m.author_id,m.created_at,m.edited_at,u.name,u.handle
  FROM forum_topic_messages m JOIN users u ON u.id=m.author_id
  WHERE m.topic_id=$2 AND NOT ${hiddenBy('$1','m.author_id')}
  ORDER BY m.created_at DESC,m.id DESC LIMIT 31 OFFSET $3`,[user?.id??null,topic.id,pageOffset(offset)]);
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
   await tx.q('INSERT INTO forum_topic_messages(topic_id,author_id,kind,body) VALUES($1,$2,$3,$4)',
    [id,user.id,owner?'update':'reply',text(input.body,1,3500)]);
   await tx.q('UPDATE forum_topics SET active_at=now() WHERE id=$1',[id]);
  }else{
   const messageId=uuid(input.messageId);
   const [message]=await tx.q('SELECT author_id FROM forum_topic_messages WHERE topic_id=$1 AND id=$2',[id,messageId]);
   if(!message)fail(404,'Message not found.');
   const author=message.author_id===user.id;
   if(action==='topic-message-edit'){
    if(!author)fail(403,'Only the author can edit this message.');
    await tx.q('UPDATE forum_topic_messages SET body=$2,edited_at=now() WHERE id=$1',[messageId,text(input.body,1,3500)]);
   }else if(action==='topic-message-delete'){
    if(!owner&&!author)fail(403,'Only the topic owner or author can remove this message.');
    await tx.q('DELETE FROM forum_topic_messages WHERE id=$1',[messageId]);
   }
  }
  return {ok:true};
 });
}
