import { createClientFromRequest } from 'npm:@base44/sdk@0.8.11';

Deno.serve(async (req) => {
    try {
        // קריאת הפרמטרים מהבקשה
        const { Phone, Message } = await req.json();

        // ולידציה בסיסית
        if (!Phone || !Message) {
            return Response.json(
                { error: "Missing required parameters: Phone or Message" },
                { status: 400 }
            );
        }

        // 1. ניקוי מספר הטלפון
        // מסיר רווחים, מקפים, פלוסים וכל תו שאינו מספר
        let cleanPhone = Phone.replace(/[^0-9]/g, '');

        // טיפול בקידומת ישראלית (הנחה בסיסית, ניתן להתאמה)
        // אם מתחיל ב-05, נחליף את ה-0 ב-972
        if (cleanPhone.startsWith('05')) {
            cleanPhone = '972' + cleanPhone.substring(1);
        }
        // אם המספר קצר ואין קידומת מדינה, נניח ברירת מחדל 972 (אופציונלי, לשיקול דעת)
        else if (cleanPhone.length === 9 && cleanPhone.startsWith('5')) {
             cleanPhone = '972' + cleanPhone;
        }

        // 2. שרשור סיומת @c.us
        const chatId = `${cleanPhone}@c.us`;

        // שליפת משתני סביבה
        const instanceId = Deno.env.get("GREEN_API_INSTANCE_ID");
        const token = Deno.env.get("GREEN_API_TOKEN");
        const baseUrl = "https://api.green-api.com";

        if (!instanceId || !token) {
            console.error("Missing Green API Credentials");
            return Response.json({ error: "Configuration error" }, { status: 500 });
        }

        // 3. ביצוע קריאת HTTP POST
        const url = `${baseUrl}/waInstance${instanceId}/sendMessage/${token}`;

        console.log(`Sending WhatsApp to ${chatId}...`);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                chatId: chatId,
                message: Message
            })
        });

        const data = await response.json();

        // בדיקת הצלחה
        if (!response.ok) {
            console.error("Green API Error:", data);
            return Response.json(
                { error: "Failed to send message via Green API", details: data },
                { status: response.status }
            );
        }

        return Response.json(data);

    } catch (error) {
        console.error("WhatsApp_SendText Exception:", error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});