import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const url = new URL(req.url);
    const quoteId = url.searchParams.get('id');

    if (!quoteId) {
      return new Response("Quote ID is required.", { 
        status: 400,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }

    const quote = await base44.asServiceRole.entities.EventQuote.get(quoteId);

    if (!quote || !quote.html_content) {
      return new Response("Quote not found.", { 
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }

    return new Response(quote.html_content, {
      status: 200,
      headers: { 
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=3600'
      }
    });

  } catch (error) {
    console.error('Error in viewQuote:', error);
    return new Response(`Error fetching quote: ${error.message}`, { 
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
});