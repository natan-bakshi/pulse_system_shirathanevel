import test from 'node:test';
import assert from 'node:assert/strict';
import {SUPPLIER_PORTAL_URL,withSupplierPortalLink}
 from '../base44/shared/supplierPortalLink.ts';
import {
 previewGreenSupplierNavigation,verifiedSupplierNavigationTransport,
 isSupplierNavigationSource
} from '../base44/shared/greenSupplierNavigation.ts';
import {sendWhatsAppTransport}
 from '../base44/shared/whatsappSend.ts';

const ORIGINAL='תזכורת לספק\nמשפחה: כהן\nתאריך: 15.11.2026\n'
 +'מיקום: הכותל המערבי\nשיבוץ: נגן קלרינט\n'
 +'שעת הגעה: 08:30';
const job=()=>({
 id:'outbox-reminder123',source_type:'event_reminder',
 source_id:'event-abc123',supplier_id:'supplier-abc123',
 message_type:'text',requested_provider:'green',status:'queued',
 chat_id:'972521234567@c.us',
 message_text:withSupplierPortalLink(ORIGINAL,'supplier-abc123')
});
const control=()=>({
 enabled:true,paused:false,interactive_outbound_live_enabled:true,
 interactive_assignment_production_enabled:true
});
const config=()=>({
 enabled:true,legacyProductionApproved:true,accountCapabilityVerified:true,
 capability:'mixed_url',officeNumber:'972541234567',
 officeLabel:'פנייה למשרד',supplierPortalLabel:'כניסה למערכת'
});
const preview=(patch={},cfg=config(),ctl=control(),provider='green')=>
 previewGreenSupplierNavigation({job:{...job(),...patch},config:cfg,
  control:ctl,provider});
