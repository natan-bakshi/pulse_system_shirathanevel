import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';
import * as pilot from '../base44/shared/legacyGreenPilotScope.ts';

const secret='signed-pilot-admin-backend-key-01234567890123456789';
const envConfig={
 WHATSAPP_INTERACTIVE_SIGNING_SECRET:secret,
 GREEN_BUTTONS_QA_ACCOUNT_VERIFIED:'verified',
 GREEN_BUTTONS_QA_OWNER_APPROVED:'approved',
 GREEN_BUTTONS_QA_SEND_ENABLED:'enabled',
 GREEN_BUTTONS_QA_INBOUND_ENABLED:'enabled',
 GREEN_BUTTONS_QA_SCOPED_V2_ENABLED:'enabled',
 GREEN_API_WEBHOOK_TOKEN:'fake-green-webhook-secret-01234567890123'
};
function fixture({owner=true,provider='green',group=false,ready=true}={}){
 const control={id:'control-111',control_key:'global',enabled:true,paused:false,
  interactive_outbound_live_enabled:true};
 const svc={id:'service-111111',event_id:'event-111111',is_external:false};
 const supplier={id:'supplier-111111',phone:'0501234567',is_active:true,
  whatsapp_enabled:true,preferred_channel:group?'group':'phone'};
 const stats={writes:0,businessWrites:0,providerCalls:0,readControl:0};
 let actor=owner?{role:'admin',email:'natib8000@gmail.com'}:
  {role:'admin',email:'not-owner@example.test'};
 let envValues={...envConfig};
 if(!ready)envValues.GREEN_BUTTONS_QA_ACCOUNT_VERIFIED='';
 const entities={
  WhatsAppQueueControl:{updateMany:async(q,p)=>{
   stats.writes++;
   if(q.id!==control.id||
    (q[pilot.LEGACY_GREEN_PILOT_FIELD]??null)!==(control[pilot.LEGACY_GREEN_PILOT_FIELD]??null))
    return {updated:0};
   Object.assign(control,p.$set);return {updated:1};
  }},
  EventService:{get:async id=>id===svc.id?structuredClone(svc):null,
   update:async()=>{stats.businessWrites++;throw Error('Forbidden business change')}},
  Supplier:{get:async id=>id===supplier.id?structuredClone(supplier):null},
  Event:{get:async id=>id===svc.event_id?{id,status:'closed'}:null}
 };
 const client={auth:{me:async()=>actor},asServiceRole:{entities}};
 let handler;
 const compiled=esbuild.transformSync(fs.readFileSync(
  'base44/functions/legacyGreenPilotAdmin/entry.ts','utf8'),{
   loader:'ts',format:'cjs',target:'es2022'
  }).code;
 const required={
  'npm:@base44/sdk@0.8.38':{createClientFromRequest:()=>client},
  '../../shared/whatsappOutbox.ts':{
   readWhatsAppQueueControl:async()=>{stats.readControl++;return structuredClone(control);}
  },
  '../../shared/whatsappProviderConfig.ts':{
   resolveWhatsAppProvider:async()=>provider
  },
  '../../shared/whatsappSend.ts':{
   toChatId:phone=>'972'+String(phone).slice(1)+'@c.us'
  },
  '../../shared/legacyGreenPilotScope.ts':pilot
 };
 vm.runInNewContext(compiled,{
  require:name=>{
   if(!(name in required))throw Error('Unexpected backend dependency '+name);
   return required[name];
  },
  module:{exports:{}},exports:{},
  Deno:{env:{get:key=>envValues[key]},serve:fn=>{handler=fn}},
  Response:{json:(body,{status=200}={})=>({body,status})},
  console:{error:()=>{}}
 });
 const call=(action,extra={},method='POST')=>handler({
  method,json:async()=>({action,...extra})
 });
 return {control,svc,supplier,stats,client,call,
  setActor:v=>{actor=v;},
  setEnv:(k,v)=>{envValues[k]=v}};
}
const identity=()=>({eventServiceId:'service-111111',
 supplierId:'supplier-111111',confirmation:pilot.LEGACY_GREEN_PILOT_CONFIRM});
test('only system owner can arm a single real assignment scope',async()=>{
 const f=fixture({owner:false});
 assert.equal((await f.call('arm',identity())).status,403);
 f.setActor({role:'supplier',email:'natib8000@gmail.com'});
 assert.equal((await f.call('arm',identity())).status,403);
 f.setActor({role:'admin',email:'natib8000@gmail.com'});
 assert.equal((await f.call('arm',{...identity(),confirmation:'untrusted'})).status,403);
 assert.equal(f.stats.writes,0);
 assert.equal(f.stats.businessWrites,0);
});
test('arm is a signed queue-control CAS only, never an assignment edit or WhatsApp send',async()=>{
 const f=fixture();
 const response=await f.call('arm',identity());
 assert.equal(response.status,200,JSON.stringify(response.body));
 assert.equal(response.body.active,true);
 assert.equal(response.body.noMessagesSent,true);
 assert.equal(response.body.noSupplierWrites,true);
 assert.equal(f.stats.writes,1);
 assert.equal(f.stats.businessWrites,0);
 const signed=f.control[pilot.LEGACY_GREEN_PILOT_FIELD];
 const decoded=await pilot.verifyLegacyGreenPilotState(signed,secret);
 assert.equal(decoded.active,true);
 assert.equal(decoded.current.eventServiceId,identity().eventServiceId);
 assert.equal(decoded.current.supplierId,identity().supplierId);
 assert.equal(decoded.current.chatId,'972501234567@c.us');
 const read=await f.call('status');
 assert.equal(read.status,200);
 assert.equal(read.body.active,true);
 assert.equal(f.stats.writes,1);
});
test('stop prevents new button sends but retains already issued signed inbound scope',async()=>{
 const f=fixture();
 assert.equal((await f.call('arm',identity())).status,200);
 const stopped=await f.call('stop');
 assert.equal(stopped.status,200);
 assert.equal(stopped.body.active,false);
 assert.equal(stopped.body.inboundHistoryPreserved,true);
 const parsed=await pilot.verifyLegacyGreenPilotState(
  f.control[pilot.LEGACY_GREEN_PILOT_FIELD],secret);
 assert.equal(pilot.outboundLegacyPilotTarget(parsed),null);
 assert.equal(pilot.inboundLegacyPilotTarget(parsed,'972501234567@c.us').supplierId,
  'supplier-111111');
 assert.equal(f.stats.businessWrites,0);
});
test('Green provider, private chat and verified capability are hard server-side gates',async()=>{
 for(const options of [{provider:'wasender'},{group:true},{ready:false}]){
  const f=fixture(options);
  const response=await f.call('arm',identity());
  assert.ok([409,423].includes(response.status),JSON.stringify(options));
  assert.equal(f.stats.writes,0);
 }
});
test('signed pilot is not reassigned to another service for same private phone before prior reply expiry',async()=>{
 const f=fixture();
 assert.equal((await f.call('arm',identity())).status,200);
 f.svc.id='service-222222';
 const rearm=await f.call('arm',{...identity(),eventServiceId:'service-222222'});
 assert.equal(rearm.status,409);
 assert.equal(f.stats.writes,1);
});
