import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';
import {
 clientDashboardEventAllowed,clientDashboardFinancialSummary,readClientDashboardFeed
} from '../base44/shared/clientDashboardFeed.ts';

const OWN='event-own',OTHER='event-foreign',DISABLED='event-opted-out';
const actor={role:'user',user_type:'client',email:'CLIENT@EXAMPLE.COM'};
const base={
 id:OWN,event_name:'My event',family_name:'Family',child_name:'Child',
 event_date:'2026-11-05',event_time:'10:30',location:'Jerusalem',
 guest_count:30,status:'confirmed',created_by:'client@example.com',
 contacts_schema_version:2,parents:[],
 total_price:999999,discount_amount:100,all_inclusive:false,
 billing_customer_id:'SECRET BILLING ID',
 notes:'SECRET INTERNAL NOTE',internal_token:'TOKEN',
 custom_organizer_fields:{secret:'PRIVATE CUSTOM FIELD'}
};
const foreign={...base,id:OTHER,created_by:'stranger@example.com',
 event_name:'PRIVATE OTHER FAMILY',family_name:'PRIVATE OTHER FAMILY',
 parents:[{email:'foreign@example.com',client_access:true}]};
const optedOut={...base,id:DISABLED,created_by:'stranger@example.com',
 family_name:'PRIVATE OPTED OUT',parents:[{email:'client@example.com',
 client_access:false}]};
const svc={event_id:OWN,id:'service-1',custom_price:1000,quantity:2,
 includes_vat:false,is_external:false,admin_notes:'SECRET SERVICE'};
const paid={event_id:OWN,id:'payment-1',amount:600,payment_status:'completed',
 stored_card_operation_id:'SECRET CARD',notes:'SECRET PAY'};
