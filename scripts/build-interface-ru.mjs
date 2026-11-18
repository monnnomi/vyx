// Build a Russian presentation from authored UI strings. Runtime values, user
// content, URLs, selectors and action attributes are never passed to a translator.
import {parse} from 'acorn';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=new URL('../',import.meta.url);
const publicDir=new URL('public/',root);
const localeDir=new URL('assets/interface-ru/',publicDir);
const pagesDir=new URL('server/generated-interface-ru/',root);
const catalog=new Map();
for(const row of (await readFile(new URL('locales/interface-ru.tsv',root),'utf8')).split(/\r?\n/)){
  if(!row)continue;
  const [english,russian,...extra]=row.split('\t');
  if(!russian||extra.length||catalog.has(english))throw Error('Invalid translation: '+english);
  catalog.set(english,russian);
}
const seen=new Map();
let file='';
function phrase(text,context){
  const raw=text.trim(),slots=[];
  const key=raw.replace(/⟦\d+⟧/g,token=>{slots.push(token);return '⟦'+(slots.length-1)+'⟧';});
  if(!/[a-z]/i.test(key))return text;
  if(!seen.has(key))seen.set(key,new Set());
  seen.get(key).add(file+':'+context);
  const result=catalog.get(key);
  if(!result)return text;
  if((key.match(/⟦\d+⟧/g)||[]).join()!==(result.match(/⟦\d+⟧/g)||[]).join())throw Error('Changed interpolation order: '+key);
  return text.replace(raw,()=>result.replace(/⟦(\d+)⟧/g,(_,n)=>slots[n]));
}
function markup(html){
  // Preserve all tags and non-display attributes exactly, including query strings.
  return html.split(/(<!--[\s\S]*?-->|<\/?[a-zA-Z!](?:[^>"']|"[^"]*"|'[^']*')*>)/g).map((part,i)=>{
    if(i%2===0)return phrase(part,'html');
    return part.replace(/\s(aria-label|alt|title|placeholder)="([^"]*)"/g,(whole,attr,value)=>' '+attr+'="'+phrase(value,'attr')+'"');
  }).join('');
}
const pluralWords=new Map([
  ['member/members',['участник','участника','участников']],['message/messages',['сообщение','сообщения','сообщений']],
  ['room/rooms',['комната','комнаты','комнат']],['view/views',['просмотр','просмотра','просмотров']],
  ['person/people',['человек','человека','человек']],['invitation/invitations',['приглашение','приглашения','приглашений']]
]);
function translateJS(source){
  const ast=parse(source,{ecmaVersion:'latest',sourceType:'script'}),edits=[];
  function visit(node,parent){
    // These pairs are display nouns in count === 1 ? singular : plural. The same
    // lowercase strings elsewhere are route names, data keys or action IDs.
    if(node.type==='ConditionalExpression' && node.test.operator==='===' &&
       node.test.right?.value===1 && node.consequent.type==='Literal' && node.alternate.type==='Literal'){
      const nouns=pluralWords.get(node.consequent.value+'/'+node.alternate.value);
      if(nouns){
        const count=source.slice(node.test.left.start,node.test.left.end);
        edits.push([node.start,node.end,'vyxRussianNumberWord('+count+','+JSON.stringify(nouns)+')']);
        return;
      }
    }
    if(node.type==='Literal'&&typeof node.value==='string'){
      const s=node.value;
      const result=s.includes('<')&&/<[a-z!/]/i.test(s)?markup(s):phrase(s,'js');
      if(result!==s){
        // Non-computed property access, APIs and selectors remain code. Only
        // exact, reviewed catalog entries can change a string literal.
        edits.push([node.start,node.end,JSON.stringify(result)]);
      }
    }else if(node.type==='TemplateLiteral'){
      const original=node.quasis.map((q,i)=>(i?'⟦'+(i-1)+'⟧':'')+q.value.raw).join('');
      const result=/<[a-z!/]/i.test(original)?markup(original):phrase(original,'template');
      const parts=result.split(/⟦\d+⟧/);
      if(parts.length!==node.quasis.length)throw Error('Invalid template in '+file);
      node.quasis.forEach((q,i)=>{if(parts[i]!==q.value.raw)edits.push([q.start,q.end,parts[i]]);});
      node.expressions.forEach(expr=>visit(expr,node));
      return;
    }
    for(const item of Object.values(node)){
      if(Array.isArray(item))item.forEach(child=>{if(child?.type)visit(child,node);});
      else if(item?.type)visit(item,node);
    }
  }
  visit(ast,null);
  let output=source;
  for(const [start,end,value] of edits.sort((a,b)=>b[0]-a[0]))output=output.slice(0,start)+value+output.slice(end);
  if(file==='app.js')output+="\nconst vyxRuPlurals=new Intl.PluralRules('ru');\nfunction vyxRussianNumberWord(n,words){const form=vyxRuPlurals.select(n);return words[form==='one'?0:form==='few'?1:2];}\n";
  parse(output,{ecmaVersion:'latest',sourceType:'script'});
  return output;
}
const index=await readFile(new URL('index.html',publicDir),'utf8');
const names=Array.from(index.matchAll(/<script\b[^>]*?src="\/?([\w-]+\.js)"[^>]*>/g),m=>m[1]);
await Promise.all([mkdir(localeDir,{recursive:true}),mkdir(pagesDir,{recursive:true})]);
const localized=new Set();
for(file of names){
  if(file==='analytics-config.js')continue;
  const source=await readFile(new URL(file,publicDir),'utf8'),output=translateJS(source);
  if(output!==source){await writeFile(new URL(file,localeDir),output);localized.add(file);}
}
for(file of ['index.html','privacy.html']){
  const source=await readFile(new URL(file,publicDir),'utf8');
  const html=markup(source).replace('<html lang="en">','<html lang="ru">')
    .replace(/(<script\b[^>]*?src=")\/?([\w-]+\.js)"/g,(m,prefix,name)=>localized.has(name)?prefix+'/assets/interface-ru/'+name+'"':m);
  await writeFile(new URL(file,pagesDir),html);
}
if(process.argv.includes('--inventory')){
  await writeFile(resolve('/tmp/vyx-ui-language-inventory.json'),JSON.stringify(Object.fromEntries([...seen].map(([k,v])=>[k,[...v]])),null,2));
}
console.log('Russian interface built ('+localized.size+' scripts, '+catalog.size+' text entries).');
