import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';
import {readSupplierAssignmentsFeed,supplierFeedAssignment}
 from '../base44/shared/supplierAssignmentsFeed.ts';

const SUP='supplier-mine',OTHER='supplier-foreign';
const EVENT='event-own',FOREIGN='event-other',REJECTED='event-rejected';
const login={role:'user',user_type:'supplier',email:'SUPPLIER@EXAMPLE.COM',phone:'0501112222'};
const supplier={id:SUP,contact_emails:['supplier@example.com'],phone:'0501112222',
 supplier_name:'Current supplier',notes:'PRIVATE SUPPLIER NOTES',rating:5};
const event={
 id:EVENT,event_name:'Family event',family_name:'Family',
 child_name:'Child',event_date:'2026-11-05',event_time:'10:30',
 location:'Event venue',city:'Jerusalem',guest_count:32,
 parents:[{name:'PRIVATE FAMILY CONTACT',phone:'0500000000'}],
 total_price:90000,billing_customer_id:'PRIVATE_BILLING_CUSTOMER',
 notes:'PRIVATE EVENT NOTES',created_by:'private@example.com',
 custom_organizer_fields:{secret:'SECRET VALUE'}
};
const catalog={id:'service-catalog',service_name:'Band',service_description:'Description',
 base_price:99000,admin_notes:'PRIVATE CATALOG NOTES'};
