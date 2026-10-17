import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';
import {planAssignmentTransition} from '../base44/shared/assignmentIntent.ts';
import {reconcileOutboxIntentStatus,processSupplierAssignmentIntents,sweepPendingSupplierAssignmentIntents} from '../base44/shared/assignmentIntentReconciler.ts';
import {assignmentWhatsAppKey,assignmentWhatsAppContext} from '../base44/shared/assignmentWhatsApp.ts';

const svcId='service-aaa123',supplier1='supplier-aaa123',supplier2='supplier-bbb234';
function scenario({enabled=true,newSuppliers=[supplier1],supplier={},statuses={},eventStatus='confirmed',existingOutbox=[]}={}){
 const original={id:svcId,event_id:'event-aaa123',service_id:'catalog-aaa123',
  supplier_ids:'[]',supplier_statuses:'{}',supplier_notes:'{}',
  updated_date:'2026-10-17T15:00:00Z'};
 const next=planAssignmentTransition(original,{
  supplierIds:newSuppliers,supplierStatuses:Object.fromEntries(newSuppliers.map(id=>[id,statuses[id]||'pending'])),
  supplierNotes:Object.fromEntries(newSuppliers.map(id=>[id,'']))
 },'2026-10-17T15:01:00Z');
 const service={...original,...next.patch,updated_date:'2026-10-17T15:01:00Z'};
 let writes=0,serviceReads=0,contacts=0,templateQueries=0;
 const jobs=[...existingOutbox];
 const db={
   AppSettings:{filter:async()=>enabled?[{setting_value:'true'}]:[]},
   EventService:{get:async()=>{serviceReads++;return {...service}},
     updateMany:async(filter,update)=>{
       if(filter.id!==svcId||filter.assignment_notification_intents!==service.assignment_notification_intents)return {updated:0};
       Object.assign(service,update.$set);writes++;return {updated:1};
     }},
   Event:{get:async()=>({id:'event-aaa123',status:eventStatus,event_name:'Family Test',
     event_date:'2026-12-10',event_time:'10:00',location:'Jerusalem'})},
   Supplier:{get:async id=>{contacts++;return {
     id,supplier_name:'Supplier',contact_person:'Supplier',phone:'0501234567',
     whatsapp_enabled:true,preferred_channel:'phone',...supplier
   }}},
   Service:{get:async()=>({service_name:'Music'})},
   NotificationTemplate:{filter:async()=>{
     templateQueries++;return [{type:'SUPPLIER_NEW_ASSIGNMENT',is_active:true,allowed_channels:['whatsapp'],
       whatsapp_body_template:'Hello {{supplier_name}} — {{service_name}}'}]}},
   WhatsAppOutbox:{filter:async(q)=>jobs.filter(j=>j.idempotency_key===q.idempotency_key)},
   WhatsAppQueueControl:{filter:async()=>[{id:'q',enabled:true,paused:false}]}
 };
 const client={asServiceRole:{entities:db}};
 const enqueue=async(chatId,body,_client,context)=>{
   const existing=jobs.find(j=>j.idempotency_key===context.idempotencyKey);
   if(existing) return {queued:existing.status==='queued',status:existing.status,
     jobId:existing.id,deduplicated:true};
   const job={id:'job-'+(jobs.length+1),idempotency_key:context.idempotencyKey,
     status:'queued',chat_id:chatId,message_text:body};
   jobs.push(job);
   return {queued:true,status:'queued',jobId:job.id};
 };
 return {client,service,jobs,next,enqueue,get writes(){return writes},
   get serviceReads(){return serviceReads},get contacts(){return contacts},
   get templateQueries(){return templateQueries}};
}
test('existing five-minute watchdog skips any EventService scan while V2 is OFF',async()=>{
 let scanned=0;
 const client={asServiceRole:{entities:{
   AppSettings:{filter:async()=>[]},
   EventService:{filter:async()=>{scanned++;throw Error('Feature OFF may not scan services')}}
 }}};
 const result=await sweepPendingSupplierAssignmentIntents(client);
 assert.equal(result.reason,'feature_disabled');
 assert.equal(result.scanned,0);
 assert.equal(scanned,0);
});
test('watchdog scans only flagged pending services with bounded work and no new schedules',async()=>{
 const ids=['svc-aa1','svc-bb2','svc-cc3'];
 const visits=[];
 const client={asServiceRole:{entities:{
   AppSettings:{filter:async()=>[{setting_value:'true'}]},
   EventService:{filter:async(q,sort,limit)=>{
     assert.equal(q.assignment_intents_pending,true);
     assert.equal(sort,'updated_date');assert.equal(limit,2);
     return ids.slice(0,limit).map(id=>({id}));
   }}
 }}};
 const r=await sweepPendingSupplierAssignmentIntents(client,{
   maxServices:2,reconcile:async(_,id,opts)=>{
     visits.push(id);assert.equal(opts.limit,4);return {success:true,processed:1};
   }
 });
 assert.equal(r.scanned,2);assert.equal(r.recovered,2);
 assert.deepEqual(visits,ids.slice(0,2));
});
test('feature OFF: no service scan, no enqueue, no database writes',async()=>{
 const x=scenario({enabled:false});
 const r=await processSupplierAssignmentIntents(x.client,svcId,{enqueue:x.enqueue});
 assert.equal(r.reason,'feature_disabled');
 assert.equal(x.serviceReads,0);assert.equal(x.writes,0);assert.equal(x.jobs.length,0);
});
test('reconciler enqueues one message with the durable key and then idles',async()=>{
 const x=scenario();
 const planned=x.next.intents[0].key;
 assert.equal(assignmentWhatsAppKey(x.service,supplier1),planned,
   'Trigger and recovery use the same durable idempotency key');
 const result=await processSupplierAssignmentIntents(x.client,svcId,{enqueue:x.enqueue});
 assert.equal(result.processed,1);assert.equal(result.queued,1);
 assert.equal(x.jobs.length,1);
 assert.equal(x.jobs[0].idempotency_key,planned);
 assert.equal(x.service.assignment_intents_pending,false);
 const states=JSON.parse(x.service.assignment_notification_intents);
 assert.equal(states[0].state,'queued');
 assert.equal(states[0].outbox_id,'job-1');
 assert.equal(assignmentWhatsAppKey(x.service,supplier1),planned,'Key remains stable after state update');
 const again=await processSupplierAssignmentIntents(x.client,svcId,{enqueue:x.enqueue});
 assert.equal(again.reason,'nothing_pending');
 assert.equal(x.jobs.length,1);
});
test('a post-create exception is recovered by querying Outbox BEFORE any repeat enqueue',async()=>{
 const x=scenario();let calls=0;
 const throwsAfterCommit=async(...args)=>{
   calls++;await x.enqueue(...args);
   throw Error('Simulated crash after DB insert before receipt returned');
 };
 const a=await processSupplierAssignmentIntents(x.client,svcId,{enqueue:throwsAfterCommit});
 assert.equal(a.reason,'needs_review');assert.equal(x.jobs.length,1);
 assert.equal(x.service.assignment_intents_pending,true);
 const b=await processSupplierAssignmentIntents(x.client,svcId,{enqueue:throwsAfterCommit});
 assert.equal(b.queued,1);assert.equal(b.success,true);
 assert.equal(x.jobs.length,1);assert.equal(calls,1,'Second run must NOT call enqueue again');
});
test('provider ACCEPTED remains accepted even after supplier confirmed and before intent sync',async()=>{
 const x=scenario();
 x.jobs.push({id:'accepted-job',status:'accepted',idempotency_key:x.next.intents[0].key});
 x.service.supplier_statuses=JSON.stringify({[supplier1]:'confirmed'});
 const r=await processSupplierAssignmentIntents(x.client,svcId,{enqueue:()=>{throw Error('No sends')}});
 assert.equal(r.alreadyAccepted,1);
 assert.equal(r.cancelled,0);
 assert.equal(JSON.parse(x.service.assignment_notification_intents)[0].state,'accepted');
 assert.equal(x.jobs.length,1);
});
test('provider UNKNOWN stays uncertain even when supplier was later removed',async()=>{
 const x=scenario();
 x.jobs.push({id:'unknown-job',status:'unknown',idempotency_key:x.next.intents[0].key});
 x.service.supplier_ids='[]';
 const r=await processSupplierAssignmentIntents(x.client,svcId,{enqueue:()=>{throw Error('No sends')}});
 assert.equal(r.unknown,1);
 assert.equal(r.cancelled,0);
 assert.equal(JSON.parse(x.service.assignment_notification_intents)[0].state,'unknown');
});
test('existing UNKNOWN is never re-enqueued and never mislabeled accepted',async()=>{
 const x=scenario();
 x.jobs.push({id:'unknown-job',status:'unknown',idempotency_key:x.next.intents[0].key});
 const rejectAnySend=()=>{throw Error('Must never enqueue an uncertain prior message')};
 const result=await processSupplierAssignmentIntents(x.client,svcId,{enqueue:rejectAnySend});
 assert.equal(result.unknown,1);
 assert.equal(JSON.parse(x.service.assignment_notification_intents)[0].state,'unknown');
 assert.equal(x.jobs.length,1);
 assert.equal(x.service.assignment_intents_pending,false);
});
test('supplier already confirmed or removed cancels old requests before dispatch',async()=>{
 const a=scenario({statuses:{[supplier1]:'pending'}});
 a.service.supplier_statuses=JSON.stringify({[supplier1]:'confirmed'});
 const r=await processSupplierAssignmentIntents(a.client,svcId,{enqueue:()=>{throw Error('Should not dispatch')}});
 assert.equal(r.cancelled,1);assert.equal(a.jobs.length,0);
 const b=scenario();
 b.service.supplier_ids='[]';
 const r2=await processSupplierAssignmentIntents(b.client,svcId,{enqueue:()=>{throw Error('Should not dispatch')}});
 assert.equal(r2.cancelled,1);assert.equal(b.jobs.length,0);
});
test('invalid configured group NEVER falls back to the private phone number',async()=>{
 const x=scenario({supplier:{preferred_channel:'group',whatsapp_group_url:'not-a-group-link'}});
 const r=await processSupplierAssignmentIntents(x.client,svcId,{enqueue:()=>{throw Error('No sends')}});
 assert.equal(r.blocked,1);
 assert.equal(x.jobs.length,0);
 assert.equal(x.service.assignment_intents_pending,true);
});
test('concurrent recons still yield only one Outbox row and CAS prevents journal overwrite',async()=>{
 const x=scenario();
 const [a,b]=await Promise.all([
  processSupplierAssignmentIntents(x.client,svcId,{enqueue:x.enqueue}),
  processSupplierAssignmentIntents(x.client,svcId,{enqueue:x.enqueue})
 ]);
 assert.equal(x.jobs.length,1);
 assert.equal(x.writes,1);
 assert.ok([a.reason,b.reason].includes('changed_concurrently')||
   [a.reason,b.reason].includes('nothing_pending'));
});
test('two supplier requests are handled in bounded batches without losing later intents',async()=>{
 const x=scenario({newSuppliers:[supplier1,supplier2]});
 const a=await processSupplierAssignmentIntents(x.client,svcId,{enqueue:x.enqueue,limit:1});
 assert.equal(a.processed,1);assert.equal(a.remaining,true);
 assert.equal(x.jobs.length,1);
 const b=await processSupplierAssignmentIntents(x.client,svcId,{enqueue:x.enqueue,limit:1});
 assert.equal(b.processed,1);assert.equal(b.remaining,false);
 assert.equal(x.jobs.length,2);
 assert.equal(x.service.assignment_intents_pending,false);
});
test('Outbox states are not silently changed into delivery receipts',()=>{
 assert.equal(reconcileOutboxIntentStatus('accepted'),'accepted');
 assert.equal(reconcileOutboxIntentStatus('sending'),'queued');
 assert.equal(reconcileOutboxIntentStatus('unknown'),'unknown');
 assert.equal(reconcileOutboxIntentStatus('failed'),'failed_definite');
 assert.equal(reconcileOutboxIntentStatus('succeeded-no-proof'),'');
});
test('workflow is scoped to assignment intent journal changes only',()=>{
 const wf=JSON.parse(fs.readFileSync('base44/workflows/Assignment Intent Reconcile On Change.jsonc','utf8'));
 assert.equal(wf.trigger.config.entity_name,'EventService');
 assert.deepEqual(wf.trigger.config.events,['update']);
 assert.ok(wf.trigger.condition.includes('assignment_notification_intents'));
 const src=fs.readFileSync('base44/functions/reconcileSupplierAssignmentIntents/entry.ts','utf8');
 const cjs=esbuild.transformSync(src,{loader:'ts',format:'cjs',target:'es2022'}).code;
 const responses=[];
 for(const role of ['supplier','admin']){
   let handler;
   const client={auth:{me:async()=>({role})}};
   const m={exports:{}};
   vm.runInNewContext(cjs,{
     module:m,exports:m.exports,
     Deno:{serve:fn=>handler=fn},console:{error:()=>{}},
     Response:{json:(data,{status=200}={})=>({data,status})},
     require:name=>{
       if(name.startsWith('npm:@base44/sdk'))return {createClientFromRequest:()=>client};
       if(name.endsWith('assignmentIntentReconciler.ts'))return {processSupplierAssignmentIntents:async()=>({success:false,reason:'feature_disabled'})};
       throw Error('Unexpected module');
     }
   });
   responses.push(handler({method:'POST',json:async()=>({eventServiceId:svcId})}));
 }
 return Promise.all(responses).then(async results=>{
   const a=await results[0],b=await results[1];
   assert.equal(a.status,403);
   assert.equal(b.status,423);
 });
});
