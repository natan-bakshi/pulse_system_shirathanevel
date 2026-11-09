import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';
import {
 allowedSupplierEventView,readSupplierEventView
} from '../base44/shared/supplierEventAccess.ts';
const MINE='supplier-mine',OTHER='supplier-other',EVENT='event-public';
const user={role:'user',user_type:'supplier',email:'mine@example.org'};
const me={id:MINE,contact_emails:['mine@example.org']};
const event={
 id:EVENT,event_name:'Bar Mitzvah',family_name:'Cohen',child_name:'David',
 event_date:'2026-11-30',event_time:'10:00',location:'Western Wall',
 city:'Jerusalem',
 parents:[
  {id:'private-contact-id',name:'Mother',phone:'050-123-4567',
   email:'private-parent-email@example.com',custom_fields:{secret:'PRIVATE_PARENT_PROFILE'}},
  {name:'Father',phone:'+1 202 555 0135'},
  {name:'Missing number',phone:'javascript:alert(1)'}
 ],
 schedule:[{time:'09:30',activity:'Gathering',notes:'North entrance',
  financial_note:'PRIVATE_FINANCE'},
  {time:'10:00',activity:'Opening',notes:''}],
 billing_customer_id:'PRIVATE_BILLING_ID',
 total_price:225000,quote_history:[{file_uri:'PRIVATE_QUOTE_LINK'}],
 organizer_contacts:JSON.stringify([{name:'PRIVATE_ORGANIZER',phone:'0529999999'}]),
 notes:'PRIVATE_EVENT_ADMIN_NOTES',
 custom_organizer_fields:{secret:'PRIVATE_ORGANIZER_FIELDS'}
};
const own={
 id:'service-mine',event_id:EVENT,service_id:'catalog-mine',is_external:false,
 service_name:'Photography',service_description:
  '<p>Arrival <strong>early</strong> &amp; coordinate.</p><p>Second line<br>Another line</p><script>alert("PRIVATE_SCRIPT")</script>',
 supplier_ids:JSON.stringify([MINE,OTHER]),
 supplier_statuses:JSON.stringify({[MINE]:'pending',[OTHER]:'confirmed'}),
 supplier_arrival_time:'08:45',standing_time:'09:00',
 pickup_point:JSON.stringify([
  {pickupPoints:[{time:'08:45',location:'Mamilla rooftop'},
   {time:'09:15',location:'Western Wall'}]},
  {pickupPoints:[{time:'09:30',location:'City gate'}]}
 ]),
 supplier_notes:JSON.stringify({[MINE]:'Bring two lenses',
  [OTHER]:'PRIVATE_OTHER_SUPPLIER_NOTE'}),
 admin_notes:'PRIVATE_ADMIN_SERVICE',
 custom_price:5000,total_price:10000
};
const foreign={...own,id:'service-foreign',
 service_name:'PRIVATE_OTHER_SERVICE',
 service_description:'PRIVATE_OTHER_SERVICE_DESCRIPTION',
 supplier_ids:JSON.stringify([OTHER]),
 supplier_statuses:JSON.stringify({[OTHER]:'confirmed'})};
