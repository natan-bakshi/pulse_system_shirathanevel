import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {withSupplierPortalLink,SUPPLIER_PORTAL_URL}
 from '../base44/shared/supplierPortalLink.ts';
import {sendWhatsAppTransport} from '../base44/shared/whatsappSend.ts';
import {
 defaultSupplierNavigationGreenPolicy,normalizeSupplierNavigationGreenPolicy,
 parseSupplierNavigationGreenPolicy,supplierNavigationButtonsForSource,
 saveSupplierNavigationGreenPolicy,SUPPLIER_NAVIGATION_FIELD,
 GREEN_SUPPLIER_NAVIGATION_SOURCES
} from '../base44/shared/greenSupplierNavigationPolicy.ts';
import * as greenNavigation from '../base44/shared/greenSupplierNavigation.ts';
const previewGreenSupplierNavigation=greenNavigation.previewGreenSupplierNavigation;
const transportFence=greenNavigation[Object.keys(greenNavigation).find(k=>
 k.endsWith('SupplierNavigationTransport'))];

const msg='אירוע: משפחת כהן\nתאריך: 01.11.2026\nשירות: מתופף';
const job=(patch={})=>({
 id:'outbox-12345',source_type:'event_reminder',supplier_id:'supplier-12345',
 requested_provider:'green',chat_id:'972501234567@c.us',
 status:'queued',message_type:'text',
 message_text:withSupplierPortalLink(msg,'supplier-12345'),...patch
});
const control=(patch={})=>({
 control_key:'global',enabled:true,paused:false,
 interactive_outbound_live_enabled:true,
 interactive_assignment_production_enabled:true,...patch
});
const config={enabled:true,legacyProductionApproved:true,accountCapabilityVerified:true,
 capability:'mixed_url',officeNumber:'972541234567',
 officeLabel:'פנייה למשרד',supplierPortalLabel:'כניסה למערכת'};
const preview=(ctl=control(),jb=job())=>previewGreenSupplierNavigation({
 job:jb,control:ctl,provider:'green',config
});
const clone=value=>JSON.parse(JSON.stringify(value));

test('new notification policy defaults match ALL previously working URL button layouts exactly',()=>{
 const policy=defaultSupplierNavigationGreenPolicy();
 assert.deepEqual(Object.keys(policy.sources),[...GREEN_SUPPLIER_NAVIGATION_SOURCES]);
 for(const source of GREEN_SUPPLIER_NAVIGATION_SOURCES){
  const selected=supplierNavigationButtonsForSource(control(),source);
  assert.equal(selected.portal,true);
  assert.equal(selected.office,true);
  assert.equal(selected.portalLabel,'');
  const v=preview(control(),job({source_type:source}));
  assert.deepEqual(v.body.buttons.map(b=>b.buttonId),
   ['open_supplier_portal','contact_office']);
  assert.equal(v.body.body,msg);
  assert.equal(v.body.buttons[0].url,SUPPLIER_PORTAL_URL);
  assert.equal(transportFence({...job({source_type:source}),
   status:'sending'},'green',v),true);
 }
 assert.equal(parseSupplierNavigationGreenPolicy(control()).configured,false);
});

test('owner can choose portal-only, office-only, both or no buttons separately, with no additional WhatsApp send',()=>{
 const p=defaultSupplierNavigationGreenPolicy();
 p.sources.event_reminder={portal:true,office:false,portalLabel:'פתח יומן',officeLabel:''};
 p.sources.supplier_pending_reminder={portal:true,office:true,portalLabel:'',officeLabel:''};
 p.sources.scheduled_template={portal:false,office:false,portalLabel:'',officeLabel:''};
 p.sources.manual_trigger={portal:false,office:true,portalLabel:'',officeLabel:'למשרד'};
 const ctl=control({[SUPPLIER_NAVIGATION_FIELD]:JSON.stringify(p)});
 const portal=preview(ctl,job({source_type:'event_reminder'}));
 assert.equal(portal.body.buttons.length,1);
 assert.equal(portal.body.buttons[0].buttonText,'פתח יומן');
 assert.equal(portal.body.body,msg,'portal button replaces the original identical portal trailer');
 assert.equal(transportFence({...job(),status:'sending'},'green',portal),true);
 const none=preview(ctl,job({source_type:'scheduled_template'}));
 assert.equal(none,null,'disabled notice buttons fall back to the original plain send');
 const officeJob=job({source_type:'manual_trigger'});
 const office=preview(ctl,officeJob);
 assert.deepEqual(office.body.buttons.map(b=>b.buttonId),['contact_office']);
 assert.equal(office.body.buttons[0].buttonText,'למשרד');
 assert.equal(office.body.body,officeJob.message_text,
  'if no native portal button, preserve its existing plain-text link');
 assert.equal(transportFence({...officeJob,status:'sending'},
  'green',office),true);
 const link=new URL(office.body.buttons[0].url);
 assert.equal(link.host,'wa.me');
 assert.match(link.searchParams.get('text'),/אסמכתא: outbox-12345/);
});

