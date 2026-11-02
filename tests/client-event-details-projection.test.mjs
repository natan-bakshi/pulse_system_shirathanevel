import test from 'node:test';
import assert from 'node:assert/strict';
import {
 readClientEventDetailsFeed,clientEventCardProject
} from '../base44/shared/clientEventDetailsFeed.ts';
import {canMountPulsePage} from '../src/lib/routeRoleAccess.js';

const OWN='own-event-123',OTHER='other-event-456';
const user={id:'user-123',role:'user',user_type:'client',
 email:'CLIENT@example.org',phone:'0523539980'};
const own={id:OWN,created_by:'client@example.org',event_name:'My event',
 family_name:'Family',event_date:'2026-12-01',event_time:'13:30',
 location:'Jerusalem',status:'confirmed',primary_currency:'ILS',
 all_inclusive:true,all_inclusive_price:12500,
 parents:[{id:'contact-1',name:'Parent',email:'client@example.org',
  phone:'0501234567',client_access:true}],
 contacts_schema_version:2,
 schedule:[{time:'13:30',activity:'Ceremony',notes:'bring siddur'}],
 notes:'Client event notes',discount_amount:150,
 custom_organizer_fields:{message:'Client text'},
 billing_customer_id:'NEVER EMIT CARD ID',
 closing_agreement_id:'PRIVATE AGREEMENT',quote_history:[{file_uri:'secret'}],
 supplier_event_change_context:{secret:'PRIVATE WORKFLOW'},
 payment_token:'DO NOT EMIT'};
const foreign={...own,id:OTHER,created_by:'stranger@example.org',
 parents:[],event_name:'FOREIGN FAMILY'};
const one={id:'service-1',event_id:OWN,service_id:'catalog-1',
 service_name:'Musicians',custom_price:8000,quantity:1,includes_vat:true,
 notes:'ADMIN SERVICE NOTES',supplier_ids:'["unrelated-supplier"]',
 supplier_statuses:'{}',supplier_notes:'SECRET SUPPLIER NOTES',
 admin_notes:'SECRET INTERNAL',supplier_calendar_ids:{foo:'bar'},
 assignment_notification_intents:'PRIVATE INTENTS',
 service_description:'Musical procession',client_notes:'Meet at noon'};
const catalog={id:'catalog-1',service_name:'Musicians',category:'music',
 service_description:'Global catalog description',base_price:30000,
 supplier_names:['another supplier']};
