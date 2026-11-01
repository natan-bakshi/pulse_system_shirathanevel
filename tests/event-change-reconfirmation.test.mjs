import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {
 planEventChangeReconfirmation,parseEventChangeReconfirmation,
 isEventChangeStatusReset,closeSupersededAssignmentIntents,
 eligibleEventChangeReconfirmation,
 isEventChangeReconfirmationOutbox,checkEventChangeButtonCandidate
} from '../base44/shared/eventChangeReconfirmation.ts';
import {assignmentTransitionWhatsAppKey} from '../base44/shared/assignmentTransitionWhatsApp.ts';
import {prepareGreenInteractiveWorkerCandidate}
 from '../base44/shared/whatsappInteractiveWorkerBridge.ts';
import {parseGreenButtonSelection} from '../base44/shared/greenInteractiveCallback.ts';
import {resolveVerifiedGreenActionForButton}
 from '../base44/shared/whatsappButtonBindings.ts';
import {preflightWhatsAppAssignmentResponse}
 from '../base44/shared/whatsappInboundAdmission.ts';
import {persistAuthorizedSupplierStatus}
 from '../base44/shared/supplierStatusPersistence.ts';

const now=Date.parse('2026-11-01T12:30:00.000Z');
const SIGN='synthetic-fix002-secret-0123456789abcdef0123456789';
const WEBHOOK='synthetic-green-webhook-0123456789abcdef';
const INSTANCE='9903183013';
const SID='service-test-123',SUP='supplier-test-123',EID='event-test-123';
const EVENT_DATE='2026-11-09';
function context(kind='date_reconfirm',source=null){
 const service={
  id:SID,event_id:EID,supplier_ids:JSON.stringify([SUP]),
  supplier_statuses:JSON.stringify({[SUP]:'confirmed'}),
  supplier_arrival_time:kind==='arrival_notify'?'11:00':'',
  is_external:false,declined_suppliers:'[]'
 };
 const event={id:EID,event_date:EVENT_DATE,event_time:'11:30',
  date_change_pending_action:false};
 const fingerprint=kind==='date_reconfirm'?
  JSON.stringify(['2026-11-08','11:00',EVENT_DATE,'11:30']):
  JSON.stringify(['11:00',EVENT_DATE,'11:30']);
 const planned=planEventChangeReconfirmation(service,{
  kind,supplierIds:[SUP],fingerprint
 },now);
 const previous=structuredClone(service);
 service.supplier_statuses=JSON.stringify({[SUP]:'pending'});
 service.supplier_reconfirmation_context=planned.value;
 const sender=source|| (kind==='arrival_notify'?'arrival_time_change':'assignment_update');
 return {service,event,previous,planned,sourceType:sender,kind};
}
async function makeJob(f){
 const identity={kind:f.kind,eventId:EID,eventServiceId:SID,supplierId:SUP,
  templateId:'template-test-123',revision:f.planned.revision,
  ...(f.kind==='date_reconfirm'?{oldEventDate:'2026-11-08',oldEventTime:'11:00'}:
   {supplierArrivalTime:'11:00'}),
  eventDate:EVENT_DATE,eventTime:'11:30'};
 const key=await assignmentTransitionWhatsAppKey(identity);
 return {id:'outbox-change-test',source_type:f.sourceType,source_id:EID,
  event_service_id:SID,supplier_id:SUP,
  idempotency_key:key,notification_template_id:identity.templateId,
  message_type:'text',message_text:'עודכנו פרטי האירוע. אנא אשרו את השינוי.',
  status:'queued',requested_provider:'green',
  chat_id:'972501234567@c.us',created_date:new Date(now).toISOString(),
  attempt_count:0,send_started_at:'',provider_message_id:''};
}
function stubClient(f,job){
 const matches=(row,filter)=>Object.entries(filter).every(([k,v])=>
  (row?.[k]??null)===(v??null));
 const eventService={get:async()=>structuredClone(f.service),
  updateMany:async(filter,patch)=>{
   if(!matches(f.service,filter))return {updated:0};
   Object.assign(f.service,patch.$set);
   return {updated:1};
  }};
 const outbox={get:async()=>structuredClone(job),
  updateMany:async(filter,patch)=>{
   if(!matches(job,filter))return {updated:0};
   Object.assign(job,patch.$set);return {updated:1};
  }};
 const supplier={id:SUP,is_active:true,phone:'0501234567'};
 const db={WhatsAppOutbox:outbox,EventService:eventService,
  Event:{get:async()=>structuredClone(f.event)},Supplier:{get:async()=>supplier}};
 return {client:{entities:db,asServiceRole:{entities:db}},job};
}
const policy={enabled:true,quoteAssignment:false,buttons:[
 {action:'assignment_approve',label:'אישור שיבוץ'},
 {action:'assignment_reject',label:'דחיית שיבוץ'},
 {action:'contact_office',label:'פנייה למשרד'}
]};
async function readyInteractive(f,job){
 const {client}=stubClient(f,job);
 const preview=await prepareGreenInteractiveWorkerCandidate(client,job,'green',
  {interactive_outbound_live_enabled:true},{
   enabled:true,accountCapabilityVerified:true,legacyProductionApproved:true,
   capability:'reply_only',senderAccountId:INSTANCE,
   signingSecret:SIGN,policy,now
  });
 assert.equal(preview.kind,'interactive');
 return {client,prepared:preview};
}
function greenClick(id){
 return {typeWebhook:'incomingMessageReceived',
  instanceData:{idInstance:Number(INSTANCE),wid:'972599999999@c.us',typeInstance:'whatsapp'},
  timestamp:Math.floor(now/1000),idMessage:'C0CD39BB261589D5C98412D255CD000B',
  senderData:{chatId:'972501234567@c.us',sender:'972501234567@c.us'},
  messageData:{typeMessage:'interactiveButtonsResponse',
   quotedMessage:{stanzaId:'3EB0A5815E6EBF7DE71DE3'},
   interactiveButtonsResponse:{stanzaId:'3EB0A5815E6EBF7DE71DE3',
    selectedId:id,selectedDisplayText:'not trusted'}}};
}
test('only changed-to-pending AND newly committed admin marker suppresses assignment',()=>{
 const f=context();
 assert.equal(isEventChangeStatusReset(f.previous,f.service,SUP),true);
 assert.equal(isEventChangeStatusReset(f.service,f.service,SUP),false);
 const later={...f.service,supplier_statuses:JSON.stringify({[SUP]:'confirmed'})};
 assert.equal(isEventChangeStatusReset(f.service,later,SUP),false);
 const another={...f.service,id:'different-service-id'};
 assert.equal(isEventChangeStatusReset(f.previous,another,SUP),false);
 const added={...f.previous,supplier_ids:'[]'};
 assert.equal(isEventChangeStatusReset(added,f.service,SUP),false);
 const reopened={...f.service,supplier_reconfirmation_context:undefined};
 assert.equal(isEventChangeStatusReset(f.previous,reopened,SUP),false);
});
test('retries re-use same marker and new real change advances revision',()=>{
 const f=context();
 const repeat=planEventChangeReconfirmation(f.service,{
  kind:f.kind,supplierIds:[SUP],fingerprint:JSON.parse(f.planned.value).fingerprint
 },now+1200);
 assert.equal(repeat.reused,true);
 assert.equal(repeat.revision,f.planned.revision);
 const changed=planEventChangeReconfirmation(f.service,{
  kind:f.kind,supplierIds:[SUP],fingerprint:JSON.stringify(['new','change','date','time'])
 },now+1300);
 assert.equal(changed.reused,false);
 assert.notEqual(changed.revision,f.planned.revision);
 assert.equal(parseEventChangeReconfirmation(changed.value)?.eventServiceId,SID);
});
test('old durable initial assignment intents are atomically retired on reconfirmation',()=>{
 const f=context();
 f.previous.assignment_intent_mode='durable_v1';
 f.previous.assignment_intents_pending=true;
 f.previous.assignment_notification_intents=JSON.stringify([{
  key:'assignment:service-test-123:supplier-test-123:r3:SUPPLIER_NEW_ASSIGNMENT',
  supplier_id:SUP,revision:3,state:'accepted',created_at:'2026-10-29T10:00:00Z'
 },{
  key:'assignment:service-test-123:someone-else-123:r4:SUPPLIER_NEW_ASSIGNMENT',
  supplier_id:'someone-else-123',revision:4,state:'requested'
 }]);
 const retired=closeSupersededAssignmentIntents(f.previous,[SUP]);
 const entries=JSON.parse(retired.assignment_notification_intents);
 assert.equal(entries[0].state,'resolved');
 assert.equal(entries[1].state,'requested');
 assert.equal(retired.assignment_intents_pending,true);
 assert.deepEqual(closeSupersededAssignmentIntents({...f.previous,assignment_intent_mode:''},[SUP]),{});
});
test('transition WhatsApp key is stable per revision; cancels and unrelated sources are not actionable',async()=>{
 const f=context('arrival_notify');
 const job=await makeJob(f);
 assert.equal(isEventChangeReconfirmationOutbox(job),true);
 const checked=await checkEventChangeButtonCandidate(f.service,job);
 assert.equal(checked.allowed,true);
 assert.equal(checked.revision,f.planned.revision);
 assert.equal(eligibleEventChangeReconfirmation(f.service,job.source_type,SUP,f.planned.revision),true);
 const cancel={...job,idempotency_key:job.idempotency_key.replace('arrival_notify','arrival_cancel')};
 assert.equal(isEventChangeReconfirmationOutbox(cancel),false);
 assert.equal(isEventChangeReconfirmationOutbox({...job,source_type:'assignment_new'}),false);
 assert.equal((await checkEventChangeButtonCandidate(f.service,{...job,idempotency_key:'wrong-key'})).allowed,false);
 assert.equal((await checkEventChangeButtonCandidate({...f.service,supplier_arrival_time:'12:30'},job)).allowed,false);
 assert.equal(eligibleEventChangeReconfirmation({...f.service,
  supplier_statuses:JSON.stringify({[SUP]:'confirmed'})},job.source_type,SUP,f.planned.revision),false);
});
test('worker freezes changed labels; signed click can update only its matching service',async()=>{
 const f=context();
 const job=await makeJob(f);
 const {client,prepared}=await readyInteractive(f,job);
 const snapshot=JSON.parse(job.interactive_button_bindings_json);
 assert.deepEqual(snapshot.buttons.map(b=>b.label),['מאשר את השינוי','דוחה את השיבוץ']);
 assert.equal(prepared.preview.method,'sendInteractiveButtonsReply');
 assert.equal(prepared.preview.body.buttons.length,2);
 // Emulate Green acceptance, with no actual HTTP provider call.
 job.status='accepted';job.provider='green';
 job.provider_message_id='3EB0A5815E6EBF7DE71DE3';
 const click=parseGreenButtonSelection(greenClick(snapshot.buttons[0].buttonId),INSTANCE,now);
 assert.ok(click);
 const token=await resolveVerifiedGreenActionForButton(job,click,SIGN,webcrypto.subtle,now+1000);
 assert.ok(token);
 const admission=await preflightWhatsAppAssignmentResponse({
  ...click,headers:{Authorization:'Bearer '+WEBHOOK},
  webhookSecret:WEBHOOK,actionToken:token,actionSigningSecret:SIGN,
  expectedSenderAccountId:INSTANCE,now:now+1000,subtle:webcrypto.subtle
 },client.asServiceRole);
 assert.equal(admission.admissible,true);
 assert.equal(admission.sourceType,'assignment_update');
 const updated=await persistAuthorizedSupplierStatus(client.asServiceRole,{
  eventServiceId:SID,supplierId:SUP,newStatus:'confirmed',
  source:'whatsapp',expectedRevision:admission.receipt.revision,
  expectedSourceType:admission.sourceType
 });
 assert.equal(updated.kind,'changed');
 assert.equal(JSON.parse(f.service.supplier_statuses)[SUP],'confirmed');
 const second=await preflightWhatsAppAssignmentResponse({
  ...click,headers:{Authorization:'Bearer '+WEBHOOK},
  webhookSecret:WEBHOOK,actionToken:token,actionSigningSecret:SIGN,
  expectedSenderAccountId:INSTANCE,now:now+1000,subtle:webcrypto.subtle
 },client.asServiceRole);
 assert.equal(second.admissible,false);
});
test('changed event or stale marker refuses the old button rather than approving current service',async()=>{
 const f=context('arrival_notify');
 const job=await makeJob(f);
 const {client}=await readyInteractive(f,job);
 f.service.supplier_arrival_time='14:30';
 await assert.rejects(()=>persistAuthorizedSupplierStatus(client.asServiceRole,{
  eventServiceId:SID,supplierId:SUP,newStatus:'confirmed',
  source:'whatsapp',expectedRevision:f.planned.revision,
  expectedSourceType:'arrival_time_change'
 }),{code:'stale_reconfirmation'});
 assert.equal(JSON.parse(f.service.supplier_statuses)[SUP],'pending');
});
test('ordinary new assignments still use original independent producer',async()=>{
 const f=context();
 const job=await makeJob(f);
 const pre=await prepareGreenInteractiveWorkerCandidate(
  stubClient(f,job).client,{...job,source_type:'manual_other_type'},'green',
  {interactive_outbound_live_enabled:true},{
   enabled:true,accountCapabilityVerified:true,legacyProductionApproved:true,
   capability:'reply_only',senderAccountId:INSTANCE,signingSecret:SIGN,policy,now
  });
 assert.equal(pre.kind,'legacy');
});
