import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {build} from 'esbuild';
import {
  matchesResidualEnglishSample,hebrewTextNodesInTranslation,
  substituteExactHebrewTextNode
} from '../src/i18n/quoteEnglishReviewHelpers.js';
async function load(path){
 const b=await build({entryPoints:[path],bundle:true,platform:'node',
  format:'esm',write:false,plugins:[{name:'runtime',setup(s){
   s.onResolve({filter:/^npm:sanitize-html/},()=>({namespace:'stub',path:'sanitizer'}));
   s.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export default v=>String(v);'}));
  }}]});
 return import('data:text/javascript;base64,'+
  Buffer.from(b.outputFiles[0].text).toString('base64'));
}
const {generateQuoteHtml}=await load('base44/shared/quoteHtml.ts');
const {translationPreservesProtectedContent,visibleHebrewQuoteSnippets,translationIndex,
  quoteVisibleFragmentField,applyReviewedEventQuoteFragments}=await load('base44/shared/quoteLocalization.ts');
const original='<p>Bank 563 — חשבון 136610 — בעל החשבון אבי תמים הפקות</p>';
const partial='<p>Bank 563 — account 136610 — Account holder: <span dir="rtl">אבי תמים הפקות</span></p>';

test('Hebrew bank owner inside already reviewed English content is rejected as incomplete',()=>{
 assert.equal(translationPreservesProtectedContent(original,partial),false);
 assert.deepEqual(hebrewTextNodesInTranslation(partial),['אבי תמים הפקות']);
 assert.equal(matchesResidualEnglishSample(partial,['אבי תמים הפקות']),true);
});

test('partial bank name can be repaired in place without editing original HTML, bank data or links',()=>{
 const fixed=substituteExactHebrewTextNode(partial,'אבי תמים הפקות','Avi Tamim Productions');
 assert.ok(fixed.includes('Avi Tamim Productions'));
 assert.ok(!fixed.includes('אבי תמים הפקות'));
 assert.ok(fixed.includes('Bank 563'));
 assert.ok(fixed.includes('136610'));
 assert.equal(translationPreservesProtectedContent(original,fixed),true);
 assert.equal(substituteExactHebrewTextNode(partial,'אבי תמים הפקות','<script>'),null);
 assert.equal(substituteExactHebrewTextNode(partial,'אבי תמים הפקות','אבי'),null);
 assert.equal(substituteExactHebrewTextNode(partial,'חבילה לא קיימת','Missing'),null);
 assert.equal(original,'<p>Bank 563 — חשבון 136610 — בעל החשבון אבי תמים הפקות</p>');
});

test('English PDF composer returns the actionable payment template ID instead of a document-only error',async()=>{
 const event={id:'ev-bank',family_name:'Family',event_name:'Family',child_name:'David',
  event_date:'2027-09-10',event_type:'bar_mitzvah',location:'Jerusalem',
  schedule:[],parents:[],concept:'',status:'quote',guest_count:20};
 const template={id:'payment-bank',template_type:'payment_terms',identifier:'default',content:original};
 const translation={id:'ct-bank',source_entity:'QuoteTemplate',source_id:template.id,
  status:'approved',locale:'en',fields:{content:{source:original,value:partial}}};
 const entities={
  Event:{get:async()=>event},
  EventService:{filter:async()=>[]},
  Service:{list:async()=>[]},
  Payment:{filter:async()=>[]},
  QuoteTemplate:{list:async()=>[template]},
  AppSettings:{list:async()=>[{setting_key:'vat_rate',setting_value:'18'}]},
  QuoteOrganizerType:{list:async()=>[]},
  ContentTranslation:{filter:async()=>[translation]}
 };
 const client={asServiceRole:{entities}};
 await assert.rejects(generateQuoteHtml(event.id,client,{language:'en',
  includeIntro:false,includePaymentTerms:true,includeSchedule:false}),e=>
  e.code==='ENGLISH_TRANSLATION_INCOMPLETE'&&
  e.fields.includes('template.payment-bank.content')&&
  !e.fields.includes('document.visible_text'));
 const repaired=substituteExactHebrewTextNode(partial,'אבי תמים הפקות','Avi Tamim Productions');
 entities.ContentTranslation.filter=async()=>[{
  ...translation,fields:{content:{source:original,value:repaired}}
 }];
 const result=await generateQuoteHtml(event.id,client,{language:'en',
  includeIntro:false,includePaymentTerms:true,includeSchedule:false});
 assert.deepEqual(visibleHebrewQuoteSnippets(result.html),[]);
 assert.ok(result.html.includes('Avi Tamim Productions'));
 assert.ok(result.html.includes('136610'));
 assert.equal(template.content,original,'Stored Hebrew source remains intact');
});