const fixture=({actor=user,event=own,services=[one],cap=150}={})=>{
 const calls={event:0,services:[],catalog:[]};
 const db={
  Event:{get:async(id)=>{calls.event++;return id===event?.id?event:null;}},
  EventService:{filter:async(q,sort,count,offset,fields)=>{
   calls.services.push(q);
   assert.ok(fields.includes('service_name'));
   assert.ok(!fields.includes('supplier_ids'));
   assert.ok(!fields.includes('admin_notes'));
   return services.filter(s=>s.event_id===q.event_id)
    .slice(offset,offset+Math.min(count,cap));
  }},
  Service:{get:async(id)=>{calls.catalog.push(id);return id===catalog.id?catalog:null;}}
 };
 return {client:{asServiceRole:{entities:db}},actor,calls};
};
test('client event card retains own event/service/financial/schedule information, never backend-only fields',async()=>{
 const f=fixture();
 const result=await readClientEventDetailsFeed(f.client,f.actor,OWN);
 assert.equal(result.event.id,OWN);
 assert.equal(result.event.all_inclusive_price,12500);
 assert.equal(result.event.notes,'Client event notes');
 assert.deepEqual(result.event.schedule,[{
  time:'13:30',activity:'Ceremony',notes:'bring siddur'
 }]);
 assert.equal(result.event.parents.length,1);
 assert.equal(result.services[0].client_notes,'Meet at noon');
 assert.equal(result.services[0].custom_price,8000);
 assert.equal(result.catalog[0].category,'music');
 assert.deepEqual(f.calls.services,[{event_id:OWN},{event_id:OWN}]);
 assert.deepEqual(f.calls.catalog,['catalog-1']);
 for(const forbidden of [
  'NEVER EMIT CARD ID','PRIVATE AGREEMENT','PRIVATE WORKFLOW','DO NOT EMIT',
  'ADMIN SERVICE NOTES','unrelated-supplier','SECRET SUPPLIER NOTES',
  'SECRET INTERNAL','PRIVATE INTENTS','supplier_statuses','supplier_ids'
 ])assert.ok(!JSON.stringify(result).includes(forbidden),forbidden);
});
test('foreign event, revoked contact and spoofed phone cannot read services/catalog',async()=>{
 for(const actor of [
  {...user,email:'stranger@example.org',phone:user.phone},
  {...user,email:'',phone:user.phone},
  {...user,user_type:'supplier'},
  {...user,role:'admin'},
  null
 ]){
  const f=fixture({actor});
  await assert.rejects(readClientEventDetailsFeed(f.client,actor,OWN));
  assert.equal(f.calls.services.length,0);
  assert.equal(f.calls.catalog.length,0);
 }
 const outsider=fixture({event:foreign});
 await assert.rejects(readClientEventDetailsFeed(outsider.client,user,OTHER),
  e=>e.status===404);
 assert.deepEqual(outsider.calls.services,[]);
 const revoked=fixture({event:{...own,created_by:'stranger@example.org',
  parents:[{email:'client@example.org',client_access:false}]}});
 await assert.rejects(readClientEventDetailsFeed(revoked.client,user,OWN),
  e=>e.status===404);
 assert.deepEqual(revoked.calls.services,[]);
});
test('untrusted event identifier is rejected before even reading the event',async()=>{
 for(const id of [null,{},'../../event','another?tab=financial','',5]){
  const f=fixture();
  await assert.rejects(readClientEventDetailsFeed(f.client,f.actor,id),
   e=>e.status===400);
  assert.equal(f.calls.event,0);
 }
});
test('no raw supplier metadata is emitted even for assigned services',()=>{
 const event=clientEventCardProject(own);
 assert.equal(Object.hasOwn(event,'created_by'),false);
 assert.equal(Object.hasOwn(event,'billing_customer_id'),false);
 assert.equal(Object.hasOwn(event,'quote_history'),false);
});
test('paging is complete if the SDK silently caps each page size',async()=>{
 const rows=Array.from({length:157},(_,i)=>({...one,id:'svc-'+i}));
 const f=fixture({services:rows,cap:60});
 const result=await readClientEventDetailsFeed(f.client,user,OWN);
 assert.equal(result.services.length,157);
 assert.equal(new Set(result.services.map(s=>s.id)).size,157);
 assert.equal(f.calls.services.length,4);
});
test('duplicate service IDs, foreign rows and incomplete scans fail closed',async()=>{
 const dup=fixture({services:[one,{...one}]});
 await assert.rejects(readClientEventDetailsFeed(dup.client,user,OWN),
  e=>e.status===503);
 const forged=fixture();
 forged.client.asServiceRole.entities.EventService.filter=async()=>[
  {...one,id:'another-service',event_id:OTHER}
 ];
 await assert.rejects(readClientEventDetailsFeed(forged.client,user,OWN),
  e=>e.status===503);
 const truncated=fixture();
 truncated.client.asServiceRole.entities.EventService.filter=async()=>[one];
 await assert.rejects(readClientEventDetailsFeed(truncated.client,user,OWN),
  e=>e.status===503);
});
test('role gating preserves admin and user routes but blocks mismatched dashboards before mount',()=>{
 const owner='admin@example.org';
 assert.equal(canMountPulsePage(user,'/ClientDashboard',owner),true);
 assert.equal(canMountPulsePage(user,'/EventDetails',owner),true);
 assert.equal(canMountPulsePage(user,'/AdminDashboard',owner),false);
 assert.equal(canMountPulsePage(user,'/EventManagement',owner),false);
 assert.equal(canMountPulsePage(user,'/SettingsPage',owner),false);
 assert.equal(canMountPulsePage(user,'/SupplierEventView',owner),false);
 const supplier={...user,user_type:'supplier'};
 assert.equal(canMountPulsePage(supplier,'/SupplierCalendarDashboard',owner),true);
 assert.equal(canMountPulsePage(supplier,'/ClientDashboard',owner),false);
 assert.equal(canMountPulsePage(supplier,'/EventDetails',owner),true);
 const admin={...user,role:'admin',email:owner};
 assert.equal(canMountPulsePage(admin,'/AdminDashboard',owner),true);
 assert.equal(canMountPulsePage(admin,'/SettingsPage',owner),true);
 assert.equal(canMountPulsePage({...admin,email:'other@example.org'},
  '/SettingsPage',owner),false);
});
