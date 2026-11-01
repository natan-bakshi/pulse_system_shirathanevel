import {createClientFromRequest} from 'npm:@base44/sdk@0.8.52';
import {canOpenClientEventCard} from '../../shared/clientEventLinkAccess.ts';

const ID=/^[A-Za-z0-9_-]{3,100}$/;
Deno.serve(async(req)=>{
 if(req.method!=='POST')return Response.json({allowed:false},
  {status:405,headers:{'Cache-Control':'no-store'}});
 try{
  const client=createClientFromRequest(req);
  const user=await client.auth.me();
  if(!user)return Response.json({allowed:false},
   {status:401,headers:{'Cache-Control':'no-store'}});
  const body=await req.json().catch(()=>({}));
  if(!body||Object.keys(body).join(',')!=='eventId'||
   typeof body.eventId!=='string'||!ID.test(body.eventId))
   return Response.json({allowed:false},{status:400,headers:{'Cache-Control':'no-store'}});
  if(user.role==='admin')return Response.json({allowed:true},
   {headers:{'Cache-Control':'no-store'}});
  if(user.user_type!=='client')return Response.json({allowed:false},
   {status:404,headers:{'Cache-Control':'no-store'}});
  const event=await client.asServiceRole.entities.Event.get(body.eventId).catch(()=>null);
  if(!event)return Response.json({allowed:false},
   {status:404,headers:{'Cache-Control':'no-store'}});
  const allowed=canOpenClientEventCard(user,event);
  return Response.json({allowed},{status:allowed?200:404,
   headers:{'Cache-Control':'private,no-store','Vary':'Authorization'}});
 }catch{
  return Response.json({allowed:false},{status:500,
   headers:{'Cache-Control':'no-store'}});
 }
});
