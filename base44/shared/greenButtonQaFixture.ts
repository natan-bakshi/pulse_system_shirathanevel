// Test-only fixture isolation for the ONE owner-approved WhatsApp-buttons pilot.
// No normal business event or service qualifies. The marker must be exact;
// do not allow "QA" substrings or weak truthy flags to suppress real traffic.
export const GREEN_BUTTON_QA_EVENT_NAME='[PULSE-WA-BUTTONS-QA] PRIVATE TEST';
export const GREEN_BUTTON_QA_FAMILY_NAME='PULSE_WA_QA_NO_CUSTOMER';
export const GREEN_BUTTON_QA_SERVICE_NAME='[PULSE-WA-BUTTONS-QA] ASSIGNMENT';
export function isGreenButtonQaFixtureEvent(event:any):boolean{
 return event?.whatsapp_buttons_qa_fixture===true&&
  event?.event_name===GREEN_BUTTON_QA_EVENT_NAME&&
  event?.family_name===GREEN_BUTTON_QA_FAMILY_NAME&&
  event?.event_type==='other';
}
const hasId=(v:any)=>typeof v==='string'&&/^[A-Za-z0-9_-]{8,128}$/.test(v);
export function isGreenButtonQaFixtureEventPayload(
 data:any, env:(key:string)=>string|undefined,
 entityId?:string):boolean{
 if(isGreenButtonQaFixtureEvent(data))return true;
 const approved=env('GREEN_BUTTONS_QA_EVENT_ID');
 return hasId(approved)&&String(data?.id||entityId||'')===approved;
}
export function isGreenButtonQaFixtureServicePayload(
 data:any, env:(key:string)=>string|undefined,
 entityId?:string):boolean{
 const approvedService=env('GREEN_BUTTONS_QA_EVENT_SERVICE_ID');
 if(hasId(approvedService)&&String(data?.id||entityId||'')===approvedService)
  return true;
 const approvedEvent=env('GREEN_BUTTONS_QA_EVENT_ID');
 return hasId(approvedEvent)&&data?.event_id===approvedEvent&&
  data?.service_name===GREEN_BUTTON_QA_SERVICE_NAME;
}
