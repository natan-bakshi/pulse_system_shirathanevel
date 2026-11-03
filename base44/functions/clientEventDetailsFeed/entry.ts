import {createClientFromRequest} from 'npm:@base44/sdk@0.8.52';
import {readClientEventDetailsFeed} from '../../shared/clientEventDetailsFeed.ts';

// Authenticated read-only, minimum necessary client event projection.
Deno.serve(async (req) => {
  const headers = {'Cache-Control': 'no-store', 'Vary': 'Authorization'};
  if (req.method !== 'POST')
    return Response.json({error:'Method not allowed'}, {status:405,headers});
  try {
    const client = createClientFromRequest(req);
    const user = await client.auth.me();
    if (!user) return Response.json({error:'Unauthorized'},{status:401,headers});
    const body = await req.json().catch(()=>null);
    if (!body || Array.isArray(body) || typeof body !== 'object' ||
        Object.keys(body).join(',') !== 'eventId')
      return Response.json({error:'Invalid request'},{status:400,headers});
    const result = await readClientEventDetailsFeed(client,user,body.eventId);
    return Response.json({success:true,...result},{headers});
  } catch (error) {
    const status = Number(error?.status) || 500;
    const safeStatus = [400,403,404,503].includes(status) ? status : 500;
    return Response.json({error:
      safeStatus===404?'Event not available':
      safeStatus===403?'Forbidden':
      safeStatus===400?'Invalid request':'Unable to load event details'
    },{status:safeStatus,headers});
  }
});
