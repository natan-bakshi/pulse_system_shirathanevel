// Owner-only, READ-ONLY inbound receipt investigation. Never infers that
// a matching supplier status proves THIS callback committed a mutation.
// It performs bounded existing-entity GETs, never reclaims or retries events.
// No customer message, sender phone, provider payload or signed token exposed.
import {whatsappRevisionEligibility} from './supplierStatusPersistence.ts';

const ALLOWED_STATES=new Set(['pending','processing','applied','rejected','needs_review']);
const ALLOWED_RESULT=new Set([
 'applied','already_applied','stale_assignment','not_assigned',
 'invalid_assignment','unauthorized_sender','identity_mismatch','business_conflict',
 'needs_review','unknown_after_write'
]);
const idOk=(v:any)=>typeof v==='string'&&/^[A-Za-z0-9_-]{3,128}$/.test(v);
const stamp=(v:any)=>typeof v==='string'&&Number.isFinite(Date.parse(v))
 ?new Date(v).toISOString():null;
const manualOnly='Do NOT replay a callback or clear the guard automatically; '
 +'confirm provider event, original Outbox, current assignment and database history with the operator.';
const safeProvider=(v:any)=>['green','wasender'].includes(v)?v:'unknown';
const safeState=(v:any)=>ALLOWED_STATES.has(v)?v:'unknown';
const safeResult=(v:any)=>ALLOWED_RESULT.has(v)?v:'unknown';
function currentSupplierStatus(service:any,id:string){
 if(!service)return 'not_found';
 try{
  const statuses=typeof service.supplier_statuses==='string'
   ?JSON.parse(service.supplier_statuses||'{}')
   :service.supplier_statuses||{};
  if(!statuses||typeof statuses!=='object'||Array.isArray(statuses))return 'unavailable';
  const status=statuses[id];
  return ['pending','confirmed','rejected'].includes(status)?status:'unknown';
 }catch{return 'unavailable';}
}
export function summarizeInboundReceiptInvestigation(row:any,service:any,control:any,now=Date.now()){
 if(!row||!idOk(row.id))throw Error('invalid_inbound_receipt');
 const state=safeState(row.state);
 const expected=row.action==='assignment_approve'?'confirmed':
  row.action==='assignment_reject'?'rejected':'unknown';
 const current=currentSupplierStatus(service,row.supplier_id);
 const epoch=Date.parse(row.claim_until||'');
 const expiry=state==='processing'&&(!Number.isFinite(epoch)||epoch<=now);
 let revision='not_verified';
 try{
  const eligibility=whatsappRevisionEligibility(service,row.supplier_id,row.assignment_revision);
  revision=eligibility.allowed?'current':eligibility.reason;
 }catch{revision='unavailable';}
 const guard=typeof control?.inbound_guard_key==='string'&&
  control.inbound_guard_key.length>0;
 return {
  receiptId:row.id,provider:safeProvider(row.provider),state,
  safeResult:safeResult(row.result_code),
  registeredAt:stamp(row.registered_at),claimedAt:stamp(row.claimed_at),
  completedAt:stamp(row.completed_at),claimExpiresAt:stamp(row.claim_until),
  expiredClaim:expiry,registrationBlocked:guard,
  guardMatchesThisReceipt:guard&&control.inbound_guard_key===row.receipt_key,
  expectedStatus:expected,currentStatus:current,
  currentRevision:revision,revisionMatches:revision==='current',
  stateMatchesExpected:current===expected&&expected!=='unknown',
  businessMatchDoesNotProveCallbackCommitted:true,
  automaticReplayAllowed:false,automaticGuardReleaseAllowed:false,
  nextAction:manualOnly,noMessagesSent:true,noBusinessWrites:true
 };
}
export async function inspectInboundReceiptReadOnly(client:any,receiptId:string){
 if(!idOk(receiptId))throw Object.assign(Error('Invalid inbound receipt ID'),{status:400});
 const entities=client?.asServiceRole?.entities;
 if(!entities?.WhatsAppInboundReceipt?.get||!entities?.EventService?.get||
  !entities?.WhatsAppQueueControl?.filter)
  throw Object.assign(Error('Receipt investigation unavailable'),{status:503});
 const row=await entities.WhatsAppInboundReceipt.get(receiptId);
 if(!row)throw Object.assign(Error('Inbound receipt not found'),{status:404});
 const [controlRows,service]=await Promise.all([
  entities.WhatsAppQueueControl.filter({control_key:'global'},'-created_date',2),
  idOk(row.event_service_id)?entities.EventService.get(row.event_service_id):Promise.resolve(null)
 ]);
 if(!Array.isArray(controlRows)||controlRows.length!==1)
  throw Object.assign(Error('Queue control unavailable'),{status:503});
 return summarizeInboundReceiptInvestigation(row,service,controlRows[0]);
}
