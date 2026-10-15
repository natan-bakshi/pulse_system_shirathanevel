import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
async function load(path, extra='') {
 const result=await build({entryPoints:[path],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'runtime',setup(b){
  b.onResolve({filter:/^npm:@base44\/sdk/},()=>({path:'sdk',namespace:'stub'}));
  b.onResolve({filter:/^npm:sanitize-html/},()=>({path:'sanitize',namespace:'stub'}));
  b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:a.path==='sdk'?'export const createClientFromRequest=()=>globalThis.quoteTestClient;':'export default value=>String(value);'}));
  if(extra)b.onLoad({filter:/generateManualQuotePdf\/entry\.ts$/},async a=>({contents:(await readFile(a.path,'utf8'))+extra,loader:'js'}));
 }}]});
 return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const {generateQuoteHtml}=await load('base44/shared/quoteHtml.ts');
const {renderServicesBlock}=await load('base44/functions/generateManualQuotePdf/entry.ts','\nexport {renderServicesBlock};');
const {composeModularQuoteHtml}=await load('base44/shared/modularQuote.ts');
let viewHandler;
globalThis.Deno={serve:fn=>{viewHandler=fn;},env:{get:()=>''}};
await load('base44/functions/generateQuote/entry.ts');
const settings={quoteBodyFontSize:'15',quoteTitleFontSize:'16'};
function fixture(visible, mode='custom_text') {
 const event={id:'test',event_name:'בדיקת הצעה',family_name:'בדיקה',event_date:'2027-01-15',status:'quote',all_inclusive:false};
 const services=[
  {id:'pkg',service_id:'pkg',is_package_main_item:true,package_name:'חבילה',custom_price:901},
  {id:'child',service_id:'child',parent_package_event_service_id:'pkg',custom_price:113},
  {id:'standalone',service_id:'standalone',custom_price:227},
  {id:'external',service_id:'external',is_external:true,custom_price:331},
  {id:'legacy',service_id:'legacy',package_id:'old',package_name:'חבילה ישנה',package_price:809,custom_price:443}
 ].map((s,index)=>({...s,service_name:s.id,quantity:2,order_index:index,client_notes:`הערה-${s.id}\nשורה שנייה`,price_display_mode:mode,price_display_text:`כיתוב-${s.id}`,show_price_in_quote:visible}));
 const entities=Object.fromEntries(['Event','EventService','Service','Payment','QuoteTemplate','AppSettings','QuoteOrganizerType'].map(name=>[name,{get:async()=>event,list:async()=>[],filter:async()=>name==='EventService'?services:[]} ]));
 return {event,services,client:{auth:{me:async()=>({role:'admin'})},asServiceRole:{entities}}};
}
for(const visible of [true,false]) for(const mode of ['default','direct_payment','estimated_price','custom_text']) {
 test(`regular, PDF and manual: visible=${visible}, mode=${mode}`,async()=>{
  const {event,services,client}=fixture(visible,mode);
  const pdf=await generateQuoteHtml(event.id,client);
  globalThis.quoteTestClient=client;
  const response=await viewHandler(new Request('https://example.test',{method:'POST',body:JSON.stringify({eventId:event.id})}));
  assert.equal(response.status,200);
  const view=(await response.json()).html;
  const manual=renderServicesBlock({options:{}},event,[],services,settings);
  for(const html of [pdf.html,view,manual]) {
   for(const service of services) {
    assert.ok(html.includes(`הערה-${service.id}`),service.id+' notes');
    const label=mode==='custom_text'?`כיתוב-${service.id}`:mode==='direct_payment'?'תשלום ישיר':mode==='estimated_price'?'מחיר מוערך':'';
    if(label)assert.ok(html.includes(label),service.id+' label');
   }
   // Package children never get itemized prices, regardless of the toggle.
   for(const total of ['226.00','886.00'])assert.equal(html.includes('₪'+total),false,total);
   // The toggle only suppresses prices that the original layout allows.
   for(const total of ['454.00','662.00'])assert.equal(html.includes('₪'+total),visible,total);
   assert.equal(html.includes('₪1,802.00'),visible,'new package total');
   assert.ok(html.includes('₪809.00'),'legacy package total is independent of its child toggle');
  }
  // Visibility has no effect on the binding financial total.
  const other=fixture(!visible,mode);
  const otherPdf=await generateQuoteHtml(event.id,other.client);
  const summary = html => html.match(/<table class="summary-table">[\s\S]*?<\/table>/)?.[0];
  assert.ok(summary(pdf.html));
  assert.equal(summary(pdf.html),summary(otherPdf.html));
 });
}
for(const visible of [true,false]) test(`modular parent and child honor visibility ${visible}`,async()=>{
 const {client}=fixture(visible);
 const item=(name,price)=>({name,kind:'service',quantity:1,price,show_price:visible,client_notes:'הערה-'+name,price_display_mode:'custom_text',price_display_text:'כיתוב-'+name});
 const content={show_summary:false,show_descriptions:false,items:[{...item('package',901),kind:'package',children:[item('child',113)]},item('standalone',227)]};
 const {html}=await composeModularQuoteHtml({content},client);
 for(const name of ['package','child','standalone']){assert.ok(html.includes('הערה-'+name));assert.ok(html.includes('כיתוב-'+name));}
 assert.equal(html.includes('₪113.00'),false,'modular child price stays hidden');
 for(const amount of ['901.00','227.00'])assert.equal(html.includes('₪'+amount),visible);
 content.show_prices=false;
 const hidden=await composeModularQuoteHtml({content},client);
 assert.equal(/₪\d/.test(hidden.html),false);
 assert.ok(hidden.html.includes('כיתוב-child'));
});
for(const visible of [true,false]) test(`all-inclusive suppresses included prices: toggle=${visible}`,async()=>{
 const {event,services,client}=fixture(visible);
 event.all_inclusive=true;event.all_inclusive_price=5000;
 const pdf=await generateQuoteHtml(event.id,client);
 globalThis.quoteTestClient=client;
 const response=await viewHandler(new Request('https://example.test',{method:'POST',body:JSON.stringify({eventId:event.id})}));
 assert.equal(response.status,200);
 const view=(await response.json()).html;
 const manual=renderServicesBlock({options:{}},event,[],services,settings);
 for(const html of [pdf.html,view,manual]) {
  for(const total of ['1,802.00','226.00','454.00','886.00','809.00'])assert.equal(html.includes('₪'+total),false,total);
  for(const service of services)assert.ok(html.includes('הערה-'+service.id));
 }
 assert.equal(pdf.html.includes('₪662.00'),visible,'external service keeps its separate original pricing rule');
});
test('manual block price setting cannot be overridden by an enabled item toggle',()=>{
 const {event,services}=fixture(true);
 const html=renderServicesBlock({options:{showPrices:false}},event,[],services,settings);
 assert.equal(/₪[\d,]+\.\d{2}/.test(html),false);
 assert.ok(html.includes('כיתוב-standalone'));assert.ok(html.includes('הערה-child'));
});
test('child toggles do not suppress their package total',async()=>{
 const {event,services,client}=fixture(true);
 for(const s of services)if(s.parent_package_event_service_id||s.package_id)s.show_price_in_quote=false;
 const pdf=await generateQuoteHtml(event.id,client);
 const manual=renderServicesBlock({options:{}},event,[],services,settings);
 for(const html of [pdf.html,manual]){assert.ok(html.includes('₪1,802.00'));assert.ok(html.includes('₪809.00'));assert.equal(html.includes('₪226.00'),false);assert.equal(html.includes('₪886.00'),false);}
});
test('layout prohibition takes precedence over either toggle',async()=>{
 const {quotePriceVisible,quoteServicePriceHtml}=await load('base44/shared/quoteServicePresentation.ts');
 for(const visible of [undefined,true,false]){
  const service={show_price_in_quote:visible,show_price:visible};
  assert.equal(quotePriceVisible(service,false),false);
  assert.equal(quoteServicePriceHtml(service,98765,'15',false).includes('₪'),false);
  assert.equal(quotePriceVisible(service,true),visible!==false);
 }
});
test('annotations escape HTML and preserve line breaks',async()=>{
 const {quoteServicePriceHtml,quoteServiceNotesHtml}=await load('base44/shared/quoteServicePresentation.ts');
 const s={show_price_in_quote:false,price_display_mode:'custom_text',price_display_text:'<b>label</b>\nline',client_notes:'<script>note</script>\nnext'};
 const html=quoteServicePriceHtml(s,999)+quoteServiceNotesHtml(s);
 assert.ok(html.includes('&lt;b&gt;label&lt;/b&gt;\nline'));assert.ok(html.includes('white-space:pre-wrap'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('999'));
});