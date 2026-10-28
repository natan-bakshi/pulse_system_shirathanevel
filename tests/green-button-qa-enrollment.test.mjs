import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {enrollOneGreenButtonQaAssignment} from '../base44/shared/greenButtonQaEnrollment.ts';
import {GREEN_BUTTON_QA_EVENT_NAME,GREEN_BUTTON_QA_FAMILY_NAME,
 GREEN_BUTTON_QA_SERVICE_NAME} from '../base44/shared/greenButtonQaFixture.ts';
const CHAT='972501234567@c.us',SERVICE='service-abc',SUPPLIER='supplier-abc',EVENT='event-abc';
const envValues={
 GREEN_BUTTONS_QA_CREATE_ENABLED:'enabled',GREEN_BUTTONS_QA_SEND_ENABLED:'enabled',
 GREEN_BUTTONS_QA_SCOPED_V2_ENABLED:'enabled',
 GREEN_BUTTONS_QA_INBOUND_ENABLED:'enabled',GREEN_BUTTONS_QA_ACCOUNT_VERIFIED:'verified',
 GREEN_BUTTONS_QA_OWNER_APPROVED:'approved',GREEN_BUTTONS_QA_EVENT_ID:EVENT,
 GREEN_BUTTONS_QA_EVENT_SERVICE_ID:SERVICE,GREEN_BUTTONS_QA_SUPPLIER_ID:SUPPLIER,
 GREEN_BUTTONS_QA_ALLOWED_CHAT:CHAT,GREEN_API_INSTANCE_ID:'9903183013',
 GREEN_API_TOKEN:'test-green-only-not-a-real-token-123456789',
 GREEN_API_WEBHOOK_TOKEN:'test-green-webhook-not-a-real-secret-123456789',
 WHATSAPP_INTERACTIVE_SIGNING_SECRET:'test-owner-action-not-a-real-secret-123456789'
};
const policy={companyId:'shirat_hanevel',provider:'green',
 messageKind:'assignment',version:1,officeNumber:'972551111111',
 policy:{enabled:false,quoteAssignment:false,buttons:[
  {action:'assignment_approve',label:'מאשר'},
  {action:'assignment_reject',label:'דוחה'},
  {action:'contact_office',label:'פנייה למשרד'}]}};
