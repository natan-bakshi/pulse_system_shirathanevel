// Durable, fail-closed inbound receipt ledger for future VERIFIED WhatsApp callbacks.
// No public endpoint imports this module; no supplier mutation, notification or send.
// The caller MUST independently authenticate provider, sender account, supplier
// ownership and exact assignment origin BEFORE admitting a receipt.
// Critical: Base44 entity IDs alone are not a documented unique constraint.
// A SINGLE existing WhatsAppQueueControl row serializes CREATE and a durable
// pre-CREATE guard stops all new registrations after ambiguous commits/crashes.
import {readWhatsAppQueueControl} from './whatsappOutbox.ts';
import {inboundReceiptDecision,inboundReceiptKey} from './whatsappInteractiveReceipt.ts';

type Provider='green'|'wasender';
type Action='assignment_approve'|'assignment_reject';
export type VerifiedInboundReceipt={
 provider:Provider;senderAccountId:string;providerEventId:string;providerMessageId:string;
 companyId:string;eventServiceId:string;supplierId:string;revision:string;outboxJobId:string;
 action:Action
};
const COMPANY='shirat_hanevel';
const LEASE_MS=30000;
const LOCK_ATTEMPTS=12;
const LEGAL_RESULTS=new Set(['applied','already_applied','stale_assignment','not_assigned',
 'invalid_assignment','unauthorized_sender','identity_mismatch','business_conflict',
 'needs_review','unknown_after_write']);
const entityError=(code:string,status=409)=>
 Object.assign(new Error(code),{status,code});
const ownId=(value:unknown,max=200):value is string=>
 typeof value==='string'&&value.length>0&&value.length<=max&&
 value.trim()===value&&!/[\u0000-\u001f\u007f]/.test(value);
const nowIso=(now:number)=>new Date(now).toISOString();
const randomToken=()=>crypto.randomUUID();

