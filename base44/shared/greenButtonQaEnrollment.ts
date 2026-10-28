// Manual owner-only, EXACT ONE test assignment enrollment for the QA button
// pilot. No direct WhatsApp/provider operation here. The existing durable
// assignment intent and Outbox workflows are the ONLY delivery route.
// Requires separately approved test event/service/supplier/chat values in
// server settings plus an extra one-shot creation gate, all DEFAULT OFF.
// One already-assigned or previously-notified supplier cannot be re-enrolled.
// The calling HTTP function must authenticate SYSTEM OWNER before this helper.
import {readWhatsAppQueueControl} from './whatsappOutbox.ts';
import {trustedGreenButtonQaConfig} from './greenButtonQaLaunch.ts';
import {planAssignmentTransition,readAssignmentIntents} from './assignmentIntent.ts';
import {parseWhatsAppPhone} from './whatsappPhone.ts';

const ID=/^[A-Za-z0-9_-]{3,128}$/;
const fail=(code:string,status=409)=>Object.assign(new Error(code),{code,status});
export async function enrollOneGreenButtonQaAssignment(client:any,opts:{
 env:(key:string)=>string|undefined;confirmation:string
}){
 if(opts?.confirmation!=='I_APPROVE_ONE_QA_ASSIGNMENT'||
  opts.env('GREEN_BUTTONS_QA_CREATE_ENABLED')!=='enabled')
  throw fail('qa_enrollment_not_approved',403);
 const db=client?.asServiceRole?.entities;
 if(!db?.AppSettings?.filter||!db?.EventService?.get||
  !db?.EventService?.filter||!db?.EventService?.updateMany||
  !db?.EventService?.update||
  !db?.Supplier?.get||!db?.Event?.get||!db?.WhatsAppOutbox?.filter)
  throw fail('qa_enrollment_storage_unavailable',503);
 // Gate reads: only explicit owner action, never dashboard or worker run.
 const [control,flags]=await Promise.all([
  readWhatsAppQueueControl(client),
  db.AppSettings.filter({setting_key:'assignment_intent_v1_enabled'},
   '-created_date',2)
 ]);
 const durable=flags.length===1&&flags[0].setting_value==='true';
 const config=trustedGreenButtonQaConfig(control,opts.env,durable);
 const eventId=String(opts.env('GREEN_BUTTONS_QA_EVENT_ID')||'');
 if(!config||!ID.test(eventId)||control.enabled!==true||
  control.paused===true||control.inbound_guard_key||control.unknown_guard_key)
  throw fail('qa_enrollment_unavailable',423);
 const [service,supplier,event]=await Promise.all([
  db.EventService.get(config.qaEventServiceId),
  db.Supplier.get(config.qaSupplierId),
  db.Event.get(eventId)
 ]);
 if(!service||service.id!==config.qaEventServiceId||
  service.event_id!==eventId||service.is_external===true||
  !event||event.id!==eventId||
  ['cancelled','completed'].includes(event.status)||
  !supplier||supplier.id!==config.qaSupplierId||
  supplier.whatsapp_enabled===false||supplier.is_active===false||
  supplier.preferred_channel==='group'||
  parseWhatsAppPhone(supplier.phone||'').chatId!==config.qaChatId)
  throw fail('qa_enrollment_target_mismatch',409);
 if(typeof service.updated_date!=='string'||
  !Number.isFinite(Date.parse(service.updated_date)))
  throw fail('qa_enrollment_version_missing',409);
 // Do not touch ANY current supplier assignment, status or note.
 let ids:any[],statuses:any,notes:any;
 try{
  ids=JSON.parse(service.supplier_ids||'[]');
  statuses=JSON.parse(service.supplier_statuses||'{}');
  notes=JSON.parse(service.supplier_notes||'{}');
 }catch{throw fail('qa_enrollment_existing_data_invalid',409);}
 if(!Array.isArray(ids)||ids.length>39||ids.includes(config.qaSupplierId)||
  !statuses||Array.isArray(statuses)||typeof statuses!=='object'||
  !notes||Array.isArray(notes)||typeof notes!=='object')
  throw fail('qa_supplier_already_assigned_or_invalid',409);
 // A previously requested assignment might have been resolved WITHOUT an
 // Outbox (e.g. disabled template). It is still a previous business intent;
 // re-enrolling would violate the one-shot QA scope despite no send history.
 let previousIntents:any[];
 try{previousIntents=readAssignmentIntents(
  service.assignment_notification_intents||'[]');}
 catch{throw fail('qa_intent_history_corrupt',409);}
 if(previousIntents.some(entry=>entry.supplier_id===config.qaSupplierId))
  throw fail('qa_previous_assignment_intent_requires_review',409);
 // Even if the assignment was removed and added again, do not create another
 // outward notification during a QA pilot: test with a FRESH service.
 const previous=await db.WhatsAppOutbox.filter({
  source_type:'assignment_new',event_service_id:service.id,
  supplier_id:supplier.id
 },'-created_date',2,0,['id','status']);
 if(!Array.isArray(previous)||previous.length!==0)
  throw fail('qa_previous_assignment_history_requires_review',409);
 // Global V2 feature flag can drain ALL historical pending intents; prohibit
 // a one-supplier pilot while ANY unrelated unsent V2 work is queued. This is
 // one bounded lookup on explicit owner enrollment, never on normal sends.
 const otherPending=await db.EventService.filter({
  assignment_intents_pending:true
 },'updated_date',2,0,['id']);
 if(!Array.isArray(otherPending)||otherPending.length!==0)
  throw fail('qa_other_v2_intents_pending_global_risk',409);
 const nextIds=[...ids,config.qaSupplierId];
 const nextStatuses={...statuses,[config.qaSupplierId]:'pending'};
 const plan=planAssignmentTransition(service,{
  supplierIds:nextIds,supplierStatuses:nextStatuses,supplierNotes:notes
 },new Date().toISOString());
 if(plan.intents.length!==1||
  plan.intents[0].supplier_id!==config.qaSupplierId||
  !plan.hasNewIntent)throw fail('qa_assignment_plan_invalid',409);
 // Persist the pilot requirement IN THE SAME BUSINESS CAS as the assignment.
 // This survives send-disable and a lost workflow wake, even before signing.
 plan.intents[0].qa_buttons_required=true;
 plan.patch.assignment_notification_intents=JSON.stringify([...previousIntents,...plan.intents]);
 // Atomic assignment change + durable intent, one CAS only. Ambiguous commit
 // is NOT retried; existing watchdog can rescue a genuinely saved intent.
 let updated:any;
 try{
  updated=await db.EventService.updateMany({
   id:service.id,updated_date:service.updated_date,
   supplier_ids:service.supplier_ids,
   supplier_statuses:service.supplier_statuses
  },{$set:plan.patch});
 }catch{throw fail('qa_enrollment_commit_uncertain_review',503);}
 if(updated?.updated!==1)throw fail('qa_enrollment_concurrent_or_uncertain',409);
 let wakeRequested=false;
 try{
  await db.EventService.update(service.id,{
   assignment_intent_wake_at:new Date().toISOString()
  });
  wakeRequested=true;
 }catch{
  // A successfully saved intent must never be rolled back or re-created
  // merely because the trigger wake failed. Existing watchdog recovers it.
 }
 return {
  saved:true,notificationIntentPersisted:true,wakeRequested,
  watchdogFallbackRequired:!wakeRequested,
  queueMaySendWhatsAppAutomatically:true,
  targetLimitedToOneSupplier:true,
  noDirectProviderCalls:true,
  oneConfirmedAssignmentCAS:true,
  noPersonalDataReturned:true
 };
}
