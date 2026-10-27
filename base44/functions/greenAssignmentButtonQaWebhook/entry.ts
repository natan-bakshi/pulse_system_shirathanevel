import {createClientFromRequest} from 'npm:@base44/sdk@0.8.38';
import {handleGreenButtonQaWebhook}
 from '../../shared/greenButtonQaWebhookHandler.ts';
import {recalculateEventStatus}
 from '../../shared/eventReadiness.ts';

// Dedicated TEST-CHAT receiver only. Published code is inert by default:
// four explicit env approvals + owner's disabled-by-default queue control
// are required before any inbound DB read. Never configure the sole Green
// webhookUrl to this endpoint without independently verified safe fanout to
// all existing provider status and manual-chat consumers.
// No logging or response of Green payloads, contacts or tokens.
Deno.serve(async req=>{
 const planned=await handleGreenButtonQaWebhook(req,{
  env:key=>Deno.env.get(key),
  makeClient:request=>createClientFromRequest(request),
  recalculateEventStatus:(client,eventId)=>
   recalculateEventStatus(client.asServiceRole,eventId)
 });
 return Response.json(planned.body,{
  status:planned.httpStatus,
  headers:{'Cache-Control':'no-store'}
 });
});
