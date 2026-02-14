import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Sends a WhatsApp message directly via Green API.
 * Independent of User entity or In-App Notifications.
 * Expects a raw phone number and message content.
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Authorization check (Service Role or Admin)
        // We allow service role calls (from handleEntityEvents)
        
        const payload = await req.json();
        const { phone, message, file_url } = payload;

        if (!phone || !message) {
            return Response.json({ success: false, error: 'Missing phone or message' }, { status: 400 });
        }

        const GREEN_API_INSTANCE_ID = Deno.env.get("GREEN_API_INSTANCE_ID");
        const GREEN_API_TOKEN = Deno.env.get("GREEN_API_TOKEN");

        if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) {
            console.error('[SendWhatsApp] Missing Green API Credentials');
            return Response.json({ success: false, error: 'Configuration Error' }, { status: 500 });
        }

        // Normalize Phone Number
        // Remove non-digits
        let cleanPhone = phone.toString().replace(/[^0-9]/g, '');
        
        // Handle Israeli numbers (05X) -> 9725X
        if (cleanPhone.startsWith('05')) {
            cleanPhone = '972' + cleanPhone.substring(1);
        } 
        // Handle numbers without country code but 9 digits (rare, but safety net)
        else if (cleanPhone.length === 9 && cleanPhone.startsWith('5')) {
            cleanPhone = '972' + cleanPhone;
        }

        const chatId = `${cleanPhone}@c.us`;

        console.log(`[SendWhatsApp] Sending to ${chatId}`);

        let apiMethod = 'sendMessage';
        let body = { chatId, message };

        // Handle File Sending if URL provided
        if (file_url) {
            apiMethod = 'sendFileByUrl';
            body = {
                chatId,
                urlFile: file_url,
                fileName: file_url.split('/').pop() || 'file',
                caption: message
            };
        }

        const waResponse = await fetch(`https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/${apiMethod}/${GREEN_API_TOKEN}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const waData = await waResponse.json();

        if (waResponse.ok) {
            console.log(`[SendWhatsApp] Success: ${waData.idMessage}`);
            return Response.json({ success: true, messageId: waData.idMessage });
        } else {
            console.error(`[SendWhatsApp] API Error:`, waData);
            return Response.json({ success: false, error: waData }, { status: 400 });
        }

    } catch (error) {
        console.error('[SendWhatsApp] Internal Error:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});