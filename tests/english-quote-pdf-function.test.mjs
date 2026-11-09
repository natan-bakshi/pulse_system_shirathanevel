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
  assert.deepEqual(body.fields,['template.intro1.content']);
  assert.equal(body.samples?.length||0,0,'Blocked at the editable template instead of an orphaned HTML excerpt');
  assert.equal(pdfCalls,0);
 }finally{globalThis.fetch=original;}
});
test('English PDF success passes translated HTML to PDF renderer and stores the resulting file',async()=>{
 const client=makeClient();
 const stored=[];
 const event=await client.asServiceRole.entities.Event.get('ev-pdf');
 client.asServiceRole.entities.Event.update=async (id,data)=>{
  assert.equal(id,'ev-pdf');
  stored.push(data);
  event.quote_history=data.quote_history;
  return event;
 };
 client.asServiceRole.entities.EventService.filter=async()=>[{
  id:'es1',event_id:'ev-pdf',service_id:'service1',
  service_name:'Four-Piece Band',service_description:'Live music for the ceremony',
  custom_price:1800,quantity:1,includes_vat:false,
  show_price_in_quote:true,price_display_mode:'default'
 }];
 client.asServiceRole.entities.Service.list=async()=>[{
  id:'service1',service_name:'Four-Piece Band',
  service_description:'Live music for the ceremony'
 }];
 client.asServiceRole.integrations={Core:{UploadPrivateFile:async({file})=>{
  assert.equal(file.type,'application/pdf');
  assert.ok(file.name.endsWith('.pdf'));
  return {file_uri:'private/test-english-proposal.pdf'};
 }}};
 globalThis.__pdfMockClient=client;
 const original=globalThis.fetch;
 const captured=[];
 globalThis.fetch=async(url,init)=>{
  captured.push({url:String(url),init});
  if(String(url)==='https://v2.api2pdf.com/chrome/html'){
   return Response.json({pdf:'https://files.example.test/english.pdf'});
  }
  if(String(url)==='https://files.example.test/english.pdf'){
   return new Response(new Uint8Array([37,80,68,70,45,49,46,52]),{
    status:200,headers:{'Content-Type':'application/pdf'}
   });
  }
  throw Error('Unexpected network call: '+url);
 };
 try{
  const res=await handler(request());
  const data=await res.json();
  assert.equal(res.status,200,JSON.stringify(data));
  assert.equal(data.file_uri,'private/test-english-proposal.pdf');
  assert.equal(captured.length,2);
  const sent=JSON.parse(captured[0].init.body);
  assert.ok(sent.html.includes('<html lang="en" dir="ltr">'));
  assert.ok(sent.html.includes('Four-Piece Band'));
  assert.ok(sent.html.includes('₪1,800.00'));
  assert.ok(sent.html.includes('₪2,124.00'));
  assert.equal(sent.options.printBackground,true);
  assert.equal(stored.length,1);
  assert.equal(stored[0].quote_history[0].file_uri,'private/test-english-proposal.pdf');
  assert.equal(stored[0].quote_history[0].file_name,data.fileName);
 }finally{globalThis.fetch=original;}
});
