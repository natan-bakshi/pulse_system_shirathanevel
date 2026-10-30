import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createFutureInteractiveButtonSnapshot}
 from '../base44/shared/whatsappButtonBindings.ts';
import {sendWhatsAppTransport} from '../base44/shared/whatsappSend.ts';
import {inboundReceiptKey} from '../base44/shared/whatsappInteractiveReceipt.ts';
import {
 planVerifiedButtonFeedback,enqueueVerifiedButtonFeedback,reconcileTerminalButtonFeedback
} from '../base44/shared/whatsappButtonFeedback.ts';

const secret='verification-key-for-signed-button-feedback-0123456789';
const sample=()=>({
 id:'outbox-original123',source_type:'assignment_new',status:'accepted',
 message_type:'text',requested_provider:'green',provider:'green',
 provider_message_id:'3EB0SIGNEDASSIGNMENT123',sender_account_id:'9903183013',
 event_service_id:'service-abc123',supplier_id:'supplier-abc123',
 assignment_revision:'r3',chat_id:'972501234567@c.us'
});
const policy={enabled:true,quoteAssignment:false,buttons:[
 {action:'assignment_approve',label:'אישור'},
 {action:'assignment_reject',label:'דחייה'},
 {action:'contact_office',label:'פנייה למשרד'}
]};
async function fixture(receiptPatch={},extra={}){
 const original=sample(),snapshot=await createFutureInteractiveButtonSnapshot({
  job:{...original,status:'queued'},policy,signingSecret:secret,
  issuedAt:Date.now()
 },webcrypto.subtle);
 original.interactive_button_bindings_json=snapshot;
 const receipt={id:'receipt-terminal123',provider:'green',
  company_id:'shirat_hanevel',sender_account_id:original.sender_account_id,
  provider_event_id:'incoming-provider-123',
  provider_message_id:original.provider_message_id,
  receipt_key:inboundReceiptKey({provider:'green',
   senderAccountId:original.sender_account_id,providerEventId:'incoming-provider-123'}),
  outbox_job_id:original.id,event_service_id:original.event_service_id,
  supplier_id:original.supplier_id,
  assignment_revision:original.assignment_revision,
  action:'assignment_approve',state:'applied',result_code:'applied',
  completed_at:new Date().toISOString(),feedback_required:true,
  feedback_outbox_id:null,...receiptPatch};
 const supplier={id:original.supplier_id,phone:'0501234567',is_active:true};
 const control={id:'control-global',control_key:'global',
  enabled:true,paused:false,enqueue_owner:'',enqueue_until:''};
 const jobs=[original],updates=[],created=[];
 let next=0,failLink=!!extra.failLink,enqueueStarts=0,providerCalls=0;
 const matches=(row,q)=>Object.entries(q).every(([k,v])=>{
  if(v&&typeof v==='object'&&'$in' in v)return v.$in.includes(row[k]);
  return (row[k]??null)===(v??null);
 });
 const outbox={
  get:async id=>jobs.find(x=>x.id===id)||null,
  filter:async q=>jobs.filter(x=>matches(x,q)),
  create:async fields=>{
   const job={...fields,id:'feedback-outbox-'+(++next)};
   created.push(job);jobs.push(job);return job;
  }
 };
 const receipts={
  get:async id=>id===receipt.id?{...receipt}:null,
  filter:async q=>matches(receipt,q)?[{id:receipt.id}]:[],
  updateMany:async(q,{ $set:patch})=>{
   if(failLink){failLink=false;throw Error('lost receipt link ACK');}
   if(!matches(receipt,q))return {updated:0};
   Object.assign(receipt,patch);updates.push(patch);return {updated:1};
  }
 };
 const controlEntity={
  filter:async()=>[{...control}],
  updateMany:async(q,{$set:patch})=>{
   if(!matches(control,q))return {updated:0};
   Object.assign(control,patch);return {updated:1};
  }
 };
 const client={asServiceRole:{entities:{
  WhatsAppOutbox:outbox,WhatsAppInboundReceipt:receipts,
  Supplier:{get:async id=>id===supplier.id?{...supplier}:null},
  WhatsAppQueueControl:controlEntity,
  AppSettings:{filter:async()=>[{setting_key:'whatsapp_default_provider',
   setting_value:extra.provider||'green'}]}
 }}};
 return {receipt,original,supplier,control,jobs,created,updates,client,
  get providerCalls(){return providerCalls;},
  get enqueueStarts(){return enqueueStarts;},
  setFailLink:()=>failLink=true
 };
}
test('positive approve/reject and business conflict produce distinct safe Hebrew replies',()=>{
 const receipt={id:'receipt-terminal123',company_id:'shirat_hanevel',
  provider:'green',completed_at:new Date().toISOString(),feedback_required:true,
  receipt_key:'green:9903183013:provider-event-123',
  outbox_job_id:'outbox-original123',event_service_id:'service-abc123',
  supplier_id:'supplier-abc123',action:'assignment_approve',
  state:'applied',result_code:'applied'};
 const accept=planVerifiedButtonFeedback(receipt);
 assert.match(accept.message,/אושר בהצלחה/);
 assert.match(accept.message,/Pulse/);
 const reject=planVerifiedButtonFeedback({...receipt,action:'assignment_reject'});
 assert.match(reject.message,/נדחה בהצלחה/);
 const conflict=planVerifiedButtonFeedback({...receipt,state:'rejected',
  result_code:'business_conflict'});
 assert.match(conflict.message,/כבר השתנו/);
 const uncertain=planVerifiedButtonFeedback({...receipt,state:'needs_review',
  result_code:'unknown_after_write'});
 assert.match(uncertain.message,/לא ניתן לאמת/);
 assert.doesNotMatch(uncertain.message,/אושר בהצלחה|נדחה בהצלחה/);
 assert.equal(accept.idempotencyKey,reject.idempotencyKey);
});
test('unverified, ambiguous and historical receipts never create feedback',()=>{
 const f={id:'receipt-terminal123',company_id:'shirat_hanevel',
  provider:'green',completed_at:new Date().toISOString(),feedback_required:true,
  receipt_key:'a:b:c',outbox_job_id:'outbox-original123',
  event_service_id:'service-abc123',supplier_id:'supplier-abc123',
  action:'assignment_approve',state:'applied',result_code:'applied'};
 for(const patch of [
  {feedback_required:false},{state:'processing'},{state:'needs_review',
   result_code:'not_terminal'},{completed_at:''},
  {state:'rejected',result_code:'unknown_after_write'},
  {company_id:'other_tenant'},{provider:'wasender'}
 ])assert.equal(planVerifiedButtonFeedback({...f,...patch}),null);
});
test('verified signed original creates one durable queued feedback and links its terminal receipt',async()=>{
 const f=await fixture();
 const result=await enqueueVerifiedButtonFeedback(f.client,f.receipt.id,secret);
 assert.equal(result.queued,true,JSON.stringify(result));
 assert.equal(f.created.length,1);
 assert.equal(f.created[0].source_type,'assignment_button_feedback');
 assert.equal(f.created[0].idempotency_key,'button-feedback:'+f.receipt.id);
 assert.equal(f.created[0].requested_provider,'green');
 assert.equal(f.created[0].sender_account_id,f.original.sender_account_id);
 assert.equal(f.created[0].chat_id,f.original.chat_id);
 assert.equal(f.receipt.feedback_outbox_id,f.created[0].id);
 assert.equal(f.providerCalls,0,'enqueue never calls the WhatsApp transport');
 const replay=await enqueueVerifiedButtonFeedback(f.client,f.receipt.id,secret);
 assert.equal(replay.queued,false);
 assert.equal(replay.reason,'feedback_already_linked');
 assert.equal(f.created.length,1);
});
test('link ACK lost after successful enqueue recovers by EXISTING idempotency key without second message',async()=>{
 const f=await fixture({}, {failLink:true});
 const first=await enqueueVerifiedButtonFeedback(f.client,f.receipt.id,secret);
 assert.equal(first.queued,false);
 assert.equal(first.reason,'feedback_receipt_link_uncertain');
 assert.equal(f.created.length,1);
 const second=await enqueueVerifiedButtonFeedback(f.client,f.receipt.id,secret);
 assert.equal(second.queued,true);
 assert.equal(f.created.length,1);
 assert.equal(f.receipt.feedback_outbox_id,f.created[0].id);
});
test('forged snapshot, changed recipient, wrong Green account and provider switch cannot queue',async()=>{
 for(const patch of ['forged_mac','changed_supplier','wrong_account','switched_provider']){
  const f=await fixture({},patch==='switched_provider'?{provider:'wasender'}:{});
  if(patch==='forged_mac')f.original.interactive_button_bindings_json=
    f.original.interactive_button_bindings_json.replace('אישור','הטעיה');
  if(patch==='changed_supplier')f.supplier.phone='0509999999';
  if(patch==='wrong_account')f.receipt.sender_account_id='9999999999';
  const out=await enqueueVerifiedButtonFeedback(f.client,f.receipt.id,secret);
  assert.equal(out.queued,false,patch);
  assert.equal(f.created.length,0,patch);
 }
});
test('transport refuses feedback from another Green sender, without any provider request',async()=>{
 const f=await fixture();
 const job={chat_id:'972501234567@c.us',message_type:'text',
  message_text:'Synthetic feedback',source_type:'assignment_button_feedback',
  sender_account_id:'9903183013'};
 const old=globalThis.Deno;
 globalThis.Deno={env:{get:key=>key==='GREEN_API_INSTANCE_ID'?'different-instance':'test'}};
 try{
  await assert.rejects(sendWhatsAppTransport(job,'green',f.client),/Original Green sender account unavailable/);
  await assert.rejects(sendWhatsAppTransport(job,'wasender',f.client),/Original Green sender account unavailable/);
 }finally{if(old===undefined)delete globalThis.Deno;else globalThis.Deno=old;}
 assert.equal(f.created.length,0);
});
test('watchdog recovers only newly opted-in, terminal feedback and never scans historical ones',async()=>{
 const f=await fixture();
 const recovered=await reconcileTerminalButtonFeedback(f.client,secret,4);
 assert.equal(recovered.scanned,1);
 assert.equal(recovered.queued,1);
 assert.equal(f.created.length,1);
 const next=await reconcileTerminalButtonFeedback(f.client,secret,4);
 assert.equal(next.scanned,0);
 f.receipt.feedback_required=false;
 f.receipt.feedback_outbox_id=null;
 const old=await reconcileTerminalButtonFeedback(f.client,secret,4);
 assert.equal(old.scanned,0);
});
