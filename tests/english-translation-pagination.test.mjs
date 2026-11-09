import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const b=await build({entryPoints:['base44/shared/quoteLocalization.ts'],
 bundle:true,platform:'node',format:'esm',write:false});
const l=await import('data:text/javascript;base64,'+
  Buffer.from(b.outputFiles[0].text).toString('base64'));
function row(i,field='name'){
 return {id:'tr'+i,source_entity:'Service',source_id:'s'+i,
  locale:'en',status:'approved',fields:{[field]:{source:'שירות '+i,value:'Service '+i}}};
}
test('content translations paginate beyond 500 and keep each approved record',async()=>{
 const all=Array.from({length:611},(_,i)=>row(i));
 const calls=[];
 const client={asServiceRole:{entities:{ContentTranslation:{filter:async(q,s,limit,offset)=>{
  calls.push({limit,offset});return all.slice(offset,offset+limit);
 }}}}};
 const index=await l.loadQuoteTranslations(client,'en');
 assert.equal(index.size,611);
 assert.deepEqual(calls.map(x=>x.offset),[0,500]);
 assert.equal(l.approvedField(index,'Service','s609','name','שירות 609'),'Service 609');
});
test('repeated full translation page fails closed, never issues partly translated quote',async()=>{
 const full=Array.from({length:500},(_,i)=>row(i));
 const client={asServiceRole:{entities:{ContentTranslation:{filter:async()=>full}}}};
 await assert.rejects(l.loadQuoteTranslations(client,'en'),/pagination did not advance/);
});
test('newer duplicate approved translation has priority over stale record',()=>{
 const newest={...row(1),fields:{name:{source:'שירות 1',value:'New Wording'}}};
 const old={...row(1),id:'other',fields:{name:{source:'שירות 1',value:'Old Wording'}}};
 const index=l.translationIndex([newest,old]);
 assert.equal(index.get('Service:s1').fields.name.value,'New Wording');
});
test('placeholder IDs and internal links are never changed by a translation',()=>{
 assert.equal(l.translationPreservesProtectedContent(
   '<p>אירוע ([שם_האירוע_123])</p>',
   '<p>Event ([event_name_123])</p>'),false);
 assert.equal(l.translationPreservesProtectedContent(
   '<p><a href="/my/quote/123">פתח</a></p>',
   '<p><a href="/my/quote/999">Open</a></p>'),false);
 assert.equal(l.translationPreservesProtectedContent(
   '<p><a href="/my/quote/123">פתח</a></p>',
   '<p><a href="/my/quote/123">Open</a></p>'),true);
});
test('known Hebrew quote headings with trailing colon localize without touching custom text',()=>{
 assert.equal(l.fixedEnglishLabel('חבילות ושירותים הכלולים בהצעה:'),'Packages & Services Included in This Quote:');
 assert.equal(l.fixedEnglishLabel('פתיחת אירוע חדש: 3 מוזמנים'),'פתיחת אירוע חדש: 3 מוזמנים');
});
