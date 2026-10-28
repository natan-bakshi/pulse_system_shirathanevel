import test from 'node:test';
import assert from 'node:assert/strict';
import {supplierAssignmentTargetChatId, supplierTargetChatId}
 from '../base44/shared/assignmentWhatsApp.ts';
import {toChatId} from '../base44/shared/whatsappSend.ts';

const SERVICE='service-qa-test',SUPPLIER='supplier-qa-test';
const CHAT='972501234567@c.us',GROUP='12345678901234567890@g.us';
const supplier={id:SUPPLIER,phone:'0501234567',preferred_channel:'group',
 whatsapp_group_url:GROUP};
const key='assignment:'+SERVICE+':'+SUPPLIER+':r1:SUPPLIER_NEW_ASSIGNMENT';
function service(marked){
 return {id:SERVICE,assignment_intent_mode:'durable_v1',
  assignment_notification_intents:JSON.stringify([{
   supplier_id:SUPPLIER,revision:1,state:'requested',key,
   qa_buttons_required:marked===true
  }])};
}
const envSettings={
 GREEN_BUTTONS_QA_EVENT_SERVICE_ID:SERVICE,
 GREEN_BUTTONS_QA_SUPPLIER_ID:SUPPLIER,
 GREEN_BUTTONS_QA_ALLOWED_CHAT:CHAT
};
const env=k=>envSettings[k]||'';
test('ordinary assignments keep existing supplier group preference',()=>{
 const record=structuredClone(supplier);
 assert.equal(supplierTargetChatId(record,toChatId),GROUP);
 assert.equal(supplierAssignmentTargetChatId(record,service(false),
  SUPPLIER,toChatId,env),GROUP);
 assert.equal(record.preferred_channel,'group');
 assert.equal(record.whatsapp_group_url,GROUP);
});
test('durable one-chat QA marker can explicitly target private test phone without editing supplier',()=>{
 const record=structuredClone(supplier);
 const target=supplierAssignmentTargetChatId(record,service(true),
  SUPPLIER,toChatId,env,true);
 assert.equal(target,CHAT);
 assert.equal(record.preferred_channel,'group');
 assert.equal(record.whatsapp_group_url,GROUP);
});
test('mismatched provider-approved private chat, supplier or EventService cannot reach a group',()=>{
 for(const badEnv of [
  {GREEN_BUTTONS_QA_ALLOWED_CHAT:'972509999999@c.us'},
  {GREEN_BUTTONS_QA_SUPPLIER_ID:'supplier-other'},
  {GREEN_BUTTONS_QA_EVENT_SERVICE_ID:'service-other'},
  {GREEN_BUTTONS_QA_ALLOWED_CHAT:GROUP}
 ]){
  const envBad=k=>({...envSettings,...badEnv})[k]||'';
  assert.throws(()=>supplierAssignmentTargetChatId(supplier,
   service(true),SUPPLIER,toChatId,envBad,true),
   /qa_direct_recipient_scope_mismatch/);
 }
});
test('missing or stale durable QA marker fails closed when pilot was requested',()=>{
 assert.throws(()=>supplierAssignmentTargetChatId(supplier,
  service(false),SUPPLIER,toChatId,env,true),
  /pilot_notification_intent_marker_mismatch/);
});
