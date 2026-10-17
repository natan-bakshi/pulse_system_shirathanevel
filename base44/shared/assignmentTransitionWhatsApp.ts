import {sendWhatsAppText} from './whatsappSend.ts';
import {whatsappEnqueueReceiptState,isWhatsAppEnqueueConfirmed} from './whatsappReceipt.ts';

// A stable, transport-agnostic identifier for ONE business transition sent to
// ONE supplier. Retrying the same HTTP workflow (or reopening its dialog)
// must not create another WhatsApp message. A real change to the supplier's
// arrival time / event date / template / recipient must produce a new key.
// Never include "now", the worker provider, or rendered message text.
export async function assignmentTransitionWhatsAppKey(input:{
  kind:'arrival_notify'|'arrival_cancel'|'date_cancel'|'date_reconfirm';
  eventId:string;eventServiceId?:string;supplierId:string;templateId:string;
  oldEventDate?:string;oldEventTime?:string;eventDate?:string;eventTime?:string;
  supplierArrivalTime?:string;
}):Promise<string>{
  const kinds=new Set(['arrival_notify','arrival_cancel','date_cancel','date_reconfirm']);
  if(!kinds.has(input?.kind))throw new Error('Unsupported assignment transition kind');
  const eventId=String(input.eventId||'').trim();
  const supplierId=String(input.supplierId||'').trim();
  const templateId=String(input.templateId||'').trim();
  if(!eventId||!supplierId||!templateId)throw new Error('Assignment transition identity incomplete');
  if(input.kind.startsWith('arrival_')&&!String(input.eventServiceId||'').trim())
    throw new Error('EventService required for arrival transition');
  const values=[
    'assignment-transition-v1',input.kind,eventId,String(input.eventServiceId||''),
    supplierId,templateId,
    String(input.oldEventDate||''),String(input.oldEventTime||''),
    String(input.eventDate||''),String(input.eventTime||''),
    String(input.supplierArrivalTime||'')
  ];
  const encoded=new TextEncoder().encode(JSON.stringify(values));
  const digest=await crypto.subtle.digest('SHA-256',encoded);
  const hex=Array.from(new Uint8Array(digest)).map(n=>n.toString(16).padStart(2,'0')).join('');
  return 'assignment-transition-v1:'+input.kind+':'+hex;
}

// No transport is performed here: the shared WhatsApp send function persists
// to the Outbox; the worker owns the only provider call. Do not tell callers
// that "queued" means "delivered". NEVER retry a terminal/unknown status by
// using a new key.
export async function enqueueAssignmentTransitionWhatsApp(
  client:any,phone:string,message:string,
  identity:Parameters<typeof assignmentTransitionWhatsAppKey>[0],
  sourceType:'arrival_time_change'|'assignment_cancel'|'assignment_update'
){
  const key=await assignmentTransitionWhatsAppKey(identity);
  const receipt=await sendWhatsAppText(phone,message,client,{
    sourceType,sourceId:identity.eventId,
    idempotencyKey:key,eventServiceId:identity.eventServiceId||'',
    supplierId:identity.supplierId
  });
  const state=whatsappEnqueueReceiptState(receipt);
  if(!isWhatsAppEnqueueConfirmed(receipt)){
    const error=new Error('Supplier WhatsApp Outbox not confirmed: '+state);
    Object.assign(error,{outboxStatus:state,
      jobId:String(receipt?.jobId||''),
      requiresManualReview:['unknown','resolved','cancelled','expired'].includes(state)});
    throw error;
  }
  return {queued:state!=='accepted',status:state,jobId:String(receipt?.jobId||''),
    providerAccepted:state==='accepted',deduplicated:!!receipt?.deduplicated};
}
