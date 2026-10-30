import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';
import {
 LEGACY_GREEN_PILOT_FIELD,LEGACY_GREEN_PILOT_CONFIRM,
 verifyLegacyGreenPilotState,inboundLegacyPilotTarget
} from '../base44/shared/legacyGreenPilotScope.ts';

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
 const stats={writes:0,providerCalls:0,businessWrites:0,settingsReads:0};
 let actor=owner?{role:'admin',email:'natib8000@gmail.com'}:
  {role:'admin',email:'not-owner@example.test'};
 let envValues={...envConfig};
 if(!ready)envValues.GREEN_BUTTONS_QA_ACCOUNT_VERIFIED='';
 const entities={
  WhatsAppQueueControl:{updateMany:async(q,p)=>{
   stats.writes++;
   if(q.id!==control.id||
    (q[LEGACY_GREEN_PILOT_FIELD]??null)!==(control[LEGACY_GREEN_PILOT_FIELD]??null))
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
   readWhatsAppQueueControl:async()=>structuredClone(control)
  },
  '../../shared/whatsappProviderConfig.ts':{
   resolveWhatsAppProvider:async()=>provider
  },
  '../../shared/whatsappSend.ts':{
   toChatId:phone=>'972'+String(phone).slice(1)+'@c.us'
  },
  '../../shared/legacyGreenPilotScope.ts':awaitImport()
 };
 function awaitImport(){
  // Only code under test provides signing policy; no UI values can forge it.
  return namespace;
 }
 vm.runInNewContext(compiled,{
  require:name=>{
   if(!(name in required))throw Error('Unexpected backend dependency '+name);
   return required[name];
  },
  module:{exports:{}},exports:{},
  Deno:{env:{get:key=>envValues[key]}},
  Response:{json:(body,{status=200}={})=>({body,status})},
  console:{error:()=>{}}
 });
 // Deno.serve must register the handler. A separate context below captures it.
 return {control,svc,supplier,stats,client,
  get handler(){return handler;},setActor:v=>{actor=v;},
  setEnv:(k,v)=>{envValues[k]=v}};
}
