import test from 'node:test';
import assert from 'node:assert/strict';
import {assignmentWhatsAppKey,assignmentWhatsAppContext,canonicalAssignmentUpdatedDate} from '../base44/shared/assignmentWhatsApp.ts';
import {sendWhatsAppToChat} from '../base44/shared/whatsappSend.ts';

// Data-derived regression: TWO different Green API message IDs were accepted
// for the SAME supplier and EventService during a single save. The entity
// trigger saw microseconds (.719051); the frontend safeguard read the same
// DB version with milliseconds padded to six digits (.719000).
const workflowVersion='2026-10-18T10:22:19.719051';
const safeguardVersion='2026-10-18T10:22:19.719000';
const serviceId='service-qa123',supplierId='supplier-qa123';
const svc=(updated_date)=>({id:serviceId,updated_date});

test('verified production microsecond/millisecond mismatch collapses to ONE stable key',()=>{
 const rawA=['assignment',serviceId,supplierId,workflowVersion,'SUPPLIER_NEW_ASSIGNMENT'].join(':');
 const rawB=['assignment',serviceId,supplierId,safeguardVersion,'SUPPLIER_NEW_ASSIGNMENT'].join(':');
 assert.notEqual(rawA,rawB,'Original raw key correctly reproduces duplicate incident');
 assert.equal(canonicalAssignmentUpdatedDate(workflowVersion),safeguardVersion);
 assert.equal(canonicalAssignmentUpdatedDate(safeguardVersion),safeguardVersion);
 const a=assignmentWhatsAppKey(svc(workflowVersion),supplierId);
 const b=assignmentWhatsAppKey(svc(safeguardVersion),supplierId);
 assert.equal(a,b,'Entity trigger and explicit on-save guard MUST use same key');
 assert.equal(a,rawB,'Existing .719000 Outbox job remains idempotently addressable');
});
test('UTC offset / Z / naive representation cannot split the same single assignment revision',()=>{
 const expected=assignmentWhatsAppKey(svc(safeguardVersion),supplierId);
 for(const variant of [
  workflowVersion+'Z',safeguardVersion+'Z','2026-10-18T13:22:19.719051+03:00',
  '2026-10-18T10:22:19.719051123Z','2026-10-18T10:22:19.719Z'
 ])assert.equal(assignmentWhatsAppKey(svc(variant),supplierId),expected,variant);
 assert.notEqual(assignmentWhatsAppKey(svc('2026-10-18T10:22:19.720000'),supplierId),expected,
   'A later millisecond remains a distinct business save');
 assert.notEqual(assignmentWhatsAppKey(svc(workflowVersion),'supplier-other'),expected);
});
test('legacy durable_v1 stored revision remains the sole key independent of timestamps',()=>{
 const service={...svc(workflowVersion),assignment_intent_mode:'durable_v1',
   assignment_notification_intents:JSON.stringify([{
    key:'assignment:service-qa123:supplier-qa123:r3:SUPPLIER_NEW_ASSIGNMENT',
    supplier_id:supplierId,revision:3,state:'requested'
   }])};
 assert.equal(assignmentWhatsAppKey(service,supplierId),
   'assignment:service-qa123:supplier-qa123:r3:SUPPLIER_NEW_ASSIGNMENT');
});
test('two concurrent creators from the REAL shared queue result in one persisted Outbox job and no provider calls',async()=>{
 let next=0;const jobs=[];
 const control={id:'control-qa',control_key:'global',enabled:true,paused:false,
   enqueue_owner:'',enqueue_until:''};
 const match=(obj,q)=>Object.entries(q).every(([k,v])=>obj[k]===v);
 const db={
  WhatsAppQueueControl:{
   filter:async()=>[{...control}],
   updateMany:async(query,patch)=>{
     if(!match(control,query))return {updated:0};
     Object.assign(control,patch.$set);return {updated:1};
   }
  },
  WhatsAppOutbox:{
   filter:async q=>jobs.filter(j=>match(j,q)),
   create:async data=>{const job={id:'outbox-'+(++next),...data};jobs.push(job);return job;}
  },
  AppSettings:{filter:async()=>[{setting_value:'green'}]}
 };
 const client={asServiceRole:{entities:db}};
 const oldDeno=globalThis.Deno;
 globalThis.Deno={env:{get:()=>''}};
 try{
  const body='Supplier assignment — synthetic test, no provider sends';
  const target='972501234567@c.us';
  const [first,second]=await Promise.all([
    sendWhatsAppToChat(target,body,client,assignmentWhatsAppContext(svc(workflowVersion),supplierId)),
    sendWhatsAppToChat(target,body,{...client},assignmentWhatsAppContext(svc(safeguardVersion),supplierId))
  ]);
  assert.equal(jobs.length,1,'A duplicate UI-trigger race MUST NOT create a second job');
  assert.equal(first.jobId,second.jobId);
  assert.equal(new Set([first.deduplicated,second.deduplicated]).size,2);
  assert.equal(jobs[0].idempotency_key,assignmentWhatsAppKey(svc(workflowVersion),supplierId));
  assert.equal(jobs[0].source_type,'assignment_new');
  assert.equal(jobs[0].status,'queued');
 }finally{if(oldDeno===undefined)delete globalThis.Deno;else globalThis.Deno=oldDeno;}
});