export function normalizeInboundReceipt(input:any):VerifiedInboundReceipt & {receiptKey:string} {
 if(!input||typeof input!=='object'||Array.isArray(input))throw entityError('invalid_receipt',400);
 if(!['green','wasender'].includes(input.provider)||
   !['assignment_approve','assignment_reject'].includes(input.action))
  throw entityError('unsupported_inbound_action',400);
 if(input.companyId!==COMPANY)throw entityError('invalid_company',403);
 for(const field of ['senderAccountId','providerEventId','providerMessageId','eventServiceId',
  'supplierId','revision','outboxJobId']){
  if(!ownId(input[field],200))throw entityError('invalid_receipt_'+field,400);
 }
 const receiptKey=inboundReceiptKey(input);
 return {provider:input.provider,senderAccountId:input.senderAccountId,
  providerEventId:input.providerEventId,providerMessageId:input.providerMessageId,
  companyId:COMPANY,eventServiceId:input.eventServiceId,supplierId:input.supplierId,
  revision:input.revision,outboxJobId:input.outboxJobId,action:input.action,receiptKey};
}
function matchesReceipt(row:any,receipt:ReturnType<typeof normalizeInboundReceipt>){
 return row?.receipt_key===receipt.receiptKey&&row.provider===receipt.provider&&
  row.sender_account_id===receipt.senderAccountId&&row.provider_event_id===receipt.providerEventId&&
  row.provider_message_id===receipt.providerMessageId&&row.company_id===receipt.companyId&&
  row.event_service_id===receipt.eventServiceId&&row.supplier_id===receipt.supplierId&&
  row.assignment_revision===receipt.revision&&row.outbox_job_id===receipt.outboxJobId&&
  row.action===receipt.action;
}
export const INBOUND_SUMMARY_FIELDS=[
 'id','receipt_key','provider','sender_account_id','provider_event_id','provider_message_id',
 'company_id','event_service_id','supplier_id','assignment_revision','outbox_job_id','action',
 'state','claim_owner','claim_until','claimed_at','completed_at','result_code','registered_at'
] as const;
async function lookupReceipt(db:any,key:string){
 const rows=await db.filter({receipt_key:key},'-created_date',2,0,[...INBOUND_SUMMARY_FIELDS]);
 if(!Array.isArray(rows)||rows.length>1)throw entityError('duplicate_receipt_rows_manual_review');
 return rows[0]||null;
}
// Read-only exact-identity verification for VERIFIED provider redelivery after
// the business state has changed. Called ONLY if the original signed Outbox,
// source provider account and supplier phone were independently checked.
// Never creates/reclaims receipts or releases an uncertain create guard.
// One projected filter of at most two rows; missing/mismatched results are
// NOT evidence of a completed provider event.
export async function inspectVerifiedInboundReplay(client:any,raw:any){
 const receipt=normalizeInboundReceipt(raw);
 const db=client?.asServiceRole?.entities?.WhatsAppInboundReceipt;
 if(!db||typeof db.filter!=='function')
  throw entityError('inbound_storage_unavailable',503);
 const row=await lookupReceipt(db,receipt.receiptKey);
 if(!row)return {kind:'not_found',terminalReceiptVerified:false};
 if(!matchesReceipt(row,receipt))
  return {kind:'identity_conflict',terminalReceiptVerified:false};
 const state=String(row.state||'');
 const resultCode=String(row.result_code||'');
 const finalized=Number.isFinite(Date.parse(row.completed_at||''));
 const allowedTerminal=(state==='applied'&&
   ['applied','already_applied'].includes(resultCode))||
  (state==='rejected'&&
   ['stale_assignment','not_assigned','invalid_assignment','unauthorized_sender',
    'identity_mismatch','business_conflict'].includes(resultCode))||
  (state==='needs_review'&&resultCode==='unknown_after_write');
 if(finalized&&allowedTerminal)
  return {kind:'finalized',receiptState:state,resultCode,
   terminalReceiptVerified:true};
 if(['pending','processing','needs_review'].includes(state))
  return {kind:'not_terminal',receiptState:state,
   terminalReceiptVerified:false};
 return {kind:'unverifiable',terminalReceiptVerified:false};
}
async function takeCreateLease(client:any){
 const db=client.asServiceRole.entities.WhatsAppQueueControl;
 const owner=randomToken();
 for(let attempt=0;attempt<LOCK_ATTEMPTS;attempt++){
  const control=await readWhatsAppQueueControl(client);
  // A preceding CREATE might have committed before an SDK timeout.
  // Expired leases NEVER clear this persistent guard automatically.
  if(control.inbound_guard_key)throw entityError('inbound_registration_needs_manual_review');
  const current=Date.now();
  if(!control.inbound_create_owner||Date.parse(control.inbound_create_until||'')<=current||
    !Number.isFinite(Date.parse(control.inbound_create_until||''))){
   const won=await db.updateMany({
    id:control.id,control_key:'global',
    inbound_create_owner:control.inbound_create_owner??null,
    inbound_create_until:control.inbound_create_until??null,
    inbound_guard_key:control.inbound_guard_key??null
   },{$set:{inbound_create_owner:owner,inbound_create_until:nowIso(current+LEASE_MS)}});
   if(won?.updated===1)return {db,id:control.id,owner,guardValue:control.inbound_guard_key??null};
  }
  if(attempt<LOCK_ATTEMPTS-1)await new Promise(resolve=>setTimeout(resolve,25+attempt*5));
 }
 throw entityError('inbound_registration_busy',503);
}
async function safeRelease(lease:{db:any;id:string;owner:string},guardKey:string|null){
 try{
  const query:any={id:lease.id,inbound_create_owner:lease.owner};
  if(guardKey!==null)query.inbound_guard_key=guardKey;
  const update:any={inbound_create_owner:'',inbound_create_until:''};
  if(guardKey!==null)update.inbound_guard_key='';
  const change=await lease.db.updateMany(query,{$set:update});
  return change?.updated===1;
 }catch{return false;}
}
// Only stores normalized metadata; no secret, phone, raw payload or incoming text.
// The adapter must never call this unless external evidence is verified and
// action-binding originated on this server. No direct user/API exposure.
export async function registerVerifiedInboundReceipt(client:any,raw:any){
 const receipt=normalizeInboundReceipt(raw);
 const entities=client?.asServiceRole?.entities;
 if(!entities?.WhatsAppInboundReceipt||!entities?.WhatsAppQueueControl)
  throw entityError('inbound_storage_unavailable',503);
 const lease=await takeCreateLease(client);
 let guardKey:string|null=null;
 let created:any=null;
 let duplicate:any=null;
 let createVerified=false;
 try{
  const existing=await lookupReceipt(entities.WhatsAppInboundReceipt,receipt.receiptKey);
  if(existing){
   if(!matchesReceipt(existing,receipt))throw entityError('receipt_identity_conflict');
   duplicate=existing;
  }else{
   // Durable pre-CREATE fence. If any subsequent operation is ambiguous,
   // keep this field set, blocking future registrations until human review.
   const guarded=await lease.db.updateMany({
    id:lease.id,inbound_create_owner:lease.owner,inbound_guard_key:lease.guardValue
   },{$set:{inbound_guard_key:receipt.receiptKey}});
   if(guarded?.updated!==1)throw entityError('inbound_registration_lease_lost');
   guardKey=receipt.receiptKey;
   const row={
    receipt_key:receipt.receiptKey,provider:receipt.provider,
    sender_account_id:receipt.senderAccountId,provider_event_id:receipt.providerEventId,
    provider_message_id:receipt.providerMessageId,company_id:receipt.companyId,
    event_service_id:receipt.eventServiceId,supplier_id:receipt.supplierId,
    assignment_revision:receipt.revision,outbox_job_id:receipt.outboxJobId,
    action:receipt.action,state:'pending',claim_owner:'',claim_until:'',
    result_code:'',registered_at:nowIso(Date.now())
   };
   // A rejected/timed-out create may already have committed! Do not retry.
   const result=await entities.WhatsAppInboundReceipt.create(row);
   if(!result?.id||!matchesReceipt(result,receipt)||result.state!=='pending')
    throw entityError('inbound_create_receipt_unverified');
   created=result;
   createVerified=true;
  }
 }catch(error){
  // guardKey !== null intentionally remains persisted on ambiguous CREATE.
  // Caller may NOT invoke supplier transition after this error.
  throw error;
 }finally{
  // ONLY a fully verified CREATE may clear the pre-CREATE guard.
  // A thrown/timed-out CREATE (or malformed receipt) keeps the guard forever
  // until explicit human reconciliation, even after the mutex itself expires.
  const released=await safeRelease(lease,createVerified?guardKey:null);
  if(!released){
   // A confirmed CREATE is NOT safe to hand to a future callback handler
   // until its pre-create fence has cleared; do not permit processing.
   // A pending guard can only be cleared by an explicit reviewed repair.
   if(created||duplicate)throw entityError('inbound_registration_release_unverified',503);
  }
 }
 return {kind:duplicate?'duplicate':'registered',id:(duplicate||created).id,
  state:(duplicate||created).state,receiptKey:receipt.receiptKey,
  processAllowed:!duplicate && created?.state==='pending'};
}
function assertOwner(owner:unknown){
 if(!ownId(owner,128))throw entityError('invalid_receipt_claim_owner',400);
}
export async function claimPendingInboundReceipt(client:any,params:{
 receiptId:string;receiptKey:string;claimOwner:string;now?:number
}){
 assertOwner(params.claimOwner);
 if(!ownId(params.receiptId,180)||!ownId(params.receiptKey,2000))
  throw entityError('invalid_receipt_claim',400);
 const db=client.asServiceRole.entities.WhatsAppInboundReceipt;
 const now=params.now??Date.now();
 const row=await db.get(params.receiptId);
 if(!row||row.receipt_key!==params.receiptKey)throw entityError('receipt_not_found',404);
 const decision=inboundReceiptDecision({state:row.state,claimedBy:row.claim_owner,
  claimExpiresAt:row.claim_until},now);
 if(decision.action!=='claim')return {claimed:false,reason:decision.reason};
 // Guard can be left by a timed-out CREATE: do not process receipts while
 // ANY creation is unresolved, even if this individual receipt exists.
 const control=await readWhatsAppQueueControl(client);
 if(control.inbound_guard_key)return {claimed:false,reason:'registration_needs_manual_review'};
 const duplicates=await lookupReceipt(db,row.receipt_key);
 if(!duplicates||duplicates.id!==row.id)
  return {claimed:false,reason:'receipt_identity_conflict'};
 const until=nowIso(now+60000);
 const changed=await db.updateMany({
  id:row.id,receipt_key:row.receipt_key,state:'pending'
 },{$set:{state:'processing',claim_owner:params.claimOwner,claim_until:until,
   claimed_at:nowIso(now)}});
 return changed?.updated===1?{claimed:true,reason:'claimed',claimUntil:until}:
  {claimed:false,reason:'concurrent_claim'};
}
export async function finishInboundReceipt(client:any,params:{
 receiptId:string;receiptKey:string;claimOwner:string;
 outcome:'applied'|'rejected'|'needs_review';resultCode:string;now?:number
}){
 assertOwner(params.claimOwner);
 if(!ownId(params.receiptId,180)||!ownId(params.receiptKey,2000)||
  !['applied','rejected','needs_review'].includes(params.outcome)||
  !LEGAL_RESULTS.has(params.resultCode)||
  (params.outcome==='applied'&&!['applied','already_applied'].includes(params.resultCode)))
  throw entityError('invalid_receipt_finalization',400);
 const db=client.asServiceRole.entities.WhatsAppInboundReceipt;
 const now=params.now??Date.now();
 const row=await db.get(params.receiptId);
 if(!row||row.receipt_key!==params.receiptKey)throw entityError('receipt_not_found',404);
 const until=Date.parse(row.claim_until||'');
 if(row.state!=='processing'||row.claim_owner!==params.claimOwner||
  !Number.isFinite(until)||until<=now)
  return {finalized:false,reason:'claim_not_owned_or_expired'};
 const result=await db.updateMany({id:row.id,receipt_key:row.receipt_key,
  state:'processing',claim_owner:params.claimOwner,claim_until:row.claim_until},
  {$set:{state:params.outcome,result_code:params.resultCode,completed_at:nowIso(now),
   claim_owner:'',claim_until:''}});
 return result?.updated===1?{finalized:true,state:params.outcome}:
  {finalized:false,reason:'concurrent_finalization'};
}
