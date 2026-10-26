// Owner-only, explicitly on-demand OFFICE reference lookup. This module
// MUST be called only after WhatsAppQueueAdmin's system-owner auth.
// The reference is an Outbox job ID already embedded in an optional wa.me
// message draft, NOT a bearer token, external authorization or proof that
// the provider delivered the message.
// Exactly ONE Outbox GET + at most 3 bounded related GETs per operator click;
// never lists messages, reveals sender chats, signed actions, raw message bodies,
// provider receipts, phone numbers, payment details, or any secret.
// No supplier status mutation or outbound provider call.
import {readAssignmentIntents} from './assignmentIntent.ts';
import {supplierAssigned} from './whatsappSupplierTransition.ts';

const REF=/^[A-Za-z0-9_-]{3,128}$/;
const SAFE_STATUS=new Set(['queued','retry_wait','sending','accepted','unknown',
 'failed','cancelled','expired','resolved']);
const SAFE_SUPPLIER_STATUS=new Set(['pending','confirmed','rejected']);
const SAFE_PROVIDER=new Set(['green','wasender']);
const SAFE_DATE=/^\d{4}-\d{2}-\d{2}$/;
const error=(code:string,status:number)=>Object.assign(new Error(code),{code,status});
const clean=(value:any,max=100)=>typeof value==='string'
 ?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max):'';
export function summarizeOfficeAssignmentReference(job:any,service:any,event:any,supplier:any){
 if(!job||!REF.test(job.id||'')||job.source_type!=='assignment_new')
  throw error('office_reference_not_found',404);
 const serviceMatches=!!service&&service.id===job.event_service_id;
 const supplierMatches=!!supplier&&supplier.id===job.supplier_id;
 const isAssigned=serviceMatches&&supplierAssigned(service.supplier_ids,job.supplier_id);
 let supplierStatus='unknown',originState='legacy_unverified';
 if(!serviceMatches)originState='service_not_found';
 else if(!isAssigned)originState='supplier_no_longer_assigned';
 else if(service.assignment_intent_mode==='durable_v1'){
  try{
   const intents=readAssignmentIntents(service.assignment_notification_intents||'[]');
   const latest=[...intents].reverse().find(i=>i.supplier_id===job.supplier_id);
   if(!latest)originState='no_supplier_intent';
   else {
    const revision='r'+latest.revision;
    originState=latest.key===job.idempotency_key&&
      (!job.assignment_revision||job.assignment_revision===revision)
      ?'current_revision':'superseded_revision';
   }
  }catch{originState='corrupt_intent_history';}
 }
 if(serviceMatches){
  try{
   const raw=typeof service.supplier_statuses==='string'
    ?JSON.parse(service.supplier_statuses||'{}'):service.supplier_statuses;
   const value=raw&&!Array.isArray(raw)&&typeof raw==='object'
    ?raw[job.supplier_id]:undefined;
   supplierStatus=SAFE_SUPPLIER_STATUS.has(value)?value:'unknown';
  }catch{supplierStatus='unavailable';}
 }
 const eventMatches=!!event&&!!serviceMatches&&event.id===service.event_id;
 const provider=SAFE_PROVIDER.has(job.provider)?job.provider:
  SAFE_PROVIDER.has(job.requested_provider)?job.requested_provider:'unknown';
 return {
  reference:job.id,
  messageStatus:SAFE_STATUS.has(job.status)?job.status:'unknown',
  provider,
  providerReceiptPresent:!!job.provider_message_id,
  providerReceiptIsNotDeliveryProof:true,
  serviceName:serviceMatches?clean(service.service_name,120):'',
  supplierName:supplierMatches?clean(supplier.supplier_name,100):'',
  eventName:eventMatches?clean(event.event_name,120):'',
  eventDate:eventMatches&&SAFE_DATE.test(event.event_date||'')
   ?event.event_date:'',
  supplierStatus,originState,
  currentRevisionVerified:originState==='current_revision',
  referenceOnlyNotAuthorization:true,
  statusDoesNotProveButtonClick:true,
  readOnly:true,noMessagesSent:true,noBusinessWrites:true
 };
}
export async function inspectOfficeAssignmentReference(client:any,reference:string){
 if(typeof reference!=='string'||!REF.test(reference))
  throw error('invalid_office_reference',400);
 const db=client?.asServiceRole?.entities;
 if(!db?.WhatsAppOutbox?.get||!db?.EventService?.get||
  !db?.Supplier?.get||!db?.Event?.get)
  throw error('office_reference_unavailable',503);
 let job:any;
 try{job=await db.WhatsAppOutbox.get(reference);}
 catch{throw error('office_reference_unavailable',503);}
 // Do NOT read unrelated customer/financial entities on invalid/non-assignment ID.
 if(!job||job.id!==reference||job.source_type!=='assignment_new')
  throw error('office_reference_not_found',404);
 if(!REF.test(job.event_service_id||'')||!REF.test(job.supplier_id||''))
  throw error('office_origin_invalid',409);
 let service:any,supplier:any,event:any=null;
 try{
  [service,supplier]=await Promise.all([
   db.EventService.get(job.event_service_id),db.Supplier.get(job.supplier_id)
  ]);
  if(service?.id===job.event_service_id&&REF.test(service.event_id||''))
   event=await db.Event.get(service.event_id);
 }catch{throw error('office_reference_unavailable',503);}
 return summarizeOfficeAssignmentReference(job,service,event,supplier);
}