test('event-scoped approval repairs exactly one renderer-only text node, never HTML tags or other events',()=>{
 const source='שם פרטי בחשבון',value='Official Account Holder';
 const name=quoteVisibleFragmentField(source);
 const row={source_entity:'Event',source_id:'ev1',locale:'en',status:'approved',
   fields:{[name]:{source,value}}};
 const approved=translationIndex([row]);
 const html='<html><head><style>.x{content:"שם פרטי בחשבון"}</style></head>'+
   '<body><!-- שם פרטי בחשבון --><div title="שם פרטי בחשבון">שם פרטי בחשבון</div>'+
   '<p>שם פרטי בחשבון נוסף</p><p>Bank 136610</p></body></html>';
 const result=applyReviewedEventQuoteFragments(html,approved,'ev1');
 assert.ok(result.includes('<div title="שם פרטי בחשבון">Official Account Holder</div>'));
 assert.ok(result.includes('<style>.x{content:"שם פרטי בחשבון"}</style>'));
 assert.ok(result.includes('<!-- שם פרטי בחשבון -->'));
 assert.ok(result.includes('<p>שם פרטי בחשבון נוסף</p>'));
 assert.ok(result.includes('Bank 136610'));
 assert.equal(applyReviewedEventQuoteFragments(html,approved,'other-event'),html);
 assert.equal(quoteVisibleFragmentField('  שם פרטי בחשבון  '),name);
 const unsafe=translationIndex([{...row,fields:{[name]:{source,value:'Other Account 889999'}}}]);
 assert.equal(applyReviewedEventQuoteFragments(html,unsafe,'ev1'),html);
 const injected=translationIndex([{...row,fields:{[name]:{source,value:'<script>alert(1)</script>'}}}]);
 assert.equal(applyReviewedEventQuoteFragments(html,injected,'ev1'),html);
});

test('fallback source approved for one event repairs encoded visible Hebrew from a legacy renderer',async()=>{
 const event={id:'ev-legacy',family_name:'Family',event_name:'Family',child_name:'David',
  event_date:'2027-09-10',event_type:'bar_mitzvah',location:'Jerusalem',
  schedule:[],parents:[],concept:'',status:'quote',guest_count:20};
 const template={id:'legacy-payment',template_type:'payment_terms',
  identifier:'default',content:'<p>Bank 136610 owner: &#1488;&#1489;</p>'};
 const fields={};
 const entities={
  Event:{get:async()=>event},EventService:{filter:async()=>[]},
  Service:{list:async()=>[]},Payment:{filter:async()=>[]},
  QuoteTemplate:{list:async()=>[template]},
  AppSettings:{list:async()=>[{setting_key:'vat_rate',setting_value:'18'}]},
  QuoteOrganizerType:{list:async()=>[]},
  ContentTranslation:{filter:async()=>[]}
 };
 const client={asServiceRole:{entities}};
 await assert.rejects(generateQuoteHtml(event.id,client,{
  language:'en',includeIntro:false,includeSchedule:false
 }),e=>e.code==='ENGLISH_TRANSLATION_INCOMPLETE'&&
  e.fields.includes('document.visible_text')&&
  e.samples.some(s=>s.includes('Bank 136610 owner: אב')));
 const snippet='Bank 136610 owner: אב';
 fields[quoteVisibleFragmentField(snippet)]={source:snippet,value:'Bank 136610 owner: AB'};
 entities.ContentTranslation.filter=async()=>[{
  source_entity:'Event',source_id:event.id,status:'approved',locale:'en',fields
 }];
 const result=await generateQuoteHtml(event.id,client,{
  language:'en',includeIntro:false,includeSchedule:false
 });
 assert.ok(result.html.includes('Bank 136610 owner: AB'));
 assert.deepEqual(visibleHebrewQuoteSnippets(result.html),[]);
 assert.equal(template.content,'<p>Bank 136610 owner: &#1488;&#1489;</p>');
});

test('Quote edit UI exposes already translated templates, opens needed section and offers fragment repair',()=>{
 const src=fs.readFileSync('src/components/event-details/EventQuoteEnglishDialog.jsx','utf8');
 assert.match(src,/for\(const template of quoteTemplates\)/);
 assert.match(src,/matchesResidualEnglishSample\(existing\?\.value,visibleTextSamples\)/);
 assert.match(src,/defaultOpen=\{Array\.isArray\(missingFields\)&&!showAll\}/);
 assert.match(src,/substituteExactHebrewTextNode\(val,fragment,fragmentInputs\[id\]\)/);
 assert.match(src,/QuoteTemplate\.get\(f\.id\)/);
 assert.match(src,/quoteVisibleFragmentField\(sample\)/);
 assert.match(src,/f\.key\.startsWith\('visible_fragment_'\)\?f\.source/);
});
