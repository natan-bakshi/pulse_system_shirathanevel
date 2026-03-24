import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (user.google_calendar_access_token) {
            const now = new Date();
            const expiry = user.google_calendar_token_expiry ? new Date(user.google_calendar_token_expiry) : null;
            
            if (!expiry || expiry > now) {
                return Response.json({ connected: true });
            }
            
            if (user.google_calendar_refresh_token) {
                try {
                    const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
                    const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
                    
                    const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            refresh_token: user.google_calendar_refresh_token,
                            client_id: clientId,
                            client_secret: clientSecret,
                            grant_type: 'refresh_token'
                        })
                    });

                    if (refreshResponse.ok) {
                        const tokens = await refreshResponse.json();
                        
                        await base44.asServiceRole.entities.User.update(user.id, {
                            google_calendar_access_token: tokens.access_token,
                            google_calendar_token_expiry: new Date(Date.now() + (tokens.expires_in * 1000)).toISOString()
                        });
                        
                        return Response.json({ connected: true });
                    }
                } catch (refreshError) {
                    console.error("Token refresh failed:", refreshError);
                }
            }
        }
        
        return Response.json({ connected: false });
    } catch (error) {
        console.error("Error checking calendar connection:", error);
        return Response.json({ connected: false });
    }
});