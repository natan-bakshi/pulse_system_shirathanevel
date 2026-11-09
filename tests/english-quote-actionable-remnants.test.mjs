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
const {translationPreservesProtectedContent,visibleHebrewQuoteSnippets}=await load('base44/shared/quoteLocalization.ts');
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

test('Quote edit UI exposes already translated templates, opens needed section and offers fragment repair',()=>{
 const src=fs.readFileSync('src/components/event-details/EventQuoteEnglishDialog.jsx','utf8');
 assert.match(src,/for\(const template of quoteTemplates\)/);
 assert.match(src,/matchesResidualEnglishSample\(existing\?\.value,visibleTextSamples\)/);
 assert.match(src,/defaultOpen=\{Array\.isArray\(missingFields\)&&!showAll\}/);
 assert.match(src,/substituteExactHebrewTextNode\(val,fragment,fragmentInputs\[id\]\)/);
 assert.match(src,/QuoteTemplate\.get\(f\.id\)/);
});
