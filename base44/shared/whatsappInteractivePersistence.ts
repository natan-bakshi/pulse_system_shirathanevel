// Bounded, read-only source resolution for an accepted assignment WhatsApp job.
// The canonical source is the persisted Outbox receipt, never an inbound claim.
import {validateAssignmentMessageContext} from './whatsappInteractiveContext.ts';
export function assignmentOriginFromOutbox(job:any,metadata:any){
 if(!job||!metadata||job.status!=='accepted'||!job.provider_message_id)return null;
 if(job.id!==metadata.outboxJobId||job.event_service_id!==metadata.eventServiceId||
  job.supplier_id!==metadata.supplierId)return null;
 if(job.provider!==metadata.provider||job.provider_message_id!==metadata.providerMessageId)return null;
 try{return validateAssignmentMessageContext({...metadata,status:'accepted'});}catch{return null;}
}
export async function loadAssignmentOriginFromOutbox(entity:{get:(id:string)=>Promise<any>},metadata:any){
 if(!metadata||typeof metadata.outboxJobId!=='string'||!/^[A-Za-z0-9_-]{3,128}$/.test(metadata.outboxJobId))return null;
 try{
  const job=await entity.get(metadata.outboxJobId);
  return assignmentOriginFromOutbox(job,metadata);
 }catch{return null;}
}
