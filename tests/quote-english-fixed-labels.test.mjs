import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';

async function load(file,extra=''){
 const compiled=await build({entryPoints:[file],bundle:true,platform:'node',format:'esm',write:false,plugins:[{
  name:'runtime',setup(b){
   b.onResolve({filter:/^npm:@base44\/sdk/},()=>({path:'sdk',namespace:'stub'}));
   b.onResolve({filter:/^npm:sanitize-html/},()=>({path:'sanitize',namespace:'stub'}));
   b.onLoad({filter:/.*/,namespace:'stub'},a=>({
    contents:a.path==='sdk'?'export const createClientFromRequest=()=>({});':'export default value=>String(value);'
   }));
   if(extra)b.onLoad({filter:/generateManualQuotePdf\/entry\.ts$/},async a=>({
    contents:(await readFile(a.path,'utf8'))+extra,loader:'js'
   }));
  }
 }]});
 return import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
}
const {generateQuoteHtml}=await load('base44/shared/quoteHtml.ts');
const {composeModularQuoteHtml}=await load('base44/shared/modularQuote.ts');
const {composeManualQuoteHtml}=await load(
 'base44/functions/generateManualQuotePdf/entry.ts','\nexport {composeManualQuoteHtml};'
);
function fixture(){
 const event={
  id:'event1',family_name:'Smith',event_name:'Smith Bar Mitzvah',
  child_name:'David',event_type:'bar_mitzvah',location:'Jerusalem',
  city:'Jerusalem',guest_count:85,event_date:'2027-11-12',
  event_time:'10:00',status:'quote',concept:'',notes:'',schedule:[
   {time:'10:00',activity:'Welcome Reception'},
   {time:'11:30',activity:'Torah Aliyah'}],
  parents:[{name:'Betty Smith'},{name:'Antonio Smith'}],
  primary_currency:'ILS'
 };
 const es={id:'es1',event_id:'event1',service_id:'s1',service_name:'Four-Piece Band',
  service_description:'Live music for family celebrations',
  quantity:1,custom_price:6500,show_price_in_quote:true,
  includes_vat:false,client_notes:'',price_display_mode:'default'};
 const entities={
  Event:{get:async()=>event},EventService:{filter:async()=>[es]},
  Service:{list:async()=>[{id:'s1',service_name:es.service_name,
    service_description:es.service_description,base_price:6500}]},
  Payment:{filter:async()=>[{amount:1000}]},
  QuoteTemplate:{list:async()=>[]},
  AppSettings:{list:async()=>[{setting_key:'vat_rate',setting_value:'18'}]},
  QuoteOrganizerType:{list:async()=>[]},
  ContentTranslation:{filter:async()=>[]}
 };
 return {event,entities,client:{asServiceRole:{entities}}};
}
function hebrewTextNodes(html){
 return [...html.matchAll(/>([^<>]*[\u0590-\u05FF][^<>]*)</g)]
  .map(a=>a[1].trim()).filter(Boolean).filter(x=>!x.startsWith('<!--'));
}
test('fixed labels in regular English quote contain no untranslated Hebrew',async()=>{
 const {client}=fixture();
 const quote=await generateQuoteHtml('event1',client,{
  language:'en',includeIntro:false,includePaymentTerms:false,
  includeSchedule:true
 });
 const leaked=hebrewTextNodes(quote.html);
 assert.deepEqual(leaked,[],JSON.stringify(leaked,null,2));
});
test('fixed labels in modular English quote contain no untranslated Hebrew',async()=>{
 const {client}=fixture();
 const quote=await composeModularQuoteHtml({content:{
  document_language:'en',event_type:'Bar Mitzvah',guest_count:85,
  services_title:'Packages & Services',
  show_payment_terms:false,show_agreement:false,
  items:[{id:'i1',name:'Four-Piece Band',description:'Live Music',
   kind:'service',quantity:2,price:6500,show_price:true,
   visible:true,includes_vat:false,show_quantity:true}]
 }},client);
 const leaked=hebrewTextNodes(quote.html);
 assert.deepEqual(leaked,[],JSON.stringify(leaked,null,2));
});
test('fixed labels in manual English quote contain no untranslated Hebrew',async()=>{
 const {client}=fixture();
 const quote=await composeManualQuoteHtml({
  title:'Manual Quote',document_language:'en',
  linked_event_id:'event1',blocks:JSON.stringify([
   {type:'event_details',options:{showParents:false}},
   {type:'services',options:{}},
   {type:'financial_summary',options:{}},
   {type:'schedule',options:{}}
  ])
 },client);
 const leaked=hebrewTextNodes(quote.html);
 assert.deepEqual(leaked,[],JSON.stringify(leaked,null,2));
});
