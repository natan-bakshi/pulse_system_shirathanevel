import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
 readSupplierEventView,supplierMatchesUser,supplierIsActivelyAssigned,
 allowedSupplierEventView
} from '../base44/shared/supplierEventAccess.ts';
import {
 buildNotificationSmartLink,notificationRecipientRole
} from '../base44/shared/notificationSmartLinks.ts';
import {customLinkDestination} from '../base44/shared/greenSupplierCustomLinks.ts';
import {notificationLinkPreset} from '../src/lib/notificationLinkPresets.js';
import {buildDeepLink} from '../base44/functions/notificationHelpers/entry.ts';
import {canOpenClientEventCard} from '../base44/shared/clientEventLinkAccess.ts';

const EVENT='event-1234',SUPPLIER='supplier-1234';
const user={id:'user-1234',role:'user',user_type:'supplier',
 email:'supplier@example.org',phone:'0523539980'};
const supplier={id:SUPPLIER,contact_emails:['supplier@example.org'],
 phone:'0523539980'};
const service={id:'eventservice-1234',event_id:EVENT,
 supplier_ids:JSON.stringify([SUPPLIER,'other-supplier']),
 supplier_statuses:JSON.stringify({[SUPPLIER]:'pending',
 'other-supplier':'approved'}),
 service_name:'צילום',supplier_arrival_time:'10:30',
 package_price:9500,admin_notes:'Secret internal note',
 supplier_notes:'Confidential supplier information'};
const event={id:EVENT,event_name:'בר מצווה',family_name:'ישראל',
 event_date:'2026-12-01',event_time:'11:00',location:'ירושלים',
 city:'ירושלים',total_price:90000,all_inclusive_price:100000,
 notes:'Secret event notes',parents:[{name:'Mother',phone:'0501234567'}],
 quote_history:[{file_uri:'secret'}]};
function fixture({
 u=user,s=supplier,services=[service],eventData=event
}={}){
 const calls={supplierList:0,filter:0,eventGet:0};
 const client={asServiceRole:{entities:{
  Supplier:{list:async()=>{calls.supplierList++;return [s]}},
  EventService:{filter:async(query)=>{
   calls.filter++;
   return services.filter(x=>x.event_id===query.event_id);
  }},
  Event:{get:async id=>{calls.eventGet++;return id===EVENT?eventData:null}}
 }}};
 return {client,calls,user:u};
}

