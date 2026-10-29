// Owner-on-demand, read-only result of the ONE pinned Green buttons pilot.
// No provider calls, message text, chat, phone, signed token or raw IDs leave
// this function. Never use as a reason to resend or mutate a test assignment.
const ID=/^[A-Za-z0-9_-]{8,128}$/;
const get=(env:(key:string)=>string|undefined,key:string)=>
 String(env(key)||'');
export function summarizeGreenButtonQaLiveResult(input:{
 service?:any; jobs:any[];receipts:any[];serviceId:string;supplierId:string;
 newSendsDisabled:boolean;incomingEnabled:boolean
}){
 const {service,jobs,receipts,serviceId,supplierId}=input;
 const assigned=(()=>{try{
  const ids=JSON.parse(service?.supplier_ids||'[]');
  return Array.isArray(ids)&&ids.length===1&&ids[0]===supplierId;
 }catch{return false;}})();
 const supplierConfirmed=(()=>{try{
  const statuses=JSON.parse(service?.supplier_statuses||'{}');
  return assigned&&statuses?.[supplierId]==='confirmed';
 }catch{return false;}})();
 let journal:any[]=[];
 try{journal=JSON.parse(service?.assignment_notification_intents||'[]');}
 catch{}
 const uniqueJob=jobs.length===1?jobs[0]:null;
 const uniqueReceipt=receipts.length===1?receipts[0]:null;
 const revision=Number(service?.assignment_intent_revision||0);
 const expectedKey='assignment:'+serviceId+':'+supplierId+
  ':r'+revision+':SUPPLIER_NEW_ASSIGNMENT';
 const journalVersionMatches=journal.length===1&&
  journal[0].key===expectedKey&&journal[0].revision===revision&&
  journal[0].supplier_id===supplierId&&
  journal[0].qa_buttons_required===true;
 const jobMatches=!!uniqueJob&&journalVersionMatches&&
  uniqueJob.idempotency_key===expectedKey&&
  uniqueJob.event_service_id===serviceId&&
  uniqueJob.supplier_id===supplierId&&
  uniqueJob.interactive_qa_required===true&&
  uniqueJob.requested_provider==='green'&&
  uniqueJob.provider==='green'&&
  uniqueJob.status==='accepted'&&
  uniqueJob.assignment_revision==='r'+revision&&
  !!uniqueJob.provider_message_id&&
  !!uniqueJob.interactive_button_bindings_json;
 const singleProviderAttempt=jobMatches&&
  Number(uniqueJob.attempt_count)===1;
 const receiptApplied=!!uniqueReceipt&&jobMatches&&
  uniqueReceipt.state==='applied'&&
  uniqueReceipt.result_code==='applied'&&
  uniqueReceipt.action==='assignment_approve'&&
  uniqueReceipt.provider==='green'&&
  uniqueReceipt.event_service_id===serviceId&&
  uniqueReceipt.supplier_id===supplierId&&
  uniqueReceipt.assignment_revision==='r'+revision&&
  uniqueReceipt.outbox_job_id===uniqueJob.id&&
  uniqueReceipt.provider_message_id===uniqueJob.provider_message_id;
 const safeNoDuplicates=jobs.length===1&&receipts.length===1;
 const complete=!!(service&&supplierConfirmed&&
  singleProviderAttempt&&receiptApplied&&safeNoDuplicates&&
  service.assignment_intents_pending!==true);
 return {
  status:complete?'confirmed_success':(jobs.length||receipts.length||
    journal.length||assigned)?'requires_review':'not_started',
  complete,originalMessageAccepted:!!jobMatches,
  singleProviderAttempt:!!singleProviderAttempt,
  signedApprovalReceiptApplied:!!receiptApplied,supplierConfirmed,
  sameAssignmentRevision:!!journalVersionMatches&&!!receiptApplied,
  uniqueOutboxAndReceipt:safeNoDuplicates,
  newSendsDisabled:input.newSendsDisabled,
  incomingRemainsEnabled:input.incomingEnabled,
  requestCounts:{eventService:1,outbox:1,receipt:1},
  noProviderCalls:true,noWrites:true,noMessagesSent:true,
  noPersonalDataReturned:true,rolloutOfOtherSuppliers:false
 };
}
export async function inspectGreenButtonQaLiveResult(client:any,
 env:(key:string)=>string|undefined){
 const serviceId=get(env,'GREEN_BUTTONS_QA_EVENT_SERVICE_ID');
 const supplierId=get(env,'GREEN_BUTTONS_QA_SUPPLIER_ID');
 if(!ID.test(serviceId)||!ID.test(supplierId))
  return {success:false,reason:'qa_scope_unconfigured',noProviderCalls:true,
   noWrites:true,noMessagesSent:true};
 const db=client?.asServiceRole?.entities;
 if(!db?.EventService?.get||!db?.WhatsAppOutbox?.filter||
  !db?.WhatsAppInboundReceipt?.filter)
  return {success:false,reason:'qa_result_storage_unavailable',
   noProviderCalls:true,noWrites:true,noMessagesSent:true};
 const [service,jobs,receipts]=await Promise.all([
  db.EventService.get(serviceId),
  db.WhatsAppOutbox.filter({event_service_id:serviceId,
   supplier_id:supplierId,source_type:'assignment_new'},
   '-created_date',3,0,['id','event_service_id','supplier_id',
   'idempotency_key','interactive_qa_required','requested_provider',
   'provider','provider_message_id','status','assignment_revision',
   'attempt_count','interactive_button_bindings_json']),
  db.WhatsAppInboundReceipt.filter({event_service_id:serviceId,
   supplier_id:supplierId},'-created_date',3,0,
   ['state','result_code','action','provider','event_service_id',
    'supplier_id','assignment_revision','outbox_job_id','provider_message_id'])
 ]);
 if(!service||service.id!==serviceId||!Array.isArray(jobs)||
  !Array.isArray(receipts))
  return {success:false,reason:'qa_result_unavailable',
   noProviderCalls:true,noWrites:true,noMessagesSent:true};
 return {success:true,result:summarizeGreenButtonQaLiveResult({
  service,jobs,receipts,serviceId,supplierId,
  newSendsDisabled:get(env,'GREEN_BUTTONS_QA_SEND_ENABLED')!=='enabled'&&
   get(env,'GREEN_BUTTONS_QA_CREATE_ENABLED')!=='enabled',
  incomingEnabled:get(env,'GREEN_BUTTONS_QA_INBOUND_ENABLED')==='enabled'
 })};
}
