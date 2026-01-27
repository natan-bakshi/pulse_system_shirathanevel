import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const url = new URL(req.url);
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        if (error) {
            return new Response(`
                <!DOCTYPE html>
                <html dir="rtl">
                <head><meta charset="UTF-8"><title>חיבור בוטל</title></head>
                <body style="font-family: Arial; text-align: center; padding: 50px;">
                    <h2>חיבור יומן Google בוטל</h2>
                    <p>תוכל לנסות שוב מההגדרות</p>
                    <p style="color: #666; margin-top: 20px;">ניתן לסגור חלון זה</p>
                    <script>
                        try {
                            // 1. Storage
                            localStorage.setItem('google_auth_result', JSON.stringify({ type: 'cancelled', timestamp: Date.now() }));
                            
                            // 2. Direct message
                            if (window.opener) {
                                window.opener.postMessage({ type: 'GOOGLE_AUTH_CANCELLED' }, 'https://pulse-system.base44.app');
                            }
                        } catch (e) { console.error('Communication error:', e); }
                        
                        try { window.close(); } catch (e) { console.error('Error closing window:', e); }
                    </script>
                </body>
                </html>
            `, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }

        if (!code || !state) {
            return new Response(`
                <!DOCTYPE html>
                <html dir="rtl">
                <head><meta charset="UTF-8"><title>שגיאה</title></head>
                <body style="font-family: Arial; text-align: center; padding: 50px;">
                    <h2 style="color: red;">שגיאה בחיבור</h2>
                    <p>חסרים פרמטרים נדרשים</p>
                    <p style="color: #666; margin-top: 20px;">ניתן לסגור חלון זה</p>
                    <script>
                        try {
                            // 1. Storage
                            localStorage.setItem('google_auth_result', JSON.stringify({ type: 'error', message: 'Missing parameters', timestamp: Date.now() }));
                            
                            // 2. Direct message
                            if (window.opener) {
                                window.opener.postMessage({ type: 'GOOGLE_AUTH_ERROR', message: 'Missing parameters' }, 'https://pulse-system.base44.app');
                            }
                        } catch (e) { console.error('Communication error:', e); }
                        
                        try { window.close(); } catch (e) { console.error('Error closing window:', e); }
                    </script>
                </body>
                </html>
            `, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }

        const userId = state;
        const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
        const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
        const redirectUri = `https://pulse-system.base44.app/callback/google-oauth`;

        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code: code,
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code'
            })
        });

        if (!tokenResponse.ok) {
            const errorData = await tokenResponse.text();
            console.error("Token exchange failed:", errorData);
            
            return new Response(`
                <!DOCTYPE html>
                <html dir="rtl">
                <head><meta charset="UTF-8"><title>שגיאה</title></head>
                <body style="font-family: Arial; text-align: center; padding: 50px;">
                    <h2 style="color: red;">שגיאה בחיבור יומן Google</h2>
                    <p>נכשל בהחלפת הקוד לטוקן</p>
                    <p style="color: #666; margin-top: 20px;">ניתן לסגור חלון זה</p>
                    <script>
                        try {
                            // 1. Storage
                            localStorage.setItem('google_auth_result', JSON.stringify({ type: 'error', message: 'Token exchange failed', timestamp: Date.now() }));
                            
                            // 2. Direct message
                            if (window.opener) {
                                window.opener.postMessage({ type: 'GOOGLE_AUTH_ERROR', message: 'Token exchange failed' }, 'https://pulse-system.base44.app');
                            }
                        } catch (e) { console.error('Communication error:', e); }
                        
                        try { window.close(); } catch (e) { console.error('Error closing window:', e); }
                    </script>
                </body>
                </html>
            `, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }

        const tokens = await tokenResponse.json();
        
        const base44 = createClientFromRequest(req);
        
        await base44.asServiceRole.entities.User.update(userId, {
            google_calendar_access_token: tokens.access_token,
            google_calendar_refresh_token: tokens.refresh_token,
            google_calendar_token_expiry: new Date(Date.now() + (tokens.expires_in * 1000)).toISOString()
        });

        return new Response(`
            <!DOCTYPE html>
            <html dir="rtl">
            <head>
                <meta charset="UTF-8">
                <title>יומן Google מחובר</title>
                <style>
                    body { font-family: Arial; text-align: center; padding: 50px; background: #f5f5f5; }
                    .success { background: white; padding: 40px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 400px; margin: 0 auto; }
                    h2 { color: #22c55e; }
                    .message { color: #666; margin: 10px 0; }
                    button { margin-top: 20px; padding: 10px 20px; background: #22c55e; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 16px; }
                    button:hover { background: #16a34a; }
                </style>
            </head>
            <body>
                <div class="success">
                    <h2>✓ יומן Google מחובר בהצלחה!</h2>
                    <p class="message">החיבור הושלם. ניתן לסגור חלון זה.</p>
                    <button onclick="window.close()">סגור חלון</button>
                </div>
                <script>
                    // Handshake mechanism
                    const SUCCESS_MSG = { type: 'GOOGLE_AUTH_SUCCESS', status: 'success' };
                    let ackReceived = false;

                    function notifyParent() {
                        if (ackReceived) return;

                        // 1. Storage (Backup)
                        try {
                            localStorage.setItem('google_auth_result', JSON.stringify({ type: 'success', timestamp: Date.now() }));
                        } catch (e) { console.error('Storage error:', e); }

                        // 2. PostMessage Loop (Primary Handshake)
                        if (window.opener) {
                            console.log("Posting SUCCESS message to opener...");
                            window.opener.postMessage(SUCCESS_MSG, 'https://pulse-system.base44.app');
                        } else {
                            console.warn("window.opener is null");
                        }
                    }

                    window.addEventListener('load', function() {
                        // Listen for ACK
                        window.addEventListener('message', (event) => {
                            if (event.data && event.data.type === 'GOOGLE_AUTH_ACK') {
                                console.log("ACK received from parent. Closing...");
                                ackReceived = true;
                                window.close();
                            }
                        });

                        // Start loop
                        notifyParent();
                        const intervalId = setInterval(notifyParent, 1000);

                        // Fallback close after 10 seconds if no ACK
                        setTimeout(() => {
                            if (!ackReceived) {
                                console.warn("No ACK received in 10s, forcing close.");
                                window.close();
                            }
                        }, 10000);
                    });
                </script>
            </body>
            </html>
        `, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

    } catch (error) {
        console.error("Callback error:", error);
        return new Response(`
            <!DOCTYPE html>
            <html dir="rtl">
            <head><meta charset="UTF-8"><title>שגיאה</title></head>
            <body style="font-family: Arial; text-align: center; padding: 50px;">
                <h2 style="color: red;">שגיאה בחיבור יומן Google</h2>
                <p>${error.message}</p>
                <p style="color: #666; margin-top: 20px;">ניתן לסגור חלון זה</p>
                <script>
                    try {
                        // 1. Storage
                        localStorage.setItem('google_auth_result', JSON.stringify({ type: 'error', message: 'General error', timestamp: Date.now() }));
                        
                        // 2. Direct message
                        if (window.opener) {
                            window.opener.postMessage({ type: 'GOOGLE_AUTH_ERROR', message: '${error.message}' }, 'https://pulse-system.base44.app');
                        }
                    } catch (e) { console.error('Communication error:', e); }
                    
                    try { window.close(); } catch (e) { console.error('Error closing window:', e); }
                </script>
            </body>
            </html>
        `, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
});