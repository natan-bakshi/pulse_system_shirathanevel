// Small bridge from the existing supplier-status CAS (Pulse dashboard or
// authenticated WhatsApp button) to the EXISTING EventService Google Calendar
// workflow. We only UPDATE a metadata wake field; the Google sync workflow is
// the sole consumer and uses the same calendars, templates and event IDs.
// No Google API call, no recipient notification and no job is created here.
const VALID_ID=/^[A-Za-z0-9_-]{3,128}$/;
export async function wakeExistingCalendarSyncAfterSupplierDecision(
 client:any,eventServiceId:string,now=new Date(),id=crypto.randomUUID()
):Promise<{requested:boolean;reason:string}>{
 if(!VALID_ID.test(eventServiceId||'')||!(now instanceof Date)||
  !Number.isFinite(now.getTime())||typeof id!=='string'||
  !/^[A-Za-z0-9_-]{16,100}$/.test(id))
  return {requested:false,reason:'invalid_calendar_wake_identity'};
 const entity=client?.entities?.EventService;
 if(!entity||typeof entity.update!=='function')
  return {requested:false,reason:'calendar_wake_storage_unavailable'};
 try{
  // An opaque nonce makes independent decisions distinct even within 1 ms.
  // Never store PII, supplier notes, message content or provider tokens.
  const value=now.toISOString()+':'+id;
  await entity.update(eventServiceId,{calendar_sync_wake_at:value});
  return {requested:true,reason:'existing_calendar_workflow_woken'};
 }catch{
  // An update ACK may be lost after commit. Never blindly call update again:
  // the existing workflow can already be processing this event.
  return {requested:false,reason:'calendar_wake_outcome_uncertain'};
 }
}
