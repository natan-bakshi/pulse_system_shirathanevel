// הפונקציה הוסרה מהמערכת: לא היה לה caller, והיא הפנתה לישות EventQuote שאינה קיימת.
// נשמר משאב מינימלי שמחזיר 410 Gone בלבד - ללא אימות, ללא service role,
// ללא תוכן דינמי, ללא HTML וללא cache ציבורי.
Deno.serve(() => {
    return new Response('Gone', {
        status: 410,
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store'
        }
    });
});