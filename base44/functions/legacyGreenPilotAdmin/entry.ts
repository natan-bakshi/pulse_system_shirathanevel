// System-owner ONLY, manual single-scope pilot management.
// This endpoint never changes EventService, sends WhatsApp, edits secrets,
// or changes the existing queue provider/pacing. Stopping NEW pilot sends
// preserves signed inbound scope for buttons already accepted by Green.
import {createClientFromRequest} from 'npm:@base44/sdk@0.8.38';
import {readWhatsAppQueueControl} from '../../shared/whatsappOutbox.ts';
import {resolveWhatsAppProvider} from '../../shared/whatsappProviderConfig.ts';
import {toChatId} from '../../shared/whatsappSend.ts';
import {
 LEGACY_GREEN_PILOT_FIELD,LEGACY_GREEN_PILOT_CONFIRM,pilotTarget,
 signLegacyGreenPilotState,verifyLegacyGreenPilotState,
 nextLegacyGreenPilotState,outboundLegacyPilotTarget
} from '../../shared/legacyGreenPilotScope.ts';

const OWNER='natib8000@gmail.com';
const ID=/^[A-Za-z0-9_-]{3,100}$/;
const PRIVATE=/^[1-9][0-9]{7,14}@c\.us$/;
const reply=(body:any,status=200)=>Response.json(body,{status,
 headers:{'Cache-Control':'no-store'}});
Deno.serve(async(req)=>{
 if(req.method!=='POST')return reply({success:false,error:'Method not allowed'},405);
 try{
  const client=createClientFromRequest(req);
  const user=await client.auth.me().catch(()=>null);
  if(user?.role!=='admin'||String(user.email||'').trim().toLowerCase()!==OWNER)
   return reply({success:false,error:'System owner required'},403);
  const body=await req.json().catch(()=>({}));
  if(!['status','arm','stop'].includes(body.action))
   return reply({success:false,error:'Invalid pilot action'},400);
  const signingSecret=Deno.env.get('WHATSAPP_INTERACTIVE_SIGNING_SECRET')||'';
  if(signingSecret.length<32)
   return reply({success:false,error:'Signing protection unavailable'},503);
  const control=await readWhatsAppQueueControl(client);
  const raw=control[LEGACY_GREEN_PILOT_FIELD];
  const previous=await verifyLegacyGreenPilotState(raw,signingSecret);
  if(raw&& !previous)
   return reply({success:false,error:'Pilot settings require owner review'},409);
  const present=()=>({
   success:true,active:!!outboundLegacyPilotTarget(previous),
   hasConfiguredScope:!!previous?.current,
   expiresAt:previous?.current?.expiresAt||null,
   // No phone or supplier identity is exposed in general queue settings.
   noMessagesSent:true,noSupplierWrites:true,noProviderRequests:true
  });
  if(body.action==='status')return reply(present());
  const db=client.asServiceRole.entities;
  const now=Date.now();
  if(body.action==='arm'){
   if(body.confirmation!==LEGACY_GREEN_PILOT_CONFIRM)
    return reply({success:false,error:'Owner confirmation required'},403);
   if(!ID.test(body.eventServiceId||'')||!ID.test(body.supplierId||''))
    return reply({success:false,error:'Select exactly one service and supplier'},400);
   if(control.enabled!==true||control.paused===true||
    control.interactive_outbound_live_enabled!==true)
    return reply({success:false,error:'Interactive queue approval is not active'},423);
   const env=(key:string)=>Deno.env.get(key)||'';
   if(env('GREEN_BUTTONS_QA_ACCOUNT_VERIFIED')!=='verified'||
      env('GREEN_BUTTONS_QA_OWNER_APPROVED')!=='approved'||
      env('GREEN_BUTTONS_QA_SEND_ENABLED')!=='enabled'||
      env('GREEN_BUTTONS_QA_INBOUND_ENABLED')!=='enabled'||
      env('GREEN_BUTTONS_QA_SCOPED_V2_ENABLED')!=='enabled'||
      env('GREEN_API_WEBHOOK_TOKEN').length<24)
    return reply({success:false,error:'Existing verified Green button pilot not fully ready'},423);
   if(await resolveWhatsAppProvider(client)!=='green')
    return reply({success:false,error:'Green must be the selected WhatsApp provider'},423);
   const [service,supplier]=await Promise.all([
    db.EventService.get(body.eventServiceId).catch(()=>null),
    db.Supplier.get(body.supplierId).catch(()=>null)
   ]);
   if(!service||service.is_external===true||!supplier||
     supplier.is_active===false||supplier.whatsapp_enabled===false||
     supplier.preferred_channel==='group')
    return reply({success:false,error:'Service and personal supplier must be eligible'},409);
   const event=await db.Event.get(service.event_id).catch(()=>null);
   if(!event||['cancelled','completed'].includes(event.status))
    return reply({success:false,error:'Event is not eligible'},409);
   const chatId=toChatId(String(supplier.phone||''));
   if(!PRIVATE.test(chatId))
    return reply({success:false,error:'Supplier has no verified private WhatsApp destination'},409);
   const next=nextLegacyGreenPilotState(previous,
    pilotTarget(service.id,supplier.id,chatId,now),now);
   const signed=await signLegacyGreenPilotState(next,signingSecret,now);
   const changed=await db.WhatsAppQueueControl.updateMany({
    id:control.id,control_key:'global',
    [LEGACY_GREEN_PILOT_FIELD]:raw??null
   },{$set:{[LEGACY_GREEN_PILOT_FIELD]:signed}});
   if(changed?.updated!==1)
    return reply({success:false,error:'Pilot changed concurrently; refresh'},409);
   return reply({success:true,active:true,expiresAt:next.current!.expiresAt,
    noMessagesSent:true,noSupplierWrites:true,noProviderRequests:true});
  }
  if(!previous||!previous.active)return reply(present());
  const next=nextLegacyGreenPilotState(previous,null,now);
  const signed=await signLegacyGreenPilotState(next,signingSecret,now);
  const changed=await db.WhatsAppQueueControl.updateMany({
   id:control.id,control_key:'global',[LEGACY_GREEN_PILOT_FIELD]:raw??null
  },{$set:{[LEGACY_GREEN_PILOT_FIELD]:signed}});
  if(changed?.updated!==1)
   return reply({success:false,error:'Pilot changed concurrently; refresh'},409);
  return reply({success:true,active:false,inboundHistoryPreserved:true,
   expiresAt:next.current?.expiresAt||null,noMessagesSent:true,
   noSupplierWrites:true,noProviderRequests:true});
 }catch(error){
  console.error('[LegacyGreenPilotAdmin] operation unavailable',
   error instanceof Error?error.name:'unknown');
  return reply({success:false,error:'Pilot settings unavailable'},503);
 }
});