function fixture(){
 const rows={control:{id:'control-abc',control_key:'global',enabled:true,paused:false,
   interactive_outbound_live_enabled:true,
   interactive_assignment_green_policy_json:JSON.stringify(policy)},
  service:{id:SERVICE,event_id:EVENT,service_name:GREEN_BUTTON_QA_SERVICE_NAME,
   updated_date:'2026-10-27T12:01:00.000Z',
   is_external:false,supplier_ids:'[]',supplier_statuses:'{}',supplier_notes:'{}',
   assignment_intent_revision:0,assignment_notification_intents:'[]'},
  supplier:{id:SUPPLIER,phone:'0501234567',preferred_channel:'phone',
   whatsapp_enabled:true,is_active:true,contact_person:'PRIVATE_NAME'},
  event:{id:EVENT,status:'quote',event_name:GREEN_BUTTON_QA_EVENT_NAME,
   family_name:GREEN_BUTTON_QA_FAMILY_NAME,event_type:'other',
   whatsapp_buttons_qa_fixture:true}};
 const counts={control:0,settings:0,services:0,suppliers:0,
  events:0,outbox:0,pendingReads:0,cas:0,wake:0,provider:0};
 let flag='true',priorJobs=[],otherPending=[],commitUncertain=false,wakeFails=false;
 const client={asServiceRole:{entities:{
  WhatsAppQueueControl:{filter:async()=>{counts.control++;return [rows.control]}},
  AppSettings:{filter:async()=>{counts.settings++;return flag==='true'?
   [{setting_key:'assignment_intent_v1_enabled',setting_value:'true'}]:[]}},
  EventService:{
   get:async id=>{counts.services++;return id===SERVICE?rows.service:null;},
   filter:async(query,sort,limit,_offset,fields)=>{
    counts.pendingReads++;
    assert.equal(query.assignment_intents_pending,true);
    assert.equal(sort,'updated_date');assert.equal(limit,2);
    assert.deepEqual(fields,['id']);
    return otherPending.slice(0,limit);
   },
   updateMany:async(query,change)=>{
    counts.cas++;
    if(query.id!==rows.service.id||
     query.updated_date!==rows.service.updated_date||
     query.supplier_ids!==rows.service.supplier_ids||
     query.supplier_statuses!==rows.service.supplier_statuses)return {updated:0};
    Object.assign(rows.service,change.$set);
    if(commitUncertain)throw Error('AMBIGUOUS_AFTER_COMMIT');
    return {updated:1};
   },
   update:async(id,patch)=>{
    counts.wake++;
    if(wakeFails)throw Error('WAKING_FAILED');
    assert.equal(id,SERVICE);Object.assign(rows.service,patch);
   }
  },
  Supplier:{get:async id=>{counts.suppliers++;return id===SUPPLIER?rows.supplier:null;}},
  Event:{get:async id=>{counts.events++;return id===EVENT?rows.event:null;}},
  WhatsAppOutbox:{filter:async(query,_sort,limit,_offset,fields)=>{
   counts.outbox++;
   assert.equal(query.source_type,'assignment_new');
   assert.equal(query.event_service_id,SERVICE);
   assert.equal(query.supplier_id,SUPPLIER);
   assert.equal(limit,2);
   assert.deepEqual(fields,['id','status']);
   return priorJobs;
  }}
 }}};
 return {rows,counts,client,
  env:(override={})=>k=>({...envValues,...override})[k]??'',
  setFlag:v=>{flag=v},setPrior:v=>{priorJobs=v},
  setPending:v=>{otherPending=v},
  setUncertain:()=>{commitUncertain=true},setWakeFail:()=>{wakeFails=true}};
}
const request=f=>({env:f.env(),confirmation:'I_APPROVE_ONE_QA_ASSIGNMENT'});
test('requires owner confirmation and independent enable flag before any read',async()=>{
 const f=fixture();
 for(const opts of [
  {env:f.env(),confirmation:'wrong'},
  {env:f.env({GREEN_BUTTONS_QA_CREATE_ENABLED:''}),confirmation:'I_APPROVE_ONE_QA_ASSIGNMENT'}
 ]){
  await assert.rejects(enrollOneGreenButtonQaAssignment(f.client,opts),
   err=>err.code==='qa_enrollment_not_approved');
 }
 assert.equal(f.counts.control,0);assert.equal(f.counts.cas,0);
});
test('single click atomically adds only the QA supplier with one V2 intent, no direct Green call',async()=>{
 const f=fixture();const r=await enrollOneGreenButtonQaAssignment(f.client,request(f));
 assert.equal(r.saved,true);assert.equal(r.wakeRequested,true);
 assert.equal(r.oneConfirmedAssignmentCAS,true);
 assert.equal(r.queueMaySendWhatsAppAutomatically,true);
 assert.equal(f.counts.cas,1);assert.equal(f.counts.wake,1);assert.equal(f.counts.provider,0);
 assert.deepEqual(JSON.parse(f.rows.service.supplier_ids),[SUPPLIER]);
 assert.deepEqual(JSON.parse(f.rows.service.supplier_statuses),{[SUPPLIER]:'pending'});
 assert.equal(f.rows.service.assignment_intent_mode,'durable_v1');
 assert.equal(f.rows.service.assignment_intents_pending,true);
 const intents=JSON.parse(f.rows.service.assignment_notification_intents);
 assert.equal(intents.length,1);
 assert.equal(intents[0].key,'assignment:'+SERVICE+':'+SUPPLIER+':r1:SUPPLIER_NEW_ASSIGNMENT');
 assert.equal(intents[0].state,'requested');
 assert.equal(intents[0].qa_buttons_required,true,
  'pilot obligation must be durable in the SAME business CAS');
 const response=JSON.stringify(r);
 for(const secret of ['PRIVATE_NAME','PRIVATE_EVENT',CHAT,SERVICE,SUPPLIER,
  envValues.WHATSAPP_INTERACTIVE_SIGNING_SECRET])
  assert.equal(response.includes(secret),false);
 await assert.rejects(enrollOneGreenButtonQaAssignment(f.client,request(f)),
  err=>err.code==='qa_supplier_already_assigned_or_invalid');
 assert.equal(f.counts.cas,1);
});
test('inactive rollout, wrong event or number, prior send and stale data never create QA assignment',async()=>{
 const cases=[
  f=>{f.rows.control.interactive_outbound_live_enabled=false},
  f=>{f.rows.event.status='completed'},
  f=>{f.rows.service.event_id='another-event'},
  f=>{f.rows.supplier.phone='0509999999'},
  f=>{f.rows.supplier.whatsapp_enabled=false},
  f=>{f.rows.control.paused=true},
  f=>{f.rows.control.unknown_guard_key='UNRESOLVED'},
  f=>{f.setPrior([{id:'prior-outbox',status:'accepted'}])},
  f=>{f.rows.service.updated_date='invalid-date'}
 ];
 for(const mutate of cases){
  const f=fixture();mutate(f);
  await assert.rejects(enrollOneGreenButtonQaAssignment(f.client,request(f)));
  assert.equal(f.counts.cas,0);
  assert.equal(f.counts.wake,0);
  assert.equal(f.counts.provider,0);
 }
});
test('global V2 and QA-scoped V2 both OFF prevent enrollment without writes',async()=>{
 const f=fixture();f.setFlag('false');
 await assert.rejects(enrollOneGreenButtonQaAssignment(f.client,{
  env:f.env({GREEN_BUTTONS_QA_SCOPED_V2_ENABLED:''}),
  confirmation:'I_APPROVE_ONE_QA_ASSIGNMENT'
 }));
 assert.equal(f.counts.cas,0);
 assert.equal(f.counts.wake,0);
 assert.equal(f.counts.provider,0);
});
test('group-preferring supplier can enroll ONLY into the approved, private, marked QA assignment',async()=>{
 const f=fixture();
 f.rows.supplier.preferred_channel='group';
 f.rows.supplier.whatsapp_group_url='https://chat.whatsapp.com/group-not-used';
 const enrolled=await enrollOneGreenButtonQaAssignment(f.client,request(f));
 assert.equal(enrolled.saved,true);
 assert.equal(f.rows.supplier.preferred_channel,'group');
 assert.equal(f.rows.supplier.whatsapp_group_url,'https://chat.whatsapp.com/group-not-used');
 assert.equal(f.counts.cas,1);
 assert.equal(f.counts.provider,0);
 const journal=JSON.parse(f.rows.service.assignment_notification_intents);
 assert.equal(journal.length,1);
 assert.equal(journal[0].qa_buttons_required,true);
 // A second approval cannot change or create another business assignment.
 await assert.rejects(enrollOneGreenButtonQaAssignment(f.client,request(f)),
  err=>err.code==='qa_supplier_already_assigned_or_invalid');
 assert.equal(f.counts.cas,1);
});
test('prior V2 intent WITHOUT any Outbox still prevents re-enrollment of the same supplier',async()=>{
 const f=fixture();
 f.rows.service.assignment_notification_intents=JSON.stringify([{
  supplier_id:SUPPLIER,revision:1,
  key:'assignment:'+SERVICE+':'+SUPPLIER+':r1:SUPPLIER_NEW_ASSIGNMENT',
  state:'resolved'
 }]);
 await assert.rejects(enrollOneGreenButtonQaAssignment(f.client,request(f)),
  err=>err.code==='qa_previous_assignment_intent_requires_review');
 assert.equal(f.counts.outbox,0);
 assert.equal(f.counts.cas,0);
 assert.equal(f.counts.wake,0);
});
test('corrupted previous journal stops enrollment before any CAS or provider access',async()=>{
 const f=fixture();f.rows.service.assignment_notification_intents='{invalid';
 await assert.rejects(enrollOneGreenButtonQaAssignment(f.client,request(f)),
  err=>err.code==='qa_intent_history_corrupt');
 assert.equal(f.counts.cas,0);
 assert.equal(f.counts.outbox,0);
});
test('unrelated pending global V2 intents block QA enrollment before new business write',async()=>{
 const f=fixture();f.setPending([{id:'other-service-123'}]);
 await assert.rejects(enrollOneGreenButtonQaAssignment(f.client,request(f)),
  err=>err.code==='qa_other_v2_intents_pending_global_risk');
 assert.equal(f.counts.pendingReads,1);
 assert.equal(f.counts.cas,0);
 assert.equal(f.counts.wake,0);
});
test('uncertain commit fails closed and second click cannot repeat business CAS',async()=>{
 const f=fixture();f.setUncertain();
 await assert.rejects(enrollOneGreenButtonQaAssignment(f.client,request(f)),
  err=>err.code==='qa_enrollment_commit_uncertain_review');
 assert.equal(f.counts.cas,1);assert.equal(f.counts.wake,0);
 assert.equal(JSON.parse(f.rows.service.assignment_notification_intents).length,1);
 await assert.rejects(enrollOneGreenButtonQaAssignment(f.client,request(f)),
  err=>err.code==='qa_supplier_already_assigned_or_invalid');
 assert.equal(f.counts.cas,1);
});
test('confirmed V2 write plus failed trigger wake reports watchdog fallback without duplicate mutation',async()=>{
 const f=fixture();f.setWakeFail();
 const r=await enrollOneGreenButtonQaAssignment(f.client,request(f));
 assert.equal(r.saved,true);assert.equal(r.wakeRequested,false);
 assert.equal(r.watchdogFallbackRequired,true);
 assert.equal(f.counts.cas,1);assert.equal(f.counts.wake,1);
});
test('enrollment is owner-action only; helper cannot send to provider directly',()=>{
 const code=fs.readFileSync('base44/shared/greenButtonQaEnrollment.ts','utf8');
 assert.doesNotMatch(code,/fetch\(|sendWhatsAppTransport|Deno\.serve|setInterval\(/);
 const admin=fs.readFileSync('base44/functions/WhatsAppQueueAdmin/entry.ts','utf8');
 assert.match(admin,/if\(action==='greenButtonQaEnroll'\)/);
 assert.match(admin,/OWNER_EMAIL/);
});
