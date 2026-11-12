import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/news.js',import.meta.url),'utf8');
function setup(){const handlers={},ctx=vm.createContext({URL,Date,Map,document:{addEventListener:(name,fn)=>handlers[name]=fn},location:{origin:'https://joinvyx.com'},e:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),icon:()=>''});vm.runInContext(source,ctx);return {ctx,handlers};}
test('cover uses the first photo, the article includes every photo with attribution, and text-only stories have no image placeholder',()=>{
 const {ctx}=setup(),article={source:{username:'fixture',url:'https://x.com/fixture/status/123'},media:[{url:'https://pbs.twimg.com/media/one.jpg',alt:'<img onerror=evil>',width:1000,height:600},{url:'https://pbs.twimg.com/media/two.jpg',alt:'Second photo'}]};
 const cover=ctx.newsCover(article),gallery=ctx.newsPhotosHTML(article);assert.ok(cover.includes('one.jpg'));assert.ok(!cover.includes('two.jpg'));assert.ok(cover.includes('2 photos'));assert.ok(gallery.includes('one.jpg'));assert.ok(gallery.includes('two.jpg'));assert.ok(gallery.includes('&lt;img onerror=evil&gt;'));assert.ok(gallery.includes('Images from the original post'));assert.equal(ctx.newsCover({...article,media:[]}), '');assert.equal(ctx.newsPhotosHTML({...article,media:[]}), '');
});
test('a failed image hides only its frame and leaves the article readable',()=>{
 const {handlers}=setup(),frame={hidden:false};handlers.error({target:{matches:()=>true,closest:()=>frame}});assert.equal(frame.hidden,true);
});
