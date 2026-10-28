// Single-service V2 island for the owner-approved Green buttons pilot.
// Global assignment_intent_v1_enabled may remain OFF. No ordinary EventService
// can enter V2 via this switch; the EXACT server-pinned QA service and event
// must match. This module has NO side effects, scans or provider requests.
import {GREEN_BUTTON_QA_SERVICE_NAME} from './greenButtonQaFixture.ts';
const ID=/^[A-Za-z0-9_-]{8,128}$/;
const PRIVATE=/^[1-9][0-9]{7,14}@c\.us$/;
const value=(env:(key:string)=>string|undefined,key:string)=>
 String(env(key)||'');
export function greenButtonQaScopedV2Enabled(
 env:(key:string)=>string|undefined,serviceId?:string):boolean{
 if(value(env,'GREEN_BUTTONS_QA_SCOPED_V2_ENABLED')!=='enabled')
  return false;
 const eventId=value(env,'GREEN_BUTTONS_QA_EVENT_ID');
 const qaServiceId=value(env,'GREEN_BUTTONS_QA_EVENT_SERVICE_ID');
 const supplierId=value(env,'GREEN_BUTTONS_QA_SUPPLIER_ID');
 const chat=value(env,'GREEN_BUTTONS_QA_ALLOWED_CHAT');
 return ID.test(eventId)&&ID.test(qaServiceId)&&ID.test(supplierId)&&
  PRIVATE.test(chat)&&(!serviceId||serviceId===qaServiceId);
}
export function greenButtonQaScopedServiceMatches(
 service:any,env:(key:string)=>string|undefined):boolean{
 return greenButtonQaScopedV2Enabled(env,service?.id)&&
  service?.event_id===value(env,'GREEN_BUTTONS_QA_EVENT_ID')&&
  service?.service_name===GREEN_BUTTON_QA_SERVICE_NAME;
}
export function greenButtonQaScopedJournalMatches(
 service:any,intents:any[],env:(key:string)=>string|undefined):boolean{
 return greenButtonQaScopedServiceMatches(service,env)&&
  intents.length===1&&intents[0]?.qa_buttons_required===true&&
  intents[0].supplier_id===value(env,'GREEN_BUTTONS_QA_SUPPLIER_ID');
}