test('every supported real supplier notice has TWO native URL buttons without extra queue/database operations',()=>{
 for(const type of [
  'event_reminder','supplier_pending_reminder',
  'scheduled_template','manual_trigger'
 ]){
  assert.equal(isSupplierNavigationSource(type),true);
  const rendered=preview({source_type:type});
  assert.equal(rendered.method,'sendInteractiveButtons');
  assert.equal(rendered.kind,'interactive_navigation');
  assert.deepEqual(rendered.body.buttons.map(x=>x.type),['url','url']);
  assert.equal(rendered.body.buttons[0].buttonText,'כניסה למערכת');
  assert.equal(rendered.body.buttons[0].url,SUPPLIER_PORTAL_URL);
  assert.equal(rendered.body.buttons[1].buttonText,'פנייה למשרד');
  assert.equal(rendered.body.chatId,job().chat_id);
  assert.equal(rendered.body.body,ORIGINAL,
   'only remove canonical URL trailer already duplicated by native portal button');
  assert.equal(rendered.providerRequestsMade,0);
  const office=new URL(rendered.body.buttons[1].url);
  assert.equal(office.host,'wa.me');
  assert.equal(office.pathname,'/972541234567');
  const draft=office.searchParams.get('text');
  assert.match(draft,/אסמכתא: outbox-reminder123/);
  assert.match(draft,/תאריך: 15\.11\.2026/);
  assert.match(draft,/מיקום: הכותל המערבי/);
  assert.match(draft,/שיבוץ: נגן קלרינט/);
  assert.match(draft,/הודעה שקיבלתי/);
  assert.ok(verifiedSupplierNavigationTransport({...job(),source_type:type,status:'sending'},
    'green',rendered));
 }
});
test('changing office number later affects FUTURE messages with no short-link service, not links already sent',()=>{
 const first=preview();
 const next=preview({}, {...config(),officeNumber:'972523456789'});
 assert.ok(first.body.buttons[1].url.startsWith('https://wa.me/972541234567?text='));
 assert.ok(next.body.buttons[1].url.startsWith('https://wa.me/972523456789?text='));
 assert.notEqual(first.body.buttons[1].url,next.body.buttons[1].url);
});
test('document, groups, Wasender, non-supplier/admin messages and off-switch remain exactly legacy',()=>{
 const others=[
  {source_type:'client_payment_reminder'},
  {source_type:'notification'}, // generic multi-audience source has no recipient proof
  {source_type:'admin_missing_assignment'},
  {source_type:'assignment_button_feedback'},
  {source_type:'assignment_new'},
  {message_type:'document'},
  {supplier_id:''},
  {chat_id:'120363412345678909@g.us'},
  {requested_provider:'wasender'},
  {sender_account_id:'9903183013'},
  {interactive_button_bindings_json:'forged'},
  {assignment_revision:'r12345'}
 ];
 for(const item of others)assert.equal(preview(item),null,JSON.stringify(item));
 for(const p of [
  {interactive_assignment_production_enabled:false},
  {interactive_outbound_live_enabled:false},
  {enabled:false},{paused:true}
 ])assert.equal(preview({},config(),{...control(),...p}),null);
 assert.equal(preview({},config(),control(),'wasender'),null);
 assert.equal(preview({}, {...config(),legacyProductionApproved:false}),null);
 assert.equal(preview({}, {...config(),accountCapabilityVerified:false}),null);
 assert.equal(preview({}, {...config(),officeNumber:'05012?url=evil'}),null);
});
test('independent final transport fence prevents tampered recipients, foreign link destinations, forged drafts',()=>{
 const original=preview();
 const sending={...job(),status:'sending'};
 assert.equal(verifiedSupplierNavigationTransport(sending,'green',original),true);
 for(const change of [
  p=>{p.body.chatId='972509999999@c.us';},
  p=>{p.body.buttons[0].url='https://evil.example/';},
  p=>{p.body.buttons[1].url='https://other.example/?text=hello';},
  p=>{p.body.buttons[1].url='https://wa.me/972541234567?text=not-our-reference';},
  p=>{p.body.buttons[1].url+='&redirect=https://attacker.example';},
  p=>{p.body.buttons[0].type='reply';},
  p=>{p.body.buttons[1].buttonId='assignment_reject';},
  p=>{p.body.body='different text';},
  p=>{p.body.buttons.push(p.body.buttons[1]);}
 ]){
  const p=structuredClone(original);change(p);
  assert.equal(verifiedSupplierNavigationTransport(sending,'green',p),false);
 }
 assert.equal(verifiedSupplierNavigationTransport({...sending,source_type:'invoice'},
  'green',original),false);
 assert.equal(verifiedSupplierNavigationTransport(sending,'wasender',original),false);
});
async function withGreenTransportMock(fn){
 const oldDeno=globalThis.Deno,oldFetch=globalThis.fetch;
 globalThis.Deno={env:{get:name=>name==='GREEN_API_INSTANCE_ID'?'9903183013':
  name==='GREEN_API_TOKEN'?'offline-green-token':''}};
 try{return await fn({setFetch:callback=>{globalThis.fetch=callback;}});}
 finally{
  if(oldDeno===undefined)delete globalThis.Deno;else globalThis.Deno=oldDeno;
  globalThis.fetch=oldFetch;
 }
}
test('existing transport accepts URL-only buttons in ONE provider request, no Base44 backend integrations',async()=>{
 await withGreenTransportMock(async({setFetch})=>{
  const calls=[];
  setFetch(async(url,options)=>{
   calls.push({url:String(url),payload:JSON.parse(options.body)});
   return new Response(JSON.stringify({idMessage:'3EB0REMINDER123456789'}),
    {status:200,headers:{'Content-Type':'application/json'}});
  });
  const original={...job(),status:'sending'};
  const result=await sendWhatsAppTransport(original,'green',null,preview());
  assert.equal(result.messageId,'3EB0REMINDER123456789');
  assert.equal(calls.length,1,'one Green call replaces the existing text call');
  assert.match(calls[0].url,/sendInteractiveButtons/);
  assert.equal(calls[0].payload.buttons.length,2);
 });
});
test('definite 403 on optional Green URL buttons safely falls back to original text, UNKNOWN never sends twice',async()=>{
 await withGreenTransportMock(async({setFetch})=>{
  const calls=[];
  setFetch(async(url,options)=>{
   calls.push({url:String(url),payload:JSON.parse(options.body)});
   return new Response(JSON.stringify(calls.length===1?
    {error:'unsupported beta buttons'}:{idMessage:'3EB0PLAINREMINDER123'}),{
    status:calls.length===1?403:200,headers:{'Content-Type':'application/json'}
   });
  });
  const result=await sendWhatsAppTransport({...job(),status:'sending'},
   'green',null,preview());
  assert.equal(result.messageId,'3EB0PLAINREMINDER123');
  assert.equal(calls.length,2);
  assert.match(calls[0].url,/sendInteractiveButtons/);
  assert.match(calls[1].url,/sendMessage/);
  assert.equal(calls[1].payload.message,job().message_text,
   'preserve original information when beta URL buttons are definitively unavailable');
 });
 await withGreenTransportMock(async({setFetch})=>{
  let count=0;
  setFetch(async()=>{count++;return new Response(JSON.stringify({
   error:'Provider temporary failure'}),{status:500});});
  await assert.rejects(sendWhatsAppTransport({...job(),status:'sending'},
   'green',null,preview()),error=>error.deliveryUncertain===true);
  assert.equal(count,1,'never replay after an uncertain Green provider outcome');
 });
});
