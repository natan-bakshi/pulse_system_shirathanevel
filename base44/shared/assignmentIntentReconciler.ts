import { readAssignmentIntents, ASSIGNMENT_INTENT_MODE } from './assignmentIntent.ts';
import { renderAssignmentWhatsApp, supplierTargetChatId } from './assignmentWhatsApp.ts';
import { sendWhatsAppToChat, toChatId } from './whatsappSend.ts';
import { resolveNotificationDelay } from './quietHours.ts';
import { readWhatsAppQueueControl } from './whatsappOutbox.ts';

// Runs only when explicitly invoked by an authorized backend function.
// The feature flag is OFF unless exactly one AppSettings row says "true".
// All outgoing messages are enqueued through the existing central Outbox,
// pinned to the key persisted with the original EventService business save.
const FLAG='assignment_intent_v1_enabled';
const LIMIT=8;
const finalStates=new Set(['queued','accepted','unknown','failed_definite','cancelled','resolved']);


// Reuse the EXISTING 5-minute WhatsApp crash watchdog as the low-frequency
// fallback if the initial intent-trigger workflow was unavailable. No new
// periodic automation. OFF flag performs only one settings read, no service scan.
export async function sweepPendingSupplierAssignmentIntents(client:any,opts:any={}){
  const db=client?.asServiceRole?.entities;
  if(!db)throw new Error('Backend service client required');
  const flag=await db.AppSettings.filter({setting_key:FLAG},'-created_date',2);
  if(flag.length!==1||flag[0].setting_value!=='true')
    return {success:true,reason:'feature_disabled',scanned:0};
  const limit=Number.isInteger(opts.maxServices)&&opts.maxServices>0?
    Math.min(opts.maxServices,4):4;
  const due=await db.EventService.filter({assignment_intents_pending:true},'updated_date',limit);
  let scanned=0,recovered=0,blocked=0;
  for(const svc of due){
    scanned++;
    try{
      const result=await (opts.reconcile||processSupplierAssignmentIntents)(
        client,svc.id,{limit:4}
      );
      recovered+=Number(result.processed||0);
      if(result.success===false)blocked++;
    }catch(error){
      blocked++;
      console.error('[AssignmentIntent] watchdog reconciliation failed',error instanceof Error?error.name:'unknown');
    }
  }
  return {success:blocked===0,reason:blocked?'needs_review':'reconciled',scanned,recovered,blocked};
}

