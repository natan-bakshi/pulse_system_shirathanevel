import {createClientFromRequest} from 'npm:@base44/sdk@0.8.52';
import {readSupplierAssignmentsFeed}
 from '../../shared/supplierAssignmentsFeed.ts';

// Authenticated supplier dashboard/calendar feed. Server-side verification
// produces only the current supplier's read-only allowlisted assignment data.
// Never accept supplier IDs, event IDs, company IDs, requested fields or
// arbitrary filters from the browser. No writes, sends, cron or polling.
Deno.serve(async req=>{
 const headers={'Cache-Control':'private, no-store, max-age=0',
  'Vary':'Authorization'};
 if(req.method!=='POST')return Response.json({error:'Method not allowed'},
  {status:405,headers});
 try{
  const client=createClientFromRequest(req);
  const user=await client.auth.me().catch(()=>null);
  if(!user)return Response.json({error:'Unauthorized'},
   {status:401,headers});
  const body=await req.json().catch(()=>null);
  if(!body||typeof body!=='object'||Array.isArray(body)||
   Object.keys(body).length!==0)
   return Response.json({error:'Invalid request'},{status:400,headers});
  const data=await readSupplierAssignmentsFeed(client,user);
  return Response.json({success:true,...data},{headers});
 }catch(error){
  const code=(error as any)?.status===403?403:
   (error as any)?.status===503?503:500;
  // Prior 503 failures were silent in production, making supplier incidents
  // impossible to distinguish from connectivity issues. Log ONLY a fixed
  // error category (no IDs, names, event content or raw exception strings).
  if(code>=500){
   const categories=new Set([
    'supplier_feed_scoped_query_failed','supplier_feed_scope_mismatch',
    'supplier_feed_too_many_assignments','supplier_feed_event_limit',
    'supplier_feed_scan_limit','supplier_feed_unavailable',
    'supplier_feed_event_scope_mismatch','supplier_feed_incomplete_event_page'
   ]);
   const category=categories.has(error?.code)?error.code:'backend_unavailable';
   console.warn('[supplierAssignmentsFeed] status='+code+' category='+category);
  }
  return Response.json({error:code===403?'Forbidden':'Unable to load assignments'},
   {status:code,headers});
 }
});
