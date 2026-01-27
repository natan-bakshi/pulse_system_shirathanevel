import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
        const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
        const appId = Deno.env.get('BASE44_APP_ID');

        if (!clientId || !clientSecret) {
            return Response.json({ error: 'Google OAuth credentials not configured' }, { status: 500 });
        }

        const redirectUri = `https://pulse-system.base44.app/callback/google-oauth`;
        
        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        authUrl.searchParams.append('client_id', clientId);
        authUrl.searchParams.append('redirect_uri', redirectUri);
        authUrl.searchParams.append('response_type', 'code');
        authUrl.searchParams.append('scope', 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email');
        authUrl.searchParams.append('access_type', 'offline');
        authUrl.searchParams.append('prompt', 'consent');
        authUrl.searchParams.append('state', user.id);

        return Response.json({ authUrl: authUrl.toString() });
    } catch (error) {
        console.error("Error generating OAuth URL:", error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});