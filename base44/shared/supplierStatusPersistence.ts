// Single authorized supplier-status CAS writer for dashboard and future
// authenticated WhatsApp replies. Authorization is BEFORE calling this module:
// dashboard binds a signed-in user to Supplier; future webhook must verify
// provider credentials + sender-to-supplier binding + original Outbox message +
// signed action payload + durable inbound receipt claim.
// NO public inbound endpoint is registered and no provider sends occur here.
import {supplierAssigned,supplierTransition} from './whatsappSupplierTransition.ts';
import {readAssignmentIntents,ASSIGNMENT_INTENT_MODE} from './assignmentIntent.ts';

export type SupplierStatusSource='dashboard'|'whatsapp';
type SupplierStatus='pending'|'confirmed'|'rejected';
const idOk=(value:unknown)=>typeof value==='string'&&
 /^[A-Za-z0-9_-]{3,128}$/.test(value);
const issue=(reason:string,status:number)=>
 Object.assign(new Error(reason),{status,code:reason});
function parseStatuses(value:unknown):Record<string,string>{
 let parsed:any;
 try{parsed=typeof value==='string'?JSON.parse(value):value??{};}
 catch{throw issue('invalid_supplier_status_record',409);}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))
  throw issue('invalid_supplier_status_record',409);
 // Never rewrite unexpected objects into {} or silently erase other suppliers.
 if(Object.entries(parsed).some(([key,val])=>!idOk(key)||
  !['pending','confirmed','rejected'].includes(String(val))))
  throw issue('invalid_supplier_status_record',409);
 return parsed;
}
function declinedHistory(value:unknown):any[]{
 let parsed:any;
 try{parsed=typeof value==='string'?JSON.parse(value):value??[];}
 catch{throw issue('invalid_decline_history',409);}
 if(!Array.isArray(parsed))throw issue('invalid_decline_history',409);
 return parsed;
}
export function whatsappRevisionEligibility(service:any,supplierId:string,revision:string){
 if(service?.assignment_intent_mode!==ASSIGNMENT_INTENT_MODE)
  return {allowed:false,reason:'durable_assignment_not_enabled'};
 if(typeof revision!=='string'||!/^r[1-9][0-9]{0,12}$/.test(revision))
  return {allowed:false,reason:'invalid_assignment_revision'};
 let intents:any[];
 try{intents=readAssignmentIntents(service.assignment_notification_intents||'[]');}
 catch{return {allowed:false,reason:'invalid_assignment_intents'};}
 // Compare the latest revision OF THIS SUPPLIER, never global service revision:
 // another newly assigned supplier may advance the global counter while a
 // pending original reply remains valid for the first supplier.
 const current=[...intents].reverse().find(i=>i.supplier_id===supplierId);
 if(!current||'r'+current.revision!==revision)
  return {allowed:false,reason:'stale_assignment_revision'};
 if(!['requested','queued','accepted'].includes(current.state))
  return {allowed:false,reason:'assignment_intent_inactive'};
 return {allowed:true,reason:'current_assignment_revision'};
}
export async function persistAuthorizedSupplierStatus(serviceClient:any,input:{
 eventServiceId:string;supplierId:string;newStatus:SupplierStatus;
 source:SupplierStatusSource;expectedRevision?:string
}):Promise<{kind:'changed'|'unchanged';eventId:string;status:SupplierStatus}>{
 const {eventServiceId,supplierId,newStatus,source}=input;
 if(!idOk(eventServiceId)||!idOk(supplierId))throw issue('invalid_assignment',400);
 if(!['pending','confirmed','rejected'].includes(newStatus)||
  !['dashboard','whatsapp'].includes(source))throw issue('invalid_supplier_status',400);
 if(source==='whatsapp'&&newStatus==='pending')
  throw issue('invalid_whatsapp_action',400);
 const entities=serviceClient?.entities;
 if(!entities?.EventService?.get||!entities?.EventService?.updateMany)
  throw issue('event_service_unavailable',503);
 for(let attempt=0;attempt<3;attempt++){
  const row=await entities.EventService.get(eventServiceId);
  if(!row)throw issue('event_service_not_found',404);
  if(row.is_external===true)throw issue('external_service',403);
  if(!supplierAssigned(row.supplier_ids,supplierId))throw issue('supplier_not_assigned',403);
  if(source==='whatsapp'){
   const revision=whatsappRevisionEligibility(row,supplierId,input.expectedRevision||'');
   if(!revision.allowed)throw issue(revision.reason,409);
  }
  const statuses=parseStatuses(row.supplier_statuses);
  const transition=supplierTransition(statuses[supplierId],newStatus,source==='whatsapp');
  if(!transition.allowed)throw issue('stale_or_invalid_supplier_transition',409);
  if(!transition.changed)return {kind:'unchanged',eventId:row.event_id,status:newStatus};
  const updateData:any={supplier_statuses:JSON.stringify({...statuses,[supplierId]:newStatus})};
  const filter:any={
   id:row.id,supplier_ids:row.supplier_ids??null,
   supplier_statuses:row.supplier_statuses??null
  };
  if(source==='whatsapp'){
   filter.assignment_intent_mode=row.assignment_intent_mode??null;
   filter.assignment_notification_intents=row.assignment_notification_intents??null;
  }
  if(newStatus==='rejected'){
   const declined=declinedHistory(row.declined_suppliers);
   if(!declined.some(x=>x?.supplier_id===supplierId)){
    updateData.declined_suppliers=JSON.stringify([...declined,{
     supplier_id:supplierId,declined_date:new Date().toISOString(),
     reason:'',declined_by_supplier:true
    }]);
    // Avoid dropping a concurrent change to decline history from a manager.
    filter.declined_suppliers=row.declined_suppliers??null;
   }
  }
  // If the SDK loses the response after a committed write, do NOT replay
  // automatically here; let the inbound inbox go to needs_review.
  const saved=await entities.EventService.updateMany(filter,{$set:updateData});
  if(saved?.updated===1)return {kind:'changed',eventId:row.event_id,status:newStatus};
  if(saved?.updated!==0)throw issue('ambiguous_supplier_update',503);
 }
 throw issue('assignment_changed_concurrently',409);
}