export function reconcileOutboxIntentStatus(status:string){
  if(['queued','sending','retry_wait'].includes(status))return 'queued';
  if(status==='accepted')return 'accepted'; // Provider acceptance, NOT recipient delivery.
  if(status==='unknown')return 'unknown';   // NEVER blindly resend.
  if(status==='failed')return 'failed_definite';
  if(status==='cancelled'||status==='expired')return 'cancelled';
  if(status==='resolved')return 'resolved';
  return ''; // Unknown status is NOT proof of non-delivery.
}
export async function processSupplierAssignmentIntents(client:any,serviceId:string,options:any={}){
  const db=client?.asServiceRole?.entities;
  if(!db)throw new Error('Service-role backend client required');
  const flag=await db.AppSettings.filter({setting_key:FLAG},'-created_date',2);
  if(flag.length!==1||flag[0].setting_value!=='true')
    return {success:false,reason:'feature_disabled',processed:0};
  if(!/^[a-zA-Z0-9_-]{3,100}$/.test(serviceId))
    throw new Error('Invalid EventService identifier');
  const service=await db.EventService.get(serviceId).catch(()=>null);
  if(!service || service.assignment_intent_mode!==ASSIGNMENT_INTENT_MODE ||
     service.assignment_intents_pending!==true)
    return {success:true,reason:'nothing_pending',processed:0};
  const raw=String(service.assignment_notification_intents||'[]');
  const intents=readAssignmentIntents(raw);
  if(!intents.length)throw new Error('Pending intent flag with empty journal');
  const toProcess=intents.filter(x=>x.state==='requested').slice(0,
    Number.isInteger(options.limit)&&options.limit>0?Math.min(LIMIT,options.limit):LIMIT);
  const copy=intents.map(i=>({...i}));
  const counters={processed:0,queued:0,alreadyAccepted:0,unknown:0,cancelled:0,blocked:0};
  if(toProcess.length){
    const control=await readWhatsAppQueueControl(client);
    if(!control.enabled||control.paused)return {...counters,success:false,reason:'queue_unavailable'};
  }
  // Loads happen ONCE per batch, instead of one event, template and service query
  // per supplier. A disabled template resolves the intent without a send.
  const [event,templates,serviceCatalog]=toProcess.length?await Promise.all([
    db.Event.get(service.event_id).catch(()=>null),
    db.NotificationTemplate.filter({type:'SUPPLIER_NEW_ASSIGNMENT',is_active:true},'-created_date',2),
    service.service_id?db.Service.get(service.service_id).catch(()=>null):Promise.resolve(null)
  ]):[null,[],null];
  const assigned=(()=>{
    try{return JSON.parse(String(service.supplier_ids||'[]'));}catch{return null;}
  })();
  const statuses=(()=>{
    try{return JSON.parse(String(service.supplier_statuses||'{}'));}catch{return null;}
  })();
  if(!Array.isArray(assigned)||!statuses||typeof statuses!=='object'||Array.isArray(statuses)){
    throw new Error('Current assignment snapshot is invalid');
  }
  const template=templates[0];
  const channels=template?.allowed_channels||[];
  const whatsappEnabled=!!template && (
    Array.isArray(channels)?channels.includes('whatsapp'):
      String(channels).includes('whatsapp')
  );
  for(const intent of toProcess){
    const index=copy.findIndex(x=>x.key===intent.key);
    if(index<0)continue;
    const next=copy[index];
    // If an older intent is no longer relevant, do not notify a supplier who
    // was removed/confirmed before a delayed worker woke up.
    if(!event || ['cancelled','completed'].includes(event.status) ||
       !assigned.includes(intent.supplier_id) ||
       (statuses[intent.supplier_id] && statuses[intent.supplier_id]!=='pending')){
      next.state='cancelled';next.resolution='assignment_no_longer_pending';
      counters.cancelled++;counters.processed++;continue;
    }
    try{
      // Check provider history FIRST. Both entity trigger and reconciler can
      // race; the persisted key + central Outbox CAS prevents duplicates.
      const existing=await db.WhatsAppOutbox.filter({idempotency_key:intent.key},'-created_date',2);
      if(existing.length){
        const state=reconcileOutboxIntentStatus(String(existing[0].status||''));
        if(!state)throw new Error('Provider state needs administrator review');
        next.state=state;next.outbox_id=existing[0].id;
        if(state==='unknown')counters.unknown++;
        if(state==='accepted')counters.alreadyAccepted++;
        if(state==='cancelled')counters.cancelled++;
        if(state==='queued')counters.queued++;
        counters.processed++;continue;
      }
      if(!whatsappEnabled){
        next.state='resolved';next.resolution='whatsapp_template_disabled';
        counters.processed++;continue;
      }
      const supplier=await db.Supplier.get(intent.supplier_id).catch(()=>null);
      if(!supplier || supplier.whatsapp_enabled===false){
        // Do not invent a replacement number or claim recipient delivery.
        next.state='resolved';next.resolution='whatsapp_not_enabled_for_supplier';
        counters.processed++;continue;
      }
      const chatId=supplierTargetChatId(supplier,toChatId);
      const selectedGroup=String(supplier.preferred_channel||'')==='group';
      if(!chatId || (selectedGroup&&!/^[a-zA-Z0-9_-]+@g\.us$/.test(chatId))){
        counters.blocked++;next.last_error='Recipient WhatsApp target is missing or invalid';
        continue;
      }
      const text=renderAssignmentWhatsApp(
        template.whatsapp_body_template||template.body_template||'',
        event,service,supplier,serviceCatalog?.service_name||''
      );
      if(!text){counters.blocked++;next.last_error='Assignment message template is empty';continue;}
      const delay=resolveNotificationDelay(supplier);
      const result=await (options.enqueue||sendWhatsAppToChat)(chatId,text,client,{
        sourceType:'assignment_new',
        sourceId:String(service.id),eventServiceId:String(service.id),
        supplierId:intent.supplier_id,idempotencyKey:intent.key,
        ...(delay.shouldDelay && delay.scheduledFor &&
          Number.isFinite(new Date(delay.scheduledFor).getTime())
          ?{availableAt:new Date(delay.scheduledFor).toISOString()}:{})
      });
      const state=reconcileOutboxIntentStatus(String(result?.status||''));
      if(!state){
        counters.blocked++;next.last_error='Outbox insertion returned an unrecognized status';
        continue;
      }
      next.state=state;next.outbox_id=result.jobId||'';
      next.last_error='';
      if(state==='queued')counters.queued++;
      if(state==='accepted')counters.alreadyAccepted++;
      if(state==='unknown')counters.unknown++;
      counters.processed++;
    }catch(error){
      // An ambiguous failure NEVER justifies retrying a provider. On the next
      // run we first check the SAME Outbox idempotency key.
      counters.blocked++;
      next.last_error='Outbox status could not be verified; reconcile by key';
      console.error('[AssignmentIntent] reconciliation interrupted',error instanceof Error?error.name:'unknown');
    }
  }
  const remaining=copy.some(x=>x.state==='requested');
  if(JSON.stringify(copy)!==raw||service.assignment_intents_pending!==remaining){
    const updated=await db.EventService.updateMany({
      id:serviceId,assignment_notification_intents:raw
    },{$set:{assignment_notification_intents:JSON.stringify(copy),
      assignment_intents_pending:remaining}});
    if(updated?.updated!==1)return {...counters,success:false,reason:'changed_concurrently'};
  }
  return {...counters,success:counters.blocked===0,
    reason:counters.blocked?'needs_review':remaining?'more_pending':'reconciled',
    remaining};
}
