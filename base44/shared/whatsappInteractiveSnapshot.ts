import {validateWhatsAppInteractivePolicy} from './whatsappInteractivePolicy.ts';
import {validateAssignmentMessageContext} from './whatsappInteractiveContext.ts';
// Snapshot is only persisted for NEW Outbox jobs, never reinterpreted on retries.
// It cannot enable sending until the transport adapter and inbound handler exist.
export function createInteractiveOutboxSnapshot(input:any){
 const policy=validateWhatsAppInteractivePolicy(input?.policy);
 if(policy.enabled)throw Error('Interactive Outbox sending is not enabled until signed inbound integration is deployed');
 const context=validateAssignmentMessageContext(input?.origin);
 if(context.status!=='accepted')throw Error('Origin must have accepted receipt');
 return JSON.stringify({version:1,policy,origin:context});
}
export function readInteractiveOutboxSnapshot(serialized:unknown){
 if(typeof serialized!=='string'||serialized.length>4000)return null;
 try{
  const parsed=JSON.parse(serialized);
  if(parsed.version!==1)return null;
  return {version:1,policy:validateWhatsAppInteractivePolicy(parsed.policy),origin:validateAssignmentMessageContext(parsed.origin)};
 }catch{return null;}
}
