import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { file_uri, expires_in } = await req.json();

        if (!file_uri) {
            return Response.json({ error: 'Missing required parameter: file_uri' }, { status: 400 });
        }

        const result = await base44.integrations.Core.CreateFileSignedUrl({
            file_uri: file_uri,
            expires_in: expires_in || 3600
        });

        return Response.json({ signed_url: result.signed_url });
    } catch (error) {
        console.error('createSignedUrl error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});