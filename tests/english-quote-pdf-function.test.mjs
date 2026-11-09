import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

let handler;
let activeClient;
let pdfCalls=0;
globalThis.Deno={
  serve(fn){handler=fn;},
  env:{get:()=> 'fake-not-used'}
};
const sdkStub='export const createClientFromRequest=()=>globalThis.__pdfMockClient;';
const built=await build({
  entryPoints:['base44/functions/generateQuotePdf/entry.ts'],bundle:true,
  platform:'node',format:'esm',write:false,
  plugins:[{name:'runtime',setup(b){
    b.onResolve({filter:/^npm:@base44\/sdk/},()=>({path:'sdk',namespace:'stub'}));
    b.onResolve({filter:/^npm:sanitize-html/},()=>({path:'sanitize',namespace:'stub'}));
    b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:a.path==='sdk'?sdkStub:
      'export default value=>String(value);'}));
  }}]
});
await import('data:text/javascript;base64,'+
  Buffer.from(built.outputFiles[0].text).toString('base64'));

function makeClient({eventOverrides={},templates=[],translations=[]}={}){
 const event={
  id:'ev-pdf',event_name:'Family Celebration',family_name:'Family',
  child_name:'David',event_date:'2027-11-12',event_type:'bar_mitzvah',
  location:'Jerusalem',city:'Jerusalem',status:'quote',
  ...eventOverrides
 };
 const entities={
  Event:{get:async()=>event,update:async()=>{throw Error('Must not write history');}},
  EventService:{filter:async()=>[]},Service:{list:async()=>[]},
  Payment:{filter:async()=>[]},QuoteTemplate:{list:async()=>templates},
  AppSettings:{list:async()=>[{setting_key:'vat_rate',setting_value:'18'}]},
  QuoteOrganizerType:{list:async()=>[]},
  ContentTranslation:{filter:async()=>translations}
 };
 return {auth:{me:async()=>({role:'admin',full_name:'Test Admin'})},
   asServiceRole:{entities}};
}
const request=()=>new Request('https://pulse-system.base44.app/functions/generateQuotePdf',{
 method:'POST',headers:{'Content-Type':'application/json'},
 body:JSON.stringify({eventId:'ev-pdf',language:'en',includeSchedule:false})
});
test('English PDF refuses a personal-name translation gap before API2PDF and history writes',async()=>{
 globalThis.__pdfMockClient=makeClient({eventOverrides:{child_name:'דוד'}});
 const original=globalThis.fetch;pdfCalls=0;globalThis.fetch=async()=>{pdfCalls++;throw Error('Should never call pdf service');};
 try{
  const response=await handler(request());
  const body=await response.json();
  assert.equal(response.status,422);
  assert.ok(body.fields.includes('event.child_name'));
  assert.equal(pdfCalls,0);
 }finally{globalThis.fetch=original;}
});
test('English PDF refuses Hebrew remaining inside approved template before calling API2PDF',async()=>{
 const source='<p>פתיח</p>',value='<p>Welcome פתיח</p>';
 globalThis.__pdfMockClient=makeClient({
  eventOverrides:{concept:'default'},
  templates:[{id:'intro1',template_type:'concept_intro',identifier:'default',content:source}],
  translations:[{id:'ct-intro1',source_entity:'QuoteTemplate',source_id:'intro1',
    locale:'en',status:'approved',fields:{content:{source,value}}}]
 });
 const original=globalThis.fetch;pdfCalls=0;globalThis.fetch=async()=>{pdfCalls++;throw Error('Should never call pdf service');};
 try{
  const response=await handler(request());
  const body=await response.json();
  assert.equal(response.status,422);
  assert.deepEqual(body.fields,['document.visible_text']);
  assert.ok(body.samples.some(s=>s.includes('פתיח')));
  assert.equal(pdfCalls,0);
 }finally{globalThis.fetch=original;}
});