const pending={event_id:OWN,id:'payment-2',amount:900,payment_status:'pending'};
function fixture({
 user=actor,events=[base,foreign,optedOut],services=[svc],payments=[paid,pending],
 vat='18'
}={}){
 const calls={events:0,serviceIds:[],paymentIds:[],settings:0};
 const db={
  Event:{filter:async(q,order,limit,offset,fields)=>{
   calls.events++;assert.deepEqual(q,{});
   assert.equal(order,'-created_date');
   assert.ok(fields.includes('parents')&&fields.includes('created_by'));
   assert.ok(!fields.includes('billing_customer_id'));
   return structuredClone(events.slice(offset,offset+limit));
  }},
  EventService:{filter:async(q,order,limit,offset,fields)=>{
   calls.serviceIds.push(q.event_id);
   assert.equal(limit,500);assert.ok(offset>=0);
   assert.ok(fields.includes('custom_price'));
   assert.ok(!fields.includes('supplier_ids'));
   return structuredClone(services.filter(x=>x.event_id===q.event_id)
    .slice(offset,offset+limit));
  }},
  Payment:{filter:async(q,order,limit,offset,fields)=>{
   calls.paymentIds.push(q.event_id);
   assert.ok(fields.includes('payment_status'));
   assert.ok(!fields.includes('stored_card_operation_id'));
   return structuredClone(payments.filter(x=>x.event_id===q.event_id)
    .slice(offset,offset+limit));
  }},
  AppSettings:{filter:async(q,order,limit,offset,fields)=>{
   calls.settings++;assert.deepEqual(q,{setting_key:'vat_rate'});
   return [{setting_key:'vat_rate',setting_value:vat}];
  }}
 };
 return {client:{asServiceRole:{entities:db}},user,calls};
}
test('own client sees only authorized event summary and server-computed finance total',async()=>{
 const f=fixture();
 const {events}=await readClientDashboardFeed(f.client,f.user);
 assert.equal(events.length,1);
 const e=events[0];
 assert.equal(e.id,OWN);
 assert.equal(e.event_date,'2026-11-05');
 assert.equal(e.family_name,'Family');
 assert.equal(e.finalTotal,2260);
 assert.equal(e.totalPaid,600);
 assert.equal(e.balance,1660);
 assert.equal(e.progress,600/2260*100);
 assert.equal(e.discount_amount,100);
 assert.ok(f.calls.serviceIds.length>0&&f.calls.serviceIds.every(id=>id===OWN));
 assert.ok(f.calls.paymentIds.length>0&&f.calls.paymentIds.every(id=>id===OWN));
 for(const field of ['parents','contacts_schema_version','created_by','total_price',
  'billing_customer_id','custom_organizer_fields','notes','internal_token','services',
  'payments','all_inclusive_price']){
  assert.equal(Object.hasOwn(e,field),false,'unexpected raw/private field: '+field);
 }
 assert.ok(!JSON.stringify(events).includes('SECRET'));
 assert.ok(!JSON.stringify(events).includes('PRIVATE'));
});
test('allowed client creator, explicit permitted contact, legacy contacts and admin own client card',()=>{
 assert.equal(clientDashboardEventAllowed(actor,base),true);
 const parent={...foreign,parents:[{email:'CLIENT@EXAMPLE.COM',client_access:true}]};
 assert.equal(clientDashboardEventAllowed(actor,parent),true);
 assert.equal(clientDashboardEventAllowed(actor,optedOut),false);
 assert.equal(clientDashboardEventAllowed(actor,foreign),false);
 const legacy={...foreign,contacts_schema_version:1,
  organizer_contacts:JSON.stringify([{email:'client@example.com'}])};
 assert.equal(clientDashboardEventAllowed(actor,legacy),false,
  'legacy unapproved contacts never grant client access');
 assert.equal(clientDashboardEventAllowed({...actor,role:'admin'},foreign),false,
  'admin entering client dashboard still sees only own email/contact events');
 assert.equal(clientDashboardEventAllowed({...actor,role:'admin'},base),true);
});
test('supplier, outsider, unauthenticated, phone-only and missing email denied before scan',async()=>{
 for(const user of [
  null,{role:'user',user_type:'supplier',email:'client@example.com'},
  {...actor,email:''},{...actor,email:undefined},
  {...actor,user_type:'other'}
 ]){
  const f=fixture({user});
  await assert.rejects(readClientDashboardFeed(f.client,user),e=>e.status===403);
  assert.equal(f.calls.events,0);
 }
 const other=fixture({user:{...actor,email:'outsider@example.com'}});
 assert.deepEqual(await readClientDashboardFeed(other.client,other.user),{events:[]});
 assert.equal(other.calls.serviceIds.length,0);
 assert.equal(other.calls.paymentIds.length,0);
});
test('payment and VAT calculations mirror the previous client dashboard rules',()=>{
 const event={all_inclusive:true,all_inclusive_price:1180,
  all_inclusive_includes_vat:true,discount_amount:80};
 const a=clientDashboardFinancialSummary(event,[],[paid,pending],0.18);
 assert.equal(Math.round(a.finalTotal),1100);
 assert.equal(Math.round(a.balance),500);
 const b=clientDashboardFinancialSummary({
  ...event,all_inclusive:false
 },[svc,{...svc,is_external:true,custom_price:100000}], [paid],0.18);
 assert.equal(b.finalTotal,2280);
 assert.equal(b.totalPaid,600);
 const fallback=clientDashboardFinancialSummary({...event,discount_amount:0},[],[],NaN);
 assert.equal(Math.round(fallback.finalTotal),1180);
});
test('page through 200 foreign events; do not create a payment query for outsiders',async()=>{
 const extras=Array.from({length:201},(_,i)=>({
  ...foreign,id:'event-foreign-'+i
 }));
 const f=fixture({events:[...extras,base]});
 const {events}=await readClientDashboardFeed(f.client,f.user);
 assert.equal(f.calls.events,3);
 assert.equal(events.length,1);
 assert.ok(f.calls.serviceIds.length>0&&f.calls.serviceIds.every(id=>id===OWN));
 assert.ok(f.calls.paymentIds.length>0&&f.calls.paymentIds.every(id=>id===OWN));
});
test('SDK silently capping requested page size does not hide a later authorized event',async()=>{
 const extras=Array.from({length:130},(_,i)=>({
  ...foreign,id:'unrelated-'+i
 }));
 const all=[...extras,base];
 const f=fixture({events:all});
 f.client.asServiceRole.entities.Event.filter=async(q,sort,limit,offset)=>
  structuredClone(all.slice(offset,offset+Math.min(limit,65)));
 const {events}=await readClientDashboardFeed(f.client,f.user);
 assert.deepEqual(events.map(x=>x.id),[OWN]);
});
test('payments and service totals remain complete when SDK caps each finance page',async()=>{
 const services=Array.from({length:4},(_,i)=>({
  ...svc,id:'svc-own-'+i,custom_price:100,quantity:1
 }));
 const payments=Array.from({length:3},(_,i)=>({
  ...paid,id:'payment-own-'+i,amount:25
 }));
 const f=fixture({services,payments,events:[{...base,discount_amount:0}]});
 const db=f.client.asServiceRole.entities;
 db.EventService.filter=async(q,sort,limit,offset)=>
  structuredClone(services.filter(s=>s.event_id===q.event_id)
   .slice(offset,offset+Math.min(limit,2)));
 db.Payment.filter=async(q,sort,limit,offset)=>
  structuredClone(payments.filter(p=>p.event_id===q.event_id)
   .slice(offset,offset+Math.min(limit,1)));
 const {events}=await readClientDashboardFeed(f.client,f.user);
 assert.equal(events.length,1);
 assert.equal(events[0].finalTotal,472);
 assert.equal(events[0].totalPaid,75);
 assert.equal(events[0].balance,397);
});
test('non-matching opted-out client contact must not gain access to payments',async()=>{
 const f=fixture({events:[optedOut]});
 const result=await readClientDashboardFeed(f.client,f.user);
 assert.deepEqual(result.events,[]);
 assert.equal(f.calls.serviceIds.length,0);
});
test('bounded, malformed and incomplete financial scans fail closed',async()=>{
 const f=fixture();
 f.client.asServiceRole.entities.Event.filter=async()=>[null];
 await assert.rejects(readClientDashboardFeed(f.client,f.user),
  e=>e.status===503);
 const many=Array.from({length:122},(_,i)=>({...base,id:'own-event-'+i}));
 const over=fixture({events:many});
 await assert.rejects(readClientDashboardFeed(over.client,over.user),
  e=>e.code==='client_feed_too_many_events');
 const bad=fixture();
 bad.client.asServiceRole.entities.Payment.filter=async()=>
  Array.from({length:501},(_,i)=>({...paid,id:'payment-'+i}));
 await assert.rejects(readClientDashboardFeed(bad.client,bad.user),
  e=>e.code==='client_feed_incomplete_finance');
});
function endpoint({method='POST',authUser=actor,payload={},dataFixture=fixture()}={}){
 const code=esbuild.transformSync(fs.readFileSync(
  'base44/functions/clientDashboardFeed/entry.ts','utf8'),{
  loader:'ts',format:'cjs',target:'es2022'
 }).code;
 let handler;
 vm.runInNewContext(code,{
  module:{exports:{}},exports:{},
  Deno:{serve:fn=>handler=fn},
  Response:{json:(body,{status=200,headers={}}={})=>({body,status,headers})},
  console:{warn:()=>{}},
  require(name){
   if(name==='npm:@base44/sdk@0.8.52')return {
    createClientFromRequest:()=>({
     ...dataFixture.client,auth:{me:async()=>authUser}
    })
   };
   if(name.endsWith('clientDashboardFeed.ts'))return {readClientDashboardFeed};
   throw Error('Unexpected dependency '+name);
  }
 });
 return handler({method,json:async()=>payload});
}
test('client dashboard HTTP gate rejects forged Event IDs and fields before any DB reads',async()=>{
 for(const [input,status] of [
  [{method:'GET'},405],[{authUser:null},401],
  [{payload:{eventId:OTHER}},400],
  [{payload:{eventIds:[OTHER]}},400],
  [{payload:{role:'admin'}},400],
  [{payload:null},400],
 ]){
  const f=fixture();
  const result=await endpoint({...input,dataFixture:f});
  assert.equal(result.status,status);
  assert.equal(f.calls.events,0);
  assert.match(result.headers['Cache-Control'],/no-store/);
 }
 const okay=await endpoint();
 assert.equal(okay.status,200);
 assert.deepEqual(okay.body.events.map(e=>e.id),[OWN]);
 assert.equal(okay.body.success,true);
 assert.match(okay.headers['Cache-Control'],/no-store/);
});
test('client dashboard reads only scoped summary; never fetches raw events/services',()=>{
 const component=fs.readFileSync('src/pages/ClientDashboard.jsx','utf8');
 assert.match(component,/functions\.invoke\('clientDashboardFeed',\{\}\)/);
 assert.match(component,/\['clientDashboardFeed',user\?\.id\|\|identity,identity\]/);
 assert.doesNotMatch(component,/entities\.(?:Event|EventService|Supplier|Service|AppSettings)\.(?:list|filter|get)\(/);
 assert.doesNotMatch(component,/functions\.invoke\('clientEventFinance'/);
 assert.match(component,/queryClient\.invalidateQueries\(\{queryKey:\['clientDashboardFeed'\]\}\)/);
 assert.match(component,/feedError/);
 const eventSchema=fs.readFileSync('base44/entities/Event.jsonc','utf8');
 assert.match(eventSchema,/"read":\s*\{\}/,
  'RLS not blindly tightened while other roles still use raw lists');
});
