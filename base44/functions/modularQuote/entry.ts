import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { composeModularQuoteHtml } from '../../shared/modularQuote.ts';

export default async function(req) {
  try {
    const client = createClientFromRequest(req);
    const body = await req.json();
    const headers = {'Cache-Control':'no-store'};
    if (body.action === 'view' || body.action === 'download') {
      if (typeof body.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token)) return Response.json({error:'הקישור אינו תקין'},{status:404,headers});
      const quotes = await client.asServiceRole.entities.ModularQuote.filter({share_token:body.token},'-created_date',1);
      const quote = quotes[0];
      if (!quote) return Response.json({error:'ההצעה אינה זמינה או שהקישור בוטל'},{status:404,headers});
      if (body.action === 'download') {
        if (!quote.last_pdf_uri) return Response.json({error:'טרם הופק PDF להצעה'},{status:404,headers});
        const result = await client.asServiceRole.integrations.Core.CreateFileSignedUrl({file_uri:quote.last_pdf_uri,expires_in:300});
        return Response.json({signed_url:result.signed_url},{headers});
      }
      const result = await composeModularQuoteHtml(quote,client);
      return Response.json({html:result.html,has_pdf:!!quote.last_pdf_uri},{headers});
    }
    const user = await client.auth.me();
    if (user?.role !== 'admin') return Response.json({error:'למנהלים בלבד'},{status:403,headers});
    if (body.action === 'preview') {
      if (!body.content || typeof body.content !== 'object' || Array.isArray(body.content)) return Response.json({error:'תוכן חסר'},{status:400,headers});
      const result = await composeModularQuoteHtml({content:body.content},client);
      return Response.json({html:result.html},{headers});
    }
    if (body.action === 'share') {
      if (typeof body.id !== 'string' || !body.id) return Response.json({error:'מזהה הצעה חסר'},{status:400,headers});
      const quote = await client.entities.ModularQuote.get(body.id);
      if (!quote) return Response.json({error:'ההצעה לא נמצאה'},{status:404,headers});
      const token = quote.share_token || Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b=>b.toString(16).padStart(2,'0')).join('');
      if (!quote.share_token) await client.entities.ModularQuote.update(quote.id,{share_token:token});
      return Response.json({url:`https://pulse-system.base44.app/ModularQuoteView?quote=${token}`},{headers});
    }
    return Response.json({error:'פעולה לא מוכרת'},{status:400,headers});
  } catch(error) {
    return Response.json({error:error.message},{status:500,headers:{'Cache-Control':'no-store'}});
  }
}