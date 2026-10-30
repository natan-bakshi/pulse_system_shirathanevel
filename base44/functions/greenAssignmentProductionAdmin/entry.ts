// System-owner only emergency switch for already verified Green interactive
// assignment delivery. Never creates a notification or changes a supplier.
import {createClientFromRequest} from 'npm:@base44/sdk@0.8.38';
import {readWhatsAppQueueControl} from '../../shared/whatsappOutbox.ts';
import {trustedGreenButtonQaConfig} from '../../shared/greenButtonQaLaunch.ts';
import {resolveWhatsAppProvider} from '../../shared/whatsappProviderConfig.ts';
const OWNER='natib8000@gmail.com';
Deno.serve(async req=>{
 if(req.method!=='POST')return Response.json({success:false},{status:405});
 try{
  const client=createClientFromRequest(req);
  const actor=await client.auth.me().catch(()=>null);
  if(actor?.role!=='admin'||String(actor.email||'').trim().toLowerCase()!==OWNER)
   return Response.json({success:false,error:'Owner only'},{status:403});
  const body=await req.json().catch(()=>({}));
  if(!['status','enable','disable'].includes(body.action))
   return Response.json({success:false,error:'Invalid action'},{status:400});
  const db=client.asServiceRole.entities.WhatsAppQueueControl;
  const control=await readWhatsAppQueueControl(client);
  const enabled=control.interactive_assignment_production_enabled===true;
  const status=()=>({success:true,enabled,
   inboundHistoricalEnabled:control.interactive_assignment_production_ever_enabled===true,
   newMessagesSent:0});
  if(body.action==='status')return Response.json(status());
  if(body.action==='enable'){
   if(body.confirmation!=='ENABLE_GREEN_ASSIGNMENT_BUTTONS_FOR_ALL_NEW_ASSIGNMENTS')
    return Response.json({success:false,error:'Explicit owner approval required'},{status:403});
   if(control.enabled!==true||control.paused===true||
    control.interactive_outbound_live_enabled!==true)
    return Response.json({success:false,error:'WhatsApp queue cannot send interactive messages'},{status:409});
   const config=trustedGreenButtonQaConfig(control,k=>Deno.env.get(k),true);
   if(!config||config.accountCapabilityVerified!==true||
      Deno.env.get('GREEN_BUTTONS_QA_INBOUND_ENABLED')!=='enabled')
    return Response.json({success:false,error:'Verified Green interactive sending and callback are not ready'},{status:409});
   if(await resolveWhatsAppProvider(client)!=='green')
    return Response.json({success:false,error:'Green is not the active provider'},{status:409});
  }
  if(enabled===(body.action==='enable'))return Response.json(status());
  const updated=await db.updateMany({
   id:control.id,control_key:'global',
   interactive_assignment_production_enabled:control.interactive_assignment_production_enabled??null
  },{$set:{
   interactive_assignment_production_enabled:body.action==='enable',
   ...(body.action==='enable'?{interactive_assignment_production_ever_enabled:true}:{})
  }});
  if(updated?.updated!==1)
   return Response.json({success:false,error:'Concurrent change: refresh'}, {status:409});
  return Response.json({success:true,enabled:body.action==='enable',
   inboundHistoricalEnabled:true,newMessagesSent:0});
 }catch(error){
  console.error('[GreenAssignmentProduction] owner switch unavailable');
  return Response.json({success:false,error:'Production button switch unavailable'},{status:503});
 }
});
