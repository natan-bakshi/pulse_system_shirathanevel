import {createClientFromRequest} from 'npm:@base44/sdk@0.8.52';
import {readClientDashboardFeed} from '../../shared/clientDashboardFeed.ts';

// Client-facing event+balance cards without broad Event/EventService reads.
// All authorization and finance summaries are computed server-side.
// No event IDs, filters, roles or selected columns are accepted in JSON.
Deno.serve(async req=>{
 const headers={'Cache-Control':'private, no-store, max-age=0',
  'Vary':'Authorization'};
 if(req.method!=='POST')
  return Response.json({error:'Method not allowed'},{status:405,headers});
 try{
  const client=createClientFromRequest(req);
  const user=await client.auth.me().catch(()=>null);
  if(!user)return Response.json({error:'Unauthorized'},{status:401,headers});
  const body=await req.json().catch(()=>null);
  if(!body||typeof body!=='object'||Array.isArray(body)||
   Object.keys(body).length!==0)
   return Response.json({error:'Invalid request'},{status:400,headers});
  const data=await readClientDashboardFeed(client,user);
  return Response.json({success:true,...data},{headers});
 }catch(e){
  const status=(e as any)?.status===403?403:
   (e as any)?.status===503?503:500;
  if(status===500)console.warn('[clientDashboardFeed] projection failed');
  return Response.json({error:status===403?'Forbidden':'Unable to load client events'},
   {status,headers});
 }
});
