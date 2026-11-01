import {createClientFromRequest} from 'npm:@base44/sdk@0.8.52';
import {readSupplierEventView} from '../../shared/supplierEventAccess.ts';

// Authenticated, read-only projection for a supplier event deep link.
// Event IDs are not capabilities: the session must still prove supplier
// membership in the event's current assignment records.
Deno.serve(async (req)=>{
 if(req.method!=='POST')return Response.json({error:'Method not allowed'},
  {status:405,headers:{'Cache-Control':'no-store'}});
 try{
  const client=createClientFromRequest(req);
  const user=await client.auth.me();
  if(!user)return Response.json({error:'Unauthorized'},
   {status:401,headers:{'Cache-Control':'no-store'}});
  const body=await req.json().catch(()=>({}));
  if(!body||typeof body!=='object'||Array.isArray(body)||
   Object.keys(body).join(',')!=='eventId')
   return Response.json({error:'Invalid request'},
    {status:400,headers:{'Cache-Control':'no-store'}});
  const event=await readSupplierEventView(client,user,body.eventId);
  return Response.json({success:true,event},{
   headers:{'Cache-Control':'private, no-store, max-age=0','Vary':'Authorization'}
  });
 }catch(error){
  const status=(error as any)?.status===404?404:500;
  if(status===500)console.warn('[supplierEventView] failed to prepare scoped view');
  return Response.json({error:status===404?'Event not available':'Unable to load event'},
   {status,headers:{'Cache-Control':'no-store'}});
 }
});
