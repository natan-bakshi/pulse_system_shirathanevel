import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';

async function composer(){
 const compiled=await build({
  entryPoints:['base44/functions/generateManualQuotePdf/entry.ts'],
  bundle:true,format:'esm',platform:'node',write:false,
  plugins:[{name:'mocks',setup(b){
   b.onResolve({filter:/^npm:@base44\/sdk/},()=>({path:'sdk',namespace:'mock'}));
   b.onResolve({filter:/^npm:sanitize-html/},()=>({path:'html',namespace:'mock'}));
   b.onLoad({filter:/.*/,namespace:'mock'},args=>({
    contents:args.path==='sdk'?'export const createClientFromRequest=()=>({});':'export default value=>String(value);'
   }));
   b.onLoad({filter:/generateManualQuotePdf\/entry\.ts$/},async a=>({
    contents:(await readFile(a.path,'utf8'))+'\nexport {composeManualQuoteHtml};',
    loader:'js'
   }));
  }}]
 });
 const module=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
 return module.composeManualQuoteHtml;
}
const render=await composer();
const approved=(id,source,value)=>({
 source_entity:'QuoteTemplate',source_id:id,locale:'en',status:'approved',
 fields:{content:{source,value}}
});
const terms='<p>תשלום ראשון 100 ש״ח</p>';
const translatedTerms='<p>First payment: 100 NIS</p>';
function client({templates=[],records=[],event=null}={}){
 const entries={
  AppSettings:{list:async()=>[{setting_key:'vat_rate',setting_value:'18'}]},
  QuoteTemplate:{list:async()=>templates},
  ContentTranslation:{filter:async()=>records},
  Event:{get:async()=>event},
  Service:{list:async()=>[]},
  EventService:{filter:async()=>[]},
  Payment:{filter:async()=>[]}
 };
 return {asServiceRole:{entities:entries}};
}
const template={id:'terms',template_type:'payment_terms',content:terms};
const unused={id:'unused',template_type:'concept_intro',
 identifier:'unused',content:'<p>טקסט שלא משמש בהצעה</p>'};
const blocks=[
 {id:'head-1',type:'heading',content:'כותרת מיוחדת',
  english:{content:{source:'כותרת מיוחדת',value:'Special Heading'}},
  options:{level:2,align:'center'}},
 {id:'terms-1',type:'payment_terms',options:{templateId:'terms'}}
];
test('manual English translates fixed headings, custom sections, used terms and direction',async()=>{
 const {html,fileBaseName}=await render({
  title:'הצעה ידנית',document_language:'en',blocks:JSON.stringify(blocks)
 },client({templates:[template,unused],records:[approved('terms',terms,translatedTerms)]}));
 assert.equal(fileBaseName,'Manual Quotation');
 assert.ok(html.includes('lang="en" dir="ltr"'));
 assert.ok(html.includes('Special Heading'));
 assert.ok(html.includes(translatedTerms));
 assert.ok(html.includes('Payment Terms'));
 assert.ok(!html.includes('תנאי תשלום'));
 assert.ok(!html.includes('טקסט שלא משמש בהצעה'));
});
test('manual Hebrew path remains unchanged',async()=>{
 const {html}=await render({
  title:'הצעה ידנית',document_language:'he',blocks:JSON.stringify(blocks)
 },client({templates:[template,unused]}));
 assert.ok(html.includes('lang="he"'));
 assert.ok(html.includes('כותרת מיוחדת'));
 assert.ok(html.includes(terms));
 assert.ok(html.includes('תנאי תשלום'));
 assert.ok(!html.includes('Special Heading'));
});
test('missing translation of a visible manual block stops English PDF',async()=>{
 const stale={...blocks[0],content:'כותרת אחרת'};
 await assert.rejects(render({
  title:'הצעה ידנית',document_language:'en',
  blocks:JSON.stringify([stale])
 },client()),e=>e.code==='ENGLISH_TRANSLATION_INCOMPLETE' && e.fields.includes('block.0.content'));
});
test('unrelated Hebrew templates never block an English manual quote',async()=>{
 const {html}=await render({
  title:'הצעה ידנית',document_language:'en',
  blocks:JSON.stringify([blocks[0]])
 },client({templates:[unused],records:[]}));
 assert.ok(html.includes('Special Heading'));
 assert.ok(html.includes('lang="en"'));
});
test('linking a missing event fails closed in English, does not issue a document',async()=>{
 await assert.rejects(render({
  title:'הצעה ידנית',document_language:'en',linked_event_id:'missing',
  blocks:JSON.stringify([])
 },client()),/Linked event is unavailable/);
});
test('manual quote declines a translated custom payment with modified numbers',async()=>{
 const custom={id:'custom-payment',type:'payment_terms',
  options:{useCustomContent:true,customContent:'<p>מקדמה 200 שקלים</p>'},
  english:{customContent:{source:'<p>מקדמה 200 שקלים</p>',value:'<p>Deposit: 300 NIS</p>'}}
 };
 await assert.rejects(render({
  title:'Manual',document_language:'en',blocks:JSON.stringify([custom])
 },client()),e=>e.code==='ENGLISH_TRANSLATION_INCOMPLETE');
});

test('manual quote refuses a review value that still contains visible Hebrew',async()=>{
 const source='כותרת מיוחדת';
 const block={id:'heading1',type:'heading',content:source,
  english:{content:{source,value:'Special Heading בעברית'}}};
 await assert.rejects(render({title:'Manual',document_language:'en',
  blocks:JSON.stringify([block])},client()),e=>
   e.code==='ENGLISH_TRANSLATION_INCOMPLETE'&&
   Array.isArray(e.fields)&&e.fields.length===1&&
   !e.fields.includes('document.visible_text'));
});