test('event link authenticates supplier email + current event assignment before reading Event',async()=>{
 const f=fixture();
 const allowed=await readSupplierEventView(f.client,f.user,EVENT);
 assert.equal(allowed.id,EVENT);
 assert.equal(allowed.eventName,event.event_name);
 assert.equal(allowed.location,event.location);
 assert.deepEqual(allowed.services,[{
  serviceName:'צילום',arrivalTime:'10:30',status:'pending'
 }]);
 for(const secret of ['parents','notes','all_inclusive_price','total_price',
  'supplier_notes','package_price','other-supplier','quote_history'])
  assert.equal(JSON.stringify(allowed).includes(secret),false,secret);
 assert.equal(f.calls.eventGet,1);
});
test('phone spoofing, unrelated event, rejected assignment and external service do not confer access',async()=>{
 const strangers=[
  {...user,email:'stranger@example.org',phone:supplier.phone},
  {...user,email:'',phone:supplier.phone}
 ];
 for(const u of strangers){
  const f=fixture({u});
  await assert.rejects(readSupplierEventView(f.client,f.user,EVENT),/Not found/);
  assert.equal(f.calls.eventGet,0,'no event read before supplier identity is proven');
 }
 const foreign=fixture();
 await assert.rejects(readSupplierEventView(foreign.client,foreign.user,
  'event-other-1234'),/Not found/);
 assert.equal(foreign.calls.eventGet,0);
 for(const variation of [
  {...service,supplier_statuses:JSON.stringify({[SUPPLIER]:'rejected'})},
  {...service,supplier_ids:JSON.stringify(['other-supplier'])},
  {...service,is_external:true},
  {...service,supplier_statuses:'{broken'}
 ]){
  const f=fixture({services:[variation]});
  await assert.rejects(readSupplierEventView(f.client,f.user,EVENT),/Not found/);
  assert.equal(f.calls.eventGet,0);
 }
});
test('untrusted IDs and non-supplier sessions fail before database access',async()=>{
 for(const badId of [
  '../../private','https://evil.example','event?id=1',
  '//evil.example','',null,100
 ]){
  const f=fixture();
  await assert.rejects(readSupplierEventView(f.client,f.user,badId),/Not found/);
  assert.equal(f.calls.supplierList,0);
 }
 for(const u of [
  {...user,user_type:'client'},
  {...user,user_type:'other',role:'user'},
  null
 ]){
  const f=fixture({u});
  await assert.rejects(readSupplierEventView(f.client,f.user,EVENT),/Not found/);
  assert.equal(f.calls.supplierList,0);
 }
});
test('supplier list is checked against auth email, never an editable phone or arbitrary role',()=>{
 assert.equal(supplierMatchesUser(supplier,user),true);
 assert.equal(supplierMatchesUser(supplier,{...user,email:'other@example.org'}),false);
 assert.equal(supplierMatchesUser({...supplier,contact_emails:[]},user),false);
 assert.equal(supplierIsActivelyAssigned(service,SUPPLIER),true);
 assert.equal(supplierIsActivelyAssigned(service,'other-supplier'),true);
 assert.equal(supplierIsActivelyAssigned(service,'not-listed'),false);
 assert.throws(()=>allowedSupplierEventView(event,[],SUPPLIER),/Not found/);
});
test('client event-detail authorization rejects stranger and non-client even when a link ID is known',()=>{
 const original={id:EVENT,created_by:'owner@example.org',contacts_schema_version:2,
  parents:JSON.stringify([{email:'mother@example.org',client_access:true},
   {email:'hidden@example.org',client_access:false}]),
  organizer_contacts:JSON.stringify([{email:'guest@example.org'}])};
 const viewer={role:'user',user_type:'client',email:'mother@example.org'};
 assert.equal(canOpenClientEventCard(viewer,original),true);
 assert.equal(canOpenClientEventCard({...viewer,email:'owner@example.org'},original),true);
 assert.equal(canOpenClientEventCard({...viewer,email:'MOTHER@example.org'},original),true);
 assert.equal(canOpenClientEventCard({...viewer,email:'hidden@example.org'},original),false);
 assert.equal(canOpenClientEventCard({...viewer,email:'guest@example.org'},original),false);
 assert.equal(canOpenClientEventCard({...viewer,email:'stranger@example.org'},original),false);
 assert.equal(canOpenClientEventCard({...viewer,user_type:'supplier'},original),false);
 assert.equal(canOpenClientEventCard({...viewer,email:''},original),false);
 assert.equal(canOpenClientEventCard({role:'admin'},original),true);
 assert.equal(canOpenClientEventCard(viewer,null),false);
});
test('known smart links reach real correct role-specific pages without role escalation',()=>{
 const origin='https://pulse-system.base44.app';
 for(const [role,kind,expected] of [
  ['supplier','event_page','/SupplierEventView?id='+EVENT],
  ['admin','event_page','/EventDetails?id='+EVENT],
  ['client','event_page','/EventDetails?id='+EVENT],
  ['admin','payment_page','/EventDetails?id='+EVENT+'&tab=financial'],
  ['client','payment_page','/EventDetails?id='+EVENT+'&tab=financial'],
  ['supplier','assignment_page','/SupplierDashboard'],
  ['admin','assignment_page','/EventDetails?id='+EVENT+'&tab=services'],
  ['admin','calendar_page','/EventsBoardPage'],
  ['supplier','calendar_page','/SupplierCalendarDashboard'],
  ['client','calendar_page','/ClientDashboard'],
  ['supplier','settings_page','/MyNotificationSettings']
 ])assert.equal(buildNotificationSmartLink(kind,{eventId:EVENT,role}),
  origin+expected,role+': '+kind);
 for(const type of ['payment_page','unknown','delete_payment','supplier_approve'])
  assert.equal(buildNotificationSmartLink(type,{eventId:EVENT,role:'supplier'}),'');
 assert.equal(buildNotificationSmartLink('event_page',{
  eventId:'bad?tab=financial',role:'supplier'}),'');
 assert.equal(buildNotificationSmartLink('event_page',{
  eventId:EVENT,role:null}),'');
 assert.equal(notificationRecipientRole({role:'user',user_type:'supplier'}),'supplier');
 assert.equal(notificationRecipientRole({role:'admin',user_type:'supplier'}),'admin');
 assert.equal(notificationRecipientRole({role:'user',user_type:'unknown'}),null);
});
test('custom Green event link matches secured supplier page and no other event',()=>{
 const button={kind:'event_details',label:'פרטי אירוע',url:''};
 const draft={source_type:'event_reminder',source_id:EVENT};
 assert.equal(customLinkDestination(button,draft),
  'https://pulse-system.base44.app/SupplierEventView?id='+EVENT);
 assert.equal(customLinkDestination(button,{...draft,source_id:'../event-other'}),null);
 assert.equal(customLinkDestination(button,{...draft,source_type:'supplier_pending_reminder'}),null);
});
test('smart presets work for scheduled producers and preserve query parameters and recipient scope',()=>{
 const source={event_id:EVENT};
 const origin='https://pulse-system.base44.app';
 for(const [audience,type,path] of [
  ['supplier','event_page','SupplierEventView?id='+EVENT],
  ['admin','event_page','EventDetails?id='+EVENT],
  ['client','event_page','EventDetails?id='+EVENT],
  ['client','payment_page','EventDetails?tab=financial&id='+EVENT],
  ['admin','assignment_page','EventDetails?tab=services&id='+EVENT],
  ['supplier','assignment_page','SupplierDashboard'],
  ['supplier','calendar_page','SupplierCalendarDashboard'],
  ['admin','calendar_page','EventsBoardPage'],
  ['client','calendar_page','ClientDashboard'],
  ['supplier','settings_page','MyNotificationSettings']
 ]){
  const preset=notificationLinkPreset(type,[audience]);
  assert.ok(preset,audience+' '+type);
  const url=buildDeepLink(preset.deep_link_base,preset.deep_link_params_map,source);
  assert.equal(origin+url,origin+'/'+path);
 }
 for(const args of [
  ['payment_page',['supplier']],
  ['event_page',['supplier','client']],
  ['calendar_page',['admin','client']],
  ['event_page',[]],
  ['unknown',['admin']]
 ])assert.equal(notificationLinkPreset(...args),null);
 const form=fs.readFileSync('src/components/admin/notifications/form/AdvancedLinksTab.jsx','utf8');
 assert.match(form,/notificationLinkPreset/);
 assert.match(form,/deep_link_params_map/);
 assert.match(form,/chooseSmartLink/);
});
test('template UX is part of NotificationTemplateForm and one source-level control remains',()=>{
 const form=fs.readFileSync('src/components/admin/notifications/NotificationTemplateForm.jsx','utf8');
 const inline=fs.readFileSync('src/components/admin/notifications/WhatsAppTemplateButtonsTab.jsx','utf8');
 const manager=fs.readFileSync('src/components/admin/NotificationManagementTab.jsx','utf8');
 assert.match(form,/TabsTrigger value="buttons"/);
 assert.match(form,/<WhatsAppTemplateButtonsTab/);
 assert.match(form,/hasPendingChanges\(\)/);
 assert.match(form,/buttonsRef\.current\.save\(\)/);
 assert.match(inline,/supplierTemplateButtonsGet/);
 assert.match(inline,/supplierTemplateButtonsSave/);
 assert.match(inline,/expectedVersion:stored\.version/);
 assert.match(manager,/onEditButtons=\{template=>handleEdit\(template,'buttons'\)\}/);
 assert.match(manager,/initialTab=\{templateInitialTab\}/);
 assert.doesNotMatch(manager,/<WhatsAppTemplateButtonSettings/);
 assert.equal((manager.match(/<WhatsAppSupplierNoticeButtons\b/g)||[]).length,1);
});
test('supplier and client event-route guards execute before administrative event page mounts',()=>{
 const details=fs.readFileSync('src/pages/EventDetails.jsx','utf8');
 const view=fs.readFileSync('src/pages/SupplierEventView.jsx','utf8');
 const backend=fs.readFileSync('base44/functions/supplierEventView/entry.ts','utf8');
 const clientGate=fs.readFileSync('base44/functions/eventLinkAccess/entry.ts','utf8');
 assert.match(details,/function EventDetailsBody\(\)/);
 assert.match(details,/export default function EventDetails\(\)/);
 assert.match(details,/return <Navigate replace to=\{'\/SupplierEventView/);
 assert.match(details,/base44\.functions\.invoke\('eventLinkAccess'/);
 assert.match(backend,/readSupplierEventView\(client,user,body\.eventId\)/);
 assert.match(clientGate,/canOpenClientEventCard\(user,event\)/);
 assert.match(view,/base44\.functions\.invoke\('supplierEventView'/);
 assert.doesNotMatch(view,/base44\.entities\.Event\.(?:get|list|filter)/);
 assert.doesNotMatch(view,/base44\.entities\.EventService\.(?:get|list|filter)/);
});
test('legacy deep-link helpers correctly append a query parameter after an existing tab',()=>{
 for(const folder of fs.readdirSync('base44/functions',{withFileTypes:true}).filter(x=>x.isDirectory())){
  const name='base44/functions/'+folder.name+'/entry.ts';
  if(!fs.existsSync(name))continue;
  const source=fs.readFileSync(name,'utf8');
  if(!/function buildDeepLink|function buildDL/.test(source))continue;
  assert.doesNotMatch(source,/url \+= \x60\?\$\{paramString\}\x60/,
   'bad query separator: '+name);
 }
 const tabs=fs.readFileSync('src/components/event-details/EventDetailsTabs.jsx','utf8');
 assert.match(tabs,/requested===/);
 assert.match(tabs,/financial/);
 const config=fs.readFileSync('src/pages.config.js','utf8');
 assert.match(config,/"SupplierEventView": SupplierEventView/);
});