const assigned=(id=EVENT,status='pending',supplierId=SUP)=>({
 id:'assignment-'+id,event_id:id,service_id:'service-catalog',
 supplier_ids:JSON.stringify([supplierId,OTHER]),
 supplier_statuses:JSON.stringify({[supplierId]:status,[OTHER]:'confirmed'}),
 supplier_notes:JSON.stringify({[supplierId]:'Own note',[OTHER]:'FOREIGN SUPPLIER NOTE'}),
 service_name:'Band',service_description:'Description',
 supplier_arrival_time:'09:00',is_external:false,
 internal_price:70000,admin_notes:'PRIVATE SERVICE NOTES'
});
function fixture({
 user=login,rows=[assigned(),assigned(FOREIGN,'pending',OTHER),
  assigned(REJECTED,'rejected')],
 suppliers=[supplier,{id:OTHER,contact_emails:['other@example.com'],
  phone:'0503334444',supplier_name:'Other supplier'}],
 evs=[event,{...event,id:FOREIGN,event_name:'Other event'},
  {...event,id:REJECTED,event_name:'Rejected event'}],
}={}){
 const events=new Map(evs.map(e=>[e.id,e]));
 const catalogMap=new Map([[catalog.id,catalog]]);
 const calls={suppliers:0,filters:0,eventIds:[],catalogIds:[],writes:0};
 const db={
  Supplier:{list:async()=>{calls.suppliers++;return structuredClone(suppliers);}},
  EventService:{filter:async(q,sort,limit,offset,fields)=>{
   calls.filters++;
   assert.deepEqual(q,{supplier_ids:{$regex:'"'+SUP+'"'}});
   assert.equal(sort,'-created_date');
   assert.ok(Number.isInteger(limit)&&Number.isInteger(offset));
   assert.ok(fields.includes('supplier_ids')&&fields.includes('supplier_statuses'));
   assert.ok(!fields.includes('custom_price'));
   const scoped=rows.filter(row=>typeof row?.supplier_ids==='string'&&
    row.supplier_ids.includes(q.supplier_ids.$regex));
   return structuredClone(scoped.slice(offset,offset+limit));
  }},
  Event:{get:async id=>{calls.eventIds.push(id);
   return structuredClone(events.get(id)??null);}},
  Service:{get:async id=>{calls.catalogIds.push(id);
   return structuredClone(catalogMap.get(id)??null);}}
 };
 return {client:{asServiceRole:{entities:db}},user,calls};
}
test('scoped supplier feed joins only authenticated email and own assigned services',async()=>{
 const f=fixture();
 const data=await readSupplierAssignmentsFeed(f.client,f.user);
 assert.equal(data.supplier?.id,SUP);
 assert.equal(data.supplier?.supplier_name,'Current supplier');
 assert.equal(data.assignments.length,2);
 assert.ok(!f.calls.eventIds.includes(FOREIGN),
  'never load a foreign Event, even in the trusted backend');
 const own=data.assignments.find(x=>x.id===EVENT);
 assert.equal(own.assignmentStatus,'pending');
 assert.equal(own.event_time,'09:00');
 assert.equal(own.original_event_time,'10:30');
 assert.equal(own.serviceName,'Band');
 assert.equal(own.supplierNote,'Own note');
 assert.equal(own.detailsAllowed,true);
 for(const key of ['parents','total_price','billing_customer_id','notes','created_by',
  'internal_price','supplier_ids','supplier_statuses','supplier_notes',
  'custom_organizer_fields','admin_notes','phone','contact_emails']){
  assert.ok(!(key in own),'raw/private field escaped: '+key);
 }
 assert.ok(!JSON.stringify(data).includes('PRIVATE'));
 assert.ok(!JSON.stringify(data).includes('FOREIGN SUPPLIER NOTE'));
});
test('rejected assignment remains for in-app action, but event details are redacted',async()=>{
 const f=fixture();
 const {assignments}=await readSupplierAssignmentsFeed(f.client,f.user);
 const declined=assignments.find(x=>x.id===REJECTED);
 assert.equal(declined.assignmentStatus,'rejected');
 assert.equal(declined.detailsAllowed,false);
 assert.equal(declined.event_name,'שיבוץ שנדחה');
 assert.equal(declined.location,'');
 assert.equal(declined.family_name,'');
 assert.equal(declined.child_name,'');
 assert.equal(declined.serviceName,'Band');
 assert.equal(declined.supplierNote,'');
 assert.equal(declined.eventServiceId,'assignment-'+REJECTED);
 assert.equal(declined.event_date,'2026-11-05');
});
test('phone-only, forged email, client role and missing user do not grant supplier access',async()=>{
 const phoneUser={role:'user',user_type:'supplier',phone:'0501112222',
  email:'other-user@example.org'};
 const phone=fixture({user:phoneUser});
 assert.deepEqual(await readSupplierAssignmentsFeed(phone.client,phone.user),
  {supplier:null,assignments:[]});
 assert.equal(phone.calls.eventIds.length,0);
 for(const user of [
  null,{...login,user_type:'client'}, {...login,user_type:undefined},
  {...login,email:''}
 ]){
  const f=fixture({user});
  await assert.rejects(readSupplierAssignmentsFeed(f.client,user),
    error=>error.status===403);
  assert.equal(f.calls.suppliers,0);
 }
});
test('supplier removed, external, stale and malformed statuses are never leaked',async()=>{
 const rows=[assigned(),assigned(FOREIGN,'pending',OTHER),
  {...assigned('event-external'),is_external:true},
  {...assigned('event-malformed'),supplier_statuses:'{not json'},
  {...assigned('event-removed'),supplier_ids:JSON.stringify([OTHER])},
  {...assigned('event-unknown'),supplier_statuses:JSON.stringify({[SUP]:'cancelled'})}];
 const data=await readSupplierAssignmentsFeed(fixture({rows}).client,login);
 assert.equal(data.assignments.length,1);
 assert.equal(data.assignments[0].id,EVENT);
});
test('legacy approved maps to confirmed, and service catalog fallback stays allowlisted',async()=>{
 const f=fixture({rows:[{...assigned(),supplier_statuses:
  JSON.stringify({[SUP]:'approved'}),service_name:'',service_description:''}]});
 const data=await readSupplierAssignmentsFeed(f.client,f.user);
 assert.equal(data.assignments[0].assignmentStatus,'confirmed');
 assert.equal(data.assignments[0].serviceName,'Band');
 assert.equal(data.assignments[0].serviceDescription,'Description');
 assert.deepEqual(f.calls.catalogIds,['service-catalog']);
});
test('pagination finds own record after 200 unrelated services without client-side bulk reads',async()=>{
 const foreignRows=Array.from({length:201},(_,i)=>({
  ...assigned('event-many-'+i,'pending',OTHER),id:'foreign-'+i
 }));
 const f=fixture({rows:[...foreignRows,assigned()]});
 const data=await readSupplierAssignmentsFeed(f.client,f.user);
 assert.equal(data.assignments.length,1);
 assert.equal(f.calls.filters,2,'one scoped page and one empty page, not a global scan');
 assert.deepEqual(f.calls.eventIds,[EVENT]);
});
test('more than 2800 unrelated services cannot trigger a global scan or truncate the supplier feed',async()=>{
 const unrelated=Array.from({length:2847},(_,i)=>({
  ...assigned('other-'+i,'pending',OTHER),id:'historical-'+i
 }));
 const own=Array.from({length:48},(_,i)=>({
  ...assigned(EVENT,'pending',SUP),id:'own-service-'+i
 }));
 const f=fixture({rows:[...unrelated,...own],evs:[event]});
 const out=await readSupplierAssignmentsFeed(f.client,f.user);
 assert.equal(out.assignments.length,48);
 assert.equal(f.calls.filters,2,'exact supplier-only search, plus empty page');
 assert.deepEqual(f.calls.eventIds,[EVENT]);
 assert.ok(out.assignments.every(x=>x.detailsAllowed));
});
test('unsupported targeted query and provider returning foreign rows fail closed',async()=>{
 const unimplemented=fixture();
 unimplemented.client.asServiceRole.entities.EventService.filter=async()=>{
  throw Error('provider rejected scoped query');
 };
 await assert.rejects(readSupplierAssignmentsFeed(
  unimplemented.client,unimplemented.user),
  e=>e.status===503&&e.code==='supplier_feed_scoped_query_failed');
 assert.deepEqual(unimplemented.calls.eventIds,[]);
 const ignored=fixture();
 ignored.client.asServiceRole.entities.EventService.filter=async()=>[
  {...assigned(FOREIGN,'pending',OTHER),id:'foreign-service'}
 ];
 await assert.rejects(readSupplierAssignmentsFeed(ignored.client,ignored.user),
  e=>e.status===503&&e.code==='supplier_feed_scope_mismatch');
 assert.deepEqual(ignored.calls.eventIds,[]);
});
test('legacy assigned member with no status remains pending and is permitted own event link',async()=>{
 const f=fixture({rows:[{...assigned(),supplier_statuses:'{}'}],evs:[event]});
 const feed=await readSupplierAssignmentsFeed(f.client,f.user);
 assert.equal(feed.assignments.length,1);
 assert.equal(feed.assignments[0].assignmentStatus,'pending');
 assert.equal(feed.assignments[0].detailsAllowed,true);
});
test('provider page cap below requested 200 still reaches later assigned rows',async()=>{
 const filler=Array.from({length:135},(_,i)=>({
  ...assigned('event-other-'+i,'pending',OTHER),id:'foreign-row-'+i
 }));
 const ownRows=Array.from({length:110},(_,i)=>({...assigned(),id:'mine-'+i}));
 const rows=[...filler,...ownRows];
 const f=fixture({rows,evs:[event]});
 const db=f.client.asServiceRole.entities;
 db.EventService.filter=async(q,sort,limit,offset)=>{
  assert.deepEqual(q,{supplier_ids:{$regex:'"'+SUP+'"'}});
  const mine=rows.filter(row=>row.supplier_ids.includes(q.supplier_ids.$regex));
  return structuredClone(mine.slice(offset,offset+Math.min(limit,60)));
 };
 const result=await readSupplierAssignmentsFeed(f.client,f.user);
 assert.equal(result.assignments.length,110);
 assert.equal(new Set(result.assignments.map(x=>x.eventServiceId)).size,110);
 assert.deepEqual(result.assignments.map(x=>x.id).filter(x=>x!==EVENT),[]);
});
test('multiple supplier profiles are never client-selected; only first exact email association',async()=>{
 const second={id:'supplier-extra',supplier_name:'Second',
  contact_emails:['supplier@example.com'],phone:'0507777777'};
 const f=fixture({rows:[assigned(EVENT,'pending',SUP),
  assigned('event-extra','pending',second.id)],suppliers:[supplier,second],
  evs:[event,{...event,id:'event-extra'}]});
 const {assignments,supplier:me}=await readSupplierAssignmentsFeed(f.client,f.user);
 assert.equal(me.id,SUP);
 assert.deepEqual(assignments.map(e=>e.id),[EVENT]);
});
test('malformed or ambiguous scans must fail closed, not silently serve an incomplete feed',async()=>{
 const f=fixture();
 f.client.asServiceRole.entities.EventService.filter=async(q)=>{
  assert.deepEqual(q,{supplier_ids:{$regex:'"'+SUP+'"'}});return [null];
 };
 await assert.rejects(readSupplierAssignmentsFeed(f.client,f.user),
  e=>e.status===503);
 const tooMany=Array.from({length:202},(_,i)=>({
  ...assigned(),id:'own-assign-'+i
 }));
 const over=fixture({rows:tooMany});
 await assert.rejects(readSupplierAssignmentsFeed(over.client,over.user),
  e=>e.code==='supplier_feed_too_many_assignments');
});
test('projection drops foreign private columns even when an SDK returns full raw objects',()=>{
 const row={...assigned(),is_external:false};
 const projected=supplierFeedAssignment(row,event,catalog,SUP);
 assert.ok(projected);
 assert.equal(projected.supplierNote,'Own note');
 assert.ok(!JSON.stringify(projected).includes('PRIVATE'));
 const forbidden=supplierFeedAssignment(row,event,catalog,OTHER);
 assert.equal(forbidden.assignmentStatus,'confirmed'); // same shared assignment,
 assert.equal(forbidden.supplierNote,'FOREIGN SUPPLIER NOTE'); // permitted only if OTP/email establishes OTHER account
});
function compiledEndpoint({authUser=login,payload={},method='POST',dbFixture=fixture()}={}){
 const code=esbuild.transformSync(fs.readFileSync(
  'base44/functions/supplierAssignmentsFeed/entry.ts','utf8'),{
   loader:'ts',format:'cjs',target:'es2022'
  }).code;
 let handler;
 vm.runInNewContext(code,{
  module:{exports:{}},exports:{},
  Deno:{serve:fn=>handler=fn},
  Response:{json:(body,{status=200,headers={}}={})=>({body,status,headers})},
  console:{warn:()=>{}},
  require(name){
   if(name==='npm:@base44/sdk@0.8.52')
    return {createClientFromRequest:()=>({
     ...dbFixture.client,auth:{me:async()=>authUser}
    })};
   if(name.endsWith('supplierAssignmentsFeed.ts'))return {readSupplierAssignmentsFeed};
   throw Error('Unexpected dependency '+name);
  }
 });
 return handler({method,json:async()=>payload});
}
test('HTTP gate denies GET, anonymous, supplied ids/filters before any data access',async()=>{
 for(const [args,status] of [
  [{method:'GET'},405],
  [{authUser:null},401],
  [{payload:{supplierId:SUP}},400],
  [{payload:{eventId:FOREIGN}},400],
  [{payload:{fields:['total_price']}},400],
  [{payload:null},400],
 ]){
  const f=fixture();
  const result=await compiledEndpoint({...args,dbFixture:f});
  assert.equal(result.status,status);
  assert.equal(f.calls.suppliers,0);
  assert.match(result.headers['Cache-Control'],/no-store/);
 }
 const success=await compiledEndpoint();
 assert.equal(success.status,200);
 assert.equal(success.body.success,true);
 assert.equal(success.body.assignments.length,2);
 assert.match(success.headers['Cache-Control'],/no-store/);
});
test('supplier portals have no direct entity bulk reads and preserve secure status endpoint',()=>{
 const hook=fs.readFileSync('src/hooks/useSupplierAssignmentsFeed.js','utf8');
 assert.match(hook,/functions\.invoke\('supplierAssignmentsFeed',\{\}\)/);
 assert.match(hook,/user\?\.id\|\|identity/);
 for(const file of ['src/pages/SupplierDashboard.jsx',
   'src/pages/SupplierCalendarDashboard.jsx']){
  const text=fs.readFileSync(file,'utf8');
  assert.match(text,/useSupplierAssignmentsFeed\(\)/,file);
  assert.doesNotMatch(text,/entities\.(?:Event|EventService|Supplier|Service)\.(?:list|filter|get)\(/,
   'no broad browser-side reads in '+file);
  assert.match(text,/functions\.invoke\('updateSupplierStatus'/);
  assert.match(text,/invalidateQueries\(\{queryKey:\['supplierAssignmentsFeed'\]\}\)/);
  assert.match(text,/SupplierEventView/);
  assert.match(text,/feedError/);
 }
 const server=fs.readFileSync('base44/shared/supplierAssignmentsFeed.ts','utf8');
 assert.match(server,/const scopedQuery=\{supplier_ids:\{\$regex:/);
 assert.doesNotMatch(server,/EventService\.filter\(\{\},/);
 const api=fs.readFileSync('base44/functions/supplierAssignmentsFeed/entry.ts','utf8');
 assert.match(api,/category=/);
 // Do not prematurely make RLS admin-only while the CLIENT and other
 // non-admin pages still use legacy list queries.
 const es=fs.readFileSync('base44/entities/EventService.jsonc','utf8');
 const ev=fs.readFileSync('base44/entities/Event.jsonc','utf8');
 assert.match(ev,/"read":\s*\{\}/);
 assert.match(es,/"read":\s*\{\}/);
});
