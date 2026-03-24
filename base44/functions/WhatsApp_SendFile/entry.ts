import { createClientFromRequest } from 'npm:@base44/sdk@0.8.11';

Deno.serve(async (req) => {
    try {
        // קריאת הפרמטרים מהבקשה
        const { Phone, FileUrl, FileName, Caption } = await req.json();

        // ולידציה בסיסית
        if (!Phone || !FileUrl) {
            return Response.json(
                { error: "Missing required parameters: Phone or FileUrl" },
                { status: 400 }
            );
        }

        // 1. ניקוי מספר הטלפון
        let cleanPhone = Phone.replace(/[^0-9]/g, '');

        if (cleanPhone.startsWith('05')) {
            cleanPhone = '972' + cleanPhone.substring(1);
        } else if (cleanPhone.length === 9 && cleanPhone.startsWith('5')) {
             cleanPhone = '972' + cleanPhone;
        }

        // 2. שרשור סיומת @c.us
        const chatId = `${cleanPhone}@c.us`;

        // שליפת משתני סביבה
        const instanceId = Deno.env.get("GREEN_API_INSTANCE_ID");
        const token = Deno.env.get("GREEN_API_TOKEN");
        const baseUrl = "https://api.green-api.com";

        if (!instanceId || !token) {
            return Response.json({ error: "Configuration error" }, { status: 500 });
        }

        // 3. ביצוע קריאת HTTP POST לשליחת קובץ
        const url = `${baseUrl}/waInstance${instanceId}/sendFileByUrl/${token}`;

        // חילוץ שם קובץ מה-URL אם לא סופק
        const finalFileName = FileName || FileUrl.split('/').pop() || 'file';

        console.log(`Sending WhatsApp File to ${chatId}...`);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                chatId: chatId,
                urlFile: FileUrl,
                fileName: finalFileName,
                caption: Caption || ""
            })
        });

        const data = await response.json();

        // בדיקת הצלחה
        if (!response.ok) {
            console.error("Green API File Error:", data);
            return Response.json(
                { error: "Failed to send file via Green API", details: data },
                { status: response.status }
            );
        }

        return Response.json(data);

    } catch (error) {
        console.error("WhatsApp_SendFile Exception:", error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});