test('one-button owner layout is still ONE Green API request, no extra provider call',async()=>{
 const settings=defaultSupplierNavigationGreenPolicy();
 settings.sources.event_reminder={portal:true,office:false,portalLabel:'יומן ספק',officeLabel:''};
 const ctl=control({[SUPPLIER_NAVIGATION_FIELD]:JSON.stringify(settings)});
 const original=preview(ctl);
 const priorDeno=globalThis.Deno,priorFetch=globalThis.fetch;
 const calls=[];
 globalThis.Deno={env:{get:key=>key==='GREEN_API_INSTANCE_ID'?'9903183013':
  key==='GREEN_API_TOKEN'?'offline-green-token':''}};
 globalThis.fetch=async(url,params)=>{
  calls.push({url:String(url),body:JSON.parse(params.body)});
  return new Response(JSON.stringify({idMessage:'3EB0ONEURLBUTTON12345'}),{
   status:200,headers:{'Content-Type':'application/json'}
  });
 };
 try{
  const receipt=await sendWhatsAppTransport({...job(),status:'sending'},
   'green',null,original);
  assert.equal(receipt.messageId,'3EB0ONEURLBUTTON12345');
  assert.equal(calls.length,1);
  assert.match(calls[0].url,/sendInteractiveButtons/);
  assert.equal(calls[0].body.buttons.length,1);
  assert.equal(calls[0].body.buttons[0].buttonText,'יומן ספק');
  assert.equal(calls[0].body.body,msg);
 }finally{
  if(priorDeno===undefined)delete globalThis.Deno;else globalThis.Deno=priorDeno;
  globalThis.fetch=priorFetch;
 }
});
test('final transport rejects forged one-button payloads and arbitrary external destinations',()=>{
 const p=defaultSupplierNavigationGreenPolicy();
 p.sources.event_reminder={portal:false,office:true,portalLabel:'',officeLabel:'למשרד'};
 const original=preview(control({[SUPPLIER_NAVIGATION_FIELD]:JSON.stringify(p)}));
 const claimed={...job(),status:'sending'};
 assert.equal(transportFence(claimed,'green',original),true);
 for(const mutate of [
  v=>{v.body.chatId='972509999999@c.us';},
  v=>{v.body.buttons[0].buttonId='assignment_approve';},
  v=>{v.body.buttons[0].type='reply';},
  v=>{v.body.buttons[0].url='https://evil.example';},
  v=>{v.body.buttons[0].url+='&redirect=https://evil.example';},
  v=>{v.body.body=msg;},
  v=>{v.body.buttons.push(v.body.buttons[0]);},
  v=>{v.body.buttons[0].buttonText='\nmalicious';}
 ]){
  const altered=clone(original);mutate(altered);
  assert.equal(transportFence(claimed,'green',altered),false);
 }
});

function fixture(initial=null){
 const row={id:'queue-123',control_key:'global',enabled:true,paused:false,
  [SUPPLIER_NAVIGATION_FIELD]:initial};
 const counters={reads:0,writes:0};
 const db={
  filter:async q=>{counters.reads++;return q.control_key==='global'?[clone(row)]:[];},
  updateMany:async(query,update)=>{
   counters.writes++;
   if(query.id!==row.id||query.control_key!=='global'||
    (query[SUPPLIER_NAVIGATION_FIELD]??null)!==(row[SUPPLIER_NAVIGATION_FIELD]??null))
    return {updated:0};
   Object.assign(row,update.$set);return {updated:1};
  }
 };
 return {row,counters,client:{asServiceRole:{entities:{WhatsAppQueueControl:db}}}};
}
test('owner settings CAS persists only the Green source policy; queue/assignment switches untouched',async()=>{
 const f=fixture();
 const before={...f.row};
 const policy=defaultSupplierNavigationGreenPolicy();
 policy.sources.event_reminder.office=false;
 const saved=await saveSupplierNavigationGreenPolicy(f.client,{
  expectedVersion:1,sources:policy.sources
 });
 assert.equal(saved.setting.version,2);
 assert.equal(saved.setting.sources.event_reminder.office,false);
 assert.equal(f.counters.reads,1);
 assert.equal(f.counters.writes,1);
 assert.deepEqual(Object.keys(f.row).filter(k=>f.row[k]!==before[k]),
  [SUPPLIER_NAVIGATION_FIELD]);
 assert.equal(f.row.enabled,true);
 assert.equal(f.row.paused,false);
 assert.equal((await saveSupplierNavigationGreenPolicy(f.client,{
  expectedVersion:1,sources:policy.sources
 }).catch(e=>e.status)),409,'stale second tab cannot overwrite');
 const newRow=JSON.parse(f.row[SUPPLIER_NAVIGATION_FIELD]);
 assert.equal(newRow.version,2);
});
test('malformed tenant/provider/source/type/text/duplicate-edit settings fail closed without writing',async()=>{
 const valid=defaultSupplierNavigationGreenPolicy();
 const invalid=[
  {...valid,companyId:'other_company'},
  {...valid,provider:'wasender'},
  {...valid,source:'arbitrary'},
  {...valid,sources:{...valid.sources,admin_payment_warning:valid.sources.event_reminder}},
  {...valid,sources:{event_reminder:valid.sources.event_reminder}},
  {...valid,sources:{...valid.sources,event_reminder:{
   ...valid.sources.event_reminder,evil_handler:'delete_all'}}},
  {...valid,sources:{...valid.sources,event_reminder:{
   ...valid.sources.event_reminder,officeLabel:'\nHTTP header'}}},
  {...valid,sources:{...valid.sources,event_reminder:{
   ...valid.sources.event_reminder,portal:'yes'}}},
  {...valid,version:0}
 ];
 for(const bad of invalid){
  assert.throws(()=>normalizeSupplierNavigationGreenPolicy(bad));
 }
 const row=fixture();
 await assert.rejects(saveSupplierNavigationGreenPolicy(row.client,{
  expectedVersion:1,sources:{...valid.sources,
   client_broadcast:valid.sources.event_reminder}
 }),/Invalid supplier WhatsApp navigation/);
 assert.equal(row.counters.writes,0);
 const corrupt=control({[SUPPLIER_NAVIGATION_FIELD]:'{"version":5,"corrupted":true}'});
 assert.equal(parseSupplierNavigationGreenPolicy(corrupt).corrupt,true);
 assert.equal(supplierNavigationButtonsForSource(corrupt,'event_reminder'),null);
 assert.equal(preview(corrupt),null,
  'corrupt source configuration cannot result in an unsafe or unexpected send');
});
test('new owner UI is opt-in and uses existing privileged backend, not a new integration endpoint',()=>{
 const ui=fs.readFileSync('src/components/admin/notifications/WhatsAppSupplierNoticeButtons.jsx','utf8');
 const parent=fs.readFileSync('src/components/admin/NotificationManagementTab.jsx','utf8');
 const handler=fs.readFileSync('base44/functions/WhatsAppQueueAdmin/entry.ts','utf8');
 assert.match(parent,/<WhatsAppSupplierNoticeButtons active=/);
 assert.match(ui,/action:'supplierNavigationGet'/);
 assert.match(ui,/action:'supplierNavigationSave'/);
 assert.match(ui,/useEffect\(\(\)=>\{void load\(\);\},\[\]\)/);
 assert.match(parent,/<TabsContent value="buttons"/);
 assert.doesNotMatch(ui,/setInterval\(|setTimeout\(|fetch\(/);
 assert.match(handler,/action==='supplierNavigationGet'/);
 assert.match(handler,/action==='supplierNavigationSave'/);
 assert.match(handler,/actor\.role!=='admin'/);
 assert.match(handler,/OWNER_EMAIL/);
});
