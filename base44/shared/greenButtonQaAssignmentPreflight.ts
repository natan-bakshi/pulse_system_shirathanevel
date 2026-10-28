// Owner-click-only pilot assignment preflight: READ ONLY, scoped to a single
// event service, supplier and chat PINNED in server environment. Does not
// create a durable intent, change a supplier, fetch a Green API endpoint, or
// expose names, phone, chat, event IDs, message body or signed button tokens.
// This preflight is intentionally separate from normal dashboard/status loads.
import {readAssignmentIntents} from './assignmentIntent.ts';
import {parseWhatsAppPhone} from './whatsappPhone.ts';
const ENTITY=/^[A-Za-z0-9_-]{3,128}$/;
const CHAT=/^[1-9][0-9]{7,14}@c\.us$/;
const checklist=(code:string,ready:boolean)=>({code,ready});
function parseMembers(value:any){
 const list=typeof value==='string'?JSON.parse(value):value;
 if(!Array.isArray(list)||list.length>40||
  list.some(v=>typeof v!=='string'||!ENTITY.test(v)))throw Error('bad_members');
 return list;
}
function parseStatuses(value:any){
 const m=typeof value==='string'?JSON.parse(value):value;
 if(!m||typeof m!=='object'||Array.isArray(m))throw Error('bad_statuses');
 return m;
}
export async function inspectGreenButtonQaAssignmentReadOnly(client:any,opts:{
 eventServiceId?:string;supplierId?:string;chatId?:string
}){
 const serviceId=opts?.eventServiceId||'';
 const supplierId=opts?.supplierId||'';
 const chatId=opts?.chatId||'';
 const scoped=ENTITY.test(serviceId)&&ENTITY.test(supplierId)&&CHAT.test(chatId);
 const checks=[checklist('qa_exact_scope_configured',scoped)];
 if(!scoped)return {configured:false,ready:false,checks,
  databaseReads:0,noProviderRequests:true,noWrites:true,noMessageSends:true,
  noPersonalDataReturned:true};
 const db=client?.asServiceRole?.entities;
 if(!db?.EventService?.get||!db?.Supplier?.get||!db?.WhatsAppOutbox?.filter)
  throw Error('qa_preflight_unavailable');
 // Exactly two targeted entity GETs; not a scan. Only an explicit owner click.
 const [service,supplier]=await Promise.all([
  db.EventService.get(serviceId),db.Supplier.get(supplierId)
 ]);
 const found=!!service&&service.id===serviceId&&
  !!supplier&&supplier.id===supplierId;
 checks.push(checklist('qa_service_and_supplier_exist',found));
 if(!found)return {configured:true,ready:false,checks,
  databaseReads:2,noProviderRequests:true,noWrites:true,noMessageSends:true,
  noPersonalDataReturned:true};
 const external=service.is_external!==true;
 // A group-preferring supplier remains ordinary group traffic unless this
 // exact EventService contains the current durable QA intent. Only then can
 // the already-pinned private chat be reviewed for readiness.
 let markedPrivatePilot=false;
 try{
  markedPrivatePilot=service.assignment_intent_mode==='durable_v1'&&
   readAssignmentIntents(service.assignment_notification_intents||'[]').some(i=>
    i.supplier_id===supplierId&&i.qa_buttons_required===true&&
    i.key==='assignment:'+serviceId+':'+supplierId+':r'+i.revision+
     ':SUPPLIER_NEW_ASSIGNMENT');
 }catch{}
 const active=supplier.is_active!==false&&supplier.whatsapp_enabled!==false&&
  (supplier.preferred_channel!=='group'||markedPrivatePilot);
 let matched=false;
 try{matched=parseWhatsAppPhone(supplier.phone||'').chatId===chatId;}
 catch{}
 checks.push(checklist('qa_service_not_external',external));
 checks.push(checklist('qa_supplier_active_private_whatsapp',active));
 checks.push(checklist('qa_number_matches_supplier',matched));
 let assigned=false,pending=false,journalValid=false,versioned=false,
  eligibleIntent=false,key='';
 try{
  const ids=parseMembers(service.supplier_ids||'[]');
  const statuses=parseStatuses(service.supplier_statuses||'{}');
  assigned=ids.includes(supplierId);
  pending=assigned&&(statuses[supplierId]||'pending')==='pending';
  if(service.assignment_intent_mode==='durable_v1'){
   const all=readAssignmentIntents(service.assignment_notification_intents||'[]');
   journalValid=true;
   const intent=[...all].reverse().find(v=>v.supplier_id===supplierId);
   if(intent){
    versioned=intent.key==='assignment:'+serviceId+':'+supplierId+
      ':r'+intent.revision+':SUPPLIER_NEW_ASSIGNMENT';
    eligibleIntent=versioned&&intent.qa_buttons_required===true&&
      ['requested','queued','accepted'].includes(intent.state);
    if(eligibleIntent)key=intent.key;
   }
  }
 }catch{}
 checks.push(checklist('qa_supplier_assigned',assigned));
 checks.push(checklist('qa_supplier_status_pending',pending));
 checks.push(checklist('qa_durable_v2_intent_valid',
  journalValid&&versioned&&eligibleIntent));
 let matchingQueueCount=0,queuedUnsent=false,alreadyAttempted=false;
 if(external&&active&&matched&&assigned&&pending&&key){
  // One bounded exact-key lookup ONLY when prior checks pass.
  const jobs=await db.WhatsAppOutbox.filter({idempotency_key:key},
   '-created_date',2,0,['id','status','source_type','supplier_id',
    'event_service_id','chat_id','requested_provider','attempt_count',
    'provider_message_id','send_started_at','interactive_button_bindings_json',
    'interactive_qa_required']);
  matchingQueueCount=Array.isArray(jobs)?jobs.length:2;
  if(matchingQueueCount===1){
   const j=jobs[0];
   const match=j.source_type==='assignment_new'&&
    j.event_service_id===serviceId&&j.supplier_id===supplierId&&
    j.chat_id===chatId&&j.requested_provider==='green';
   // A plain unsent job under the same durable business key is NOT a safe
   // interactive pilot; the worker could otherwise send legacy text.
   queuedUnsent=match&&j.interactive_qa_required===true&&
    j.status==='queued'&&
    !Number(j.attempt_count||0)&&!j.send_started_at&&
    !j.provider_message_id&&!j.interactive_button_bindings_json;
   alreadyAttempted=match&&(['sending','accepted','unknown','failed',
    'retry_wait'].includes(j.status)||!!j.provider_message_id||
    !!j.send_started_at||Number(j.attempt_count||0)>0);
  }
 }
 checks.push(checklist('qa_single_fresh_queued_assignment',
  queuedUnsent&&matchingQueueCount===1));
 checks.push(checklist('qa_no_prior_transport_attempt',!alreadyAttempted));
 return {configured:true,ready:checks.every(c=>c.ready),
  checks,matchingQueueCount:matchingQueueCount>1?'ambiguous':
   matchingQueueCount===1?'one':'none',
  requiresNewDurableAssignment:!eligibleIntent,
  previouslyAttempted:alreadyAttempted,
  databaseReads:2+(key&&external&&active&&matched&&assigned&&pending?1:0),
  noProviderRequests:true,noWrites:true,noMessageSends:true,
  noPersonalDataReturned:true};
}