test('supplier event card includes complete authorized operational data but never administrative/foreign data',()=>{
 const data=allowedSupplierEventView(event,[own,foreign],MINE);
 assert.equal(data.eventName,'Bar Mitzvah');
 assert.equal(data.familyName,'Cohen');
 assert.equal(data.childName,'David');
 assert.equal(data.location,'Western Wall');
 assert.deepEqual(data.schedule,[{time:'09:30',activity:'Gathering',notes:'North entrance'},
  {time:'10:00',activity:'Opening',notes:''}]);
 assert.deepEqual(data.parents,[
  {name:'Mother',phone:'050-123-4567',dialNumber:'+972501234567',whatsappNumber:'972501234567'},
  {name:'Father',phone:'+1 202 555 0135',dialNumber:'+12025550135',whatsappNumber:'12025550135'},
  {name:'Missing number',phone:'javascript:alert(1)',dialNumber:'',whatsappNumber:''}
 ]);
 assert.equal(data.services.length,1);
 const s=data.services[0];
 assert.equal(s.serviceName,'Photography');
 assert.equal(s.arrivalTime,'08:45');
 assert.equal(s.standingTime,'09:00');
 assert.equal(s.meetingLocation,'Mamilla rooftop');
 assert.deepEqual(s.pickupPoints,[{time:'08:45',location:'Mamilla rooftop',unit:1},
  {time:'09:15',location:'Western Wall',unit:1},
  {time:'09:30',location:'City gate',unit:2}]);
 assert.equal(s.status,'pending');
 assert.equal(s.supplierNote,'Bring two lenses');
 assert.match(s.serviceDescription,/Arrival early & coordinate/);
 assert.match(s.serviceDescription,/Second line\nAnother line/);
 assert.doesNotMatch(s.serviceDescription,/<[^>]*>|PRIVATE_SCRIPT/);
 for(const excluded of ['PRIVATE_OTHER_SERVICE','PRIVATE_OTHER_SUPPLIER_NOTE',
  'PRIVATE_PARENT_PROFILE','private-parent-email','PRIVATE_FINANCE',
  'PRIVATE_ADMIN_SERVICE','PRIVATE_EVENT_ADMIN_NOTES','PRIVATE_QUOTE_LINK',
  'PRIVATE_ORGANIZER','PRIVATE_BILLING_ID','custom_price','total_price',
  'supplier_ids','supplier_statuses','quote_history','financial_note','admin_notes']){
  assert.ok(!JSON.stringify(data).includes(excluded),'unexpected disclosure '+excluded);
 }
});
test('a provider returning a service from another event cannot grant or expand event access',()=>{
 const foreignSameSupplier={...own,id:'foreign-same-supplier',event_id:'another-event',
  service_name:'PRIVATE_FOREIGN_EVENT_SERVICE'};
 assert.throws(()=>allowedSupplierEventView(event,[foreignSameSupplier],MINE),/Not found/);
 const safe=allowedSupplierEventView(event,[own,foreignSameSupplier],MINE);
 assert.equal(safe.services.length,1);
 assert.ok(!JSON.stringify(safe).includes('PRIVATE_FOREIGN_EVENT_SERVICE'));
});
test('legacy parent/schedule JSON and legacy plain meeting place work with only allowed subfields',()=>{
 const e={...event,parents:JSON.stringify(event.parents),schedule:JSON.stringify(event.schedule)};
 const s={...own,pickup_point:'Entrance B',standing_time:'09:05',
  service_description:'<div><strong>Work</strong> safely</div>',supplier_notes:'{}'};
 const out=allowedSupplierEventView(e,[s],MINE);
 assert.equal(out.parents.length,3);
 assert.equal(out.schedule.length,2);
 assert.deepEqual(out.services[0].pickupPoints,[{location:'Entrance B',time:'09:05',unit:1}]);
 assert.equal(out.services[0].meetingLocation,'Entrance B');
 assert.equal(out.services[0].serviceDescription,'Work safely');
 assert.equal(out.services[0].supplierNote,'');
});
test('only authenticated assigned supplier can load event, before Event.get or catalog lookup',async()=>{
 const trace={events:0,catalogs:0,readAssignment:0};
 const db={
  Supplier:{list:async()=>[me,{id:OTHER,contact_emails:['other@example.org']}]},
  EventService:{filter:async q=>{trace.readAssignment++;assert.equal(q.event_id,EVENT);return [foreign,own]}},
  Event:{get:async()=>{trace.events++;return event}},
  Service:{get:async id=>{trace.catalogs++;assert.equal(id,'catalog-mine');
   return {id,service_description:'Catalog description',privatePrice:999}}}
 };
 const client={asServiceRole:{entities:db}};
 const actual=await readSupplierEventView(client,user,EVENT);
 assert.equal(actual.services.length,1);
 assert.equal(trace.events,1);
 assert.equal(trace.catalogs,0,'assigned service already has its own description');
 const outsider={...user,email:'stranger@example.org'};
 await assert.rejects(readSupplierEventView(client,outsider,EVENT),/Not found/);
 assert.equal(trace.events,1);
 const removed={...own,supplier_ids:JSON.stringify([OTHER])};
 db.EventService.filter=async()=>[foreign,removed];
 await assert.rejects(readSupplierEventView(client,user,EVENT),/Not found/);
 assert.equal(trace.events,1,'unassigned account cannot read event details');
 const declined={...own,supplier_statuses:JSON.stringify({[MINE]:'rejected'})};
 db.EventService.filter=async()=>[declined];
 await assert.rejects(readSupplierEventView(client,user,EVENT),/Not found/);
 assert.equal(trace.events,1);
});
test('optional catalog description fallback queries only the current assigned service',async()=>{
 const row={...own,service_description:'',service_name:''};
 const catalogIds=[];
 const client={asServiceRole:{entities:{
  Supplier:{list:async()=>[me]},
  EventService:{filter:async()=>[foreign,row]},
  Event:{get:async()=>event},
  Service:{get:async id=>{
   catalogIds.push(id);
   return {id,service_name:'Photographer',service_description:'Take pictures',
    price:100000};
  }}
 }}};
 const got=await readSupplierEventView(client,user,EVENT);
 assert.deepEqual(catalogIds,['catalog-mine']);
 assert.equal(got.services[0].serviceName,'Photographer');
 assert.equal(got.services[0].serviceDescription,'Take pictures');
 assert.ok(!JSON.stringify(got).includes('100000'));
});
test('unauthenticated supplier event endpoint returns 401 with no data reads or leaked contacts',async()=>{
 const src=fs.readFileSync('base44/functions/supplierEventView/entry.ts','utf8');
 let handler,read=0;
 const js=esbuild.transformSync(src,{loader:'ts',format:'cjs',target:'es2022'}).code;
 vm.runInNewContext(js,{
  exports:{},module:{exports:{}},Response,console,
  Deno:{serve:f=>handler=f},
  require:name=>{
   if(name.includes('@base44/sdk'))return {createClientFromRequest:()=>({
    auth:{me:async()=>{throw Error('not logged in')}}
   })};
   if(name.includes('supplierEventAccess'))return {readSupplierEventView:()=>{read++;}};
   throw Error('Unknown import');
  }
 });
 const response=await handler({method:'POST',json:async()=>({eventId:EVENT})});
 assert.equal(response.status,401);
 assert.equal(read,0);
 assert.deepEqual(await response.json(),{error:'Unauthorized'});
});
test('supplier event client renders safe call and WhatsApp links and full details without raw entity reads',()=>{
 const source=fs.readFileSync('src/pages/SupplierEventView.jsx','utf8');
 assert.match(source,/base44\.functions\.invoke\('supplierEventView'/);
 assert.match(source,/e\.schedule\.map/);
 assert.match(source,/e\.parents\.map/);
 assert.match(source,/s\.serviceDescription/);
 assert.match(source,/s\.arrivalTime/);
 assert.match(source,/s\.status/);
 assert.match(source,/s\.meetingLocation/);
 assert.match(source,/href=\{'tel:'\+parent\.dialNumber\}/);
 assert.match(source,/href=\{'https:\/\/wa\.me\/'\+parent\.whatsappNumber\}/);
 assert.doesNotMatch(source,/dangerouslySetInnerHTML|\.entities\.(?:Event|EventService|Supplier)\./);
});
