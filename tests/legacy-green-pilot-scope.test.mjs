import test from 'node:test';
import assert from 'node:assert/strict';
import {
 pilotTarget,nextLegacyGreenPilotState,signLegacyGreenPilotState,
 verifyLegacyGreenPilotState,outboundLegacyPilotTarget,inboundLegacyPilotTarget
} from '../base44/shared/legacyGreenPilotScope.ts';
const secret='server-only-pilot-signing-key-for-offline-tests-0123456789';
const other='wrong-signing-key-for-offline-test-012345678901';
const t=Date.parse('2026-10-30T07:00:00.000Z');
const a=()=>pilotTarget('service-111111','supplier-111111','972501234567@c.us',t);
const b=()=>pilotTarget('service-222222','supplier-222222','972509999999@c.us',t+1000);

test('owner-signed pilot permits exactly one current outbound target',async()=>{
 const state=nextLegacyGreenPilotState(null,a(),t);
 const signed=await signLegacyGreenPilotState(state,secret,t);
 const read=await verifyLegacyGreenPilotState(signed,secret,t);
 assert.equal(read.active,true);
 assert.equal(outboundLegacyPilotTarget(read,t).eventServiceId,'service-111111');
 assert.equal(inboundLegacyPilotTarget(read,'972501234567@c.us',t).supplierId,'supplier-111111');
 assert.equal(inboundLegacyPilotTarget(read,'972509999999@c.us',t),null);
});
test('admin DB JSON tampering cannot switch phone, supplier, state or expiry without signing key',async()=>{
 const original=await signLegacyGreenPilotState(nextLegacyGreenPilotState(null,a(),t),secret,t);
 for(const patch of [
  obj=>{obj.payload.active=false;},
  obj=>{obj.payload.current.chatId='972509999999@c.us';},
  obj=>{obj.payload.current.supplierId='supplier-222222';},
  obj=>{obj.payload.current.expiresAt='2026-11-05T07:00:00.000Z';},
  obj=>{obj.payload.unsafe_handler='notify_all';}
 ]){
  const value=JSON.parse(original);patch(value);
  assert.equal(await verifyLegacyGreenPilotState(JSON.stringify(value),secret,t),null);
 }
 assert.equal(await verifyLegacyGreenPilotState(original,other,t),null);
});
test('stopping new sends retains the prior accepted-message inbound scope',async()=>{
 const armed=nextLegacyGreenPilotState(null,a(),t);
 const stopped=nextLegacyGreenPilotState(armed,null,t+1000);
 const encoded=await signLegacyGreenPilotState(stopped,secret,t+1000);
 const verified=await verifyLegacyGreenPilotState(encoded,secret,t+1000);
 assert.equal(outboundLegacyPilotTarget(verified,t+1000),null);
 assert.equal(inboundLegacyPilotTarget(verified,'972501234567@c.us',t+1000).supplierId,
  'supplier-111111');
 assert.equal(inboundLegacyPilotTarget(verified,'972501234567@c.us',t+49*3600000),null);
});
test('changing the pilot retains previous recipients inbound without sending new buttons to them',async()=>{
 const first=nextLegacyGreenPilotState(null,a(),t);
 const second=nextLegacyGreenPilotState(first,b(),t+1000);
 const signed=await signLegacyGreenPilotState(second,secret,t+1000);
 const verified=await verifyLegacyGreenPilotState(signed,secret,t+1000);
 assert.equal(outboundLegacyPilotTarget(verified,t+1000).eventServiceId,'service-222222');
 assert.equal(inboundLegacyPilotTarget(verified,'972501234567@c.us',t+1000).eventServiceId,'service-111111');
 assert.equal(inboundLegacyPilotTarget(verified,'972509999999@c.us',t+1000).eventServiceId,'service-222222');
 assert.equal(verified.previous.length,1);
});
test('invalid or unsigned pilot scope never authorizes a send',async()=>{
 for(const raw of ['{invalid','{}',JSON.stringify({active:true}),123]){
  assert.equal(await verifyLegacyGreenPilotState(raw,secret,t),null);
 }
 assert.throws(()=>pilotTarget('not valid','supplier-111111','972501234567@c.us',t));
 assert.throws(()=>pilotTarget('service-111111','supplier-111111','972501234567@g.us',t));
 assert.equal(await verifyLegacyGreenPilotState(undefined,secret,t),null);
});
