# שירת הנבל | החלטת בעל מערכת: קליטת WhatsApp של כפתורי שיבוץ בלבד
**תאריך:** 26.10.2026  
**מערכת:** Base44 `687d1de6659eff83e9c034f7`, repository `natan-bakshi/pulse_system_shirathanevel`. אין לשנות את Pulse האחרת.  
**סטטוס:** מדיניות אושרה בידי בעל המערכת; **המימוש חי עדיין כבוי**. אין Webhook ציבורי או תצורת Worker חיה לכפתורים.

## ההחלטה העסקית
אישור או דחיית ספק יתקבלו **רק** מלחיצה על כפתור שיבוץ מקורי, מאומת ומזוהה עם הודעת המקור (Green API stanzaId), עם HMAC חתום, חשבון שולח, מזהה ספק, מזהה שירות וגרסת שיבוץ. הודעות ידניות אינן פקודות — גם כשכתוב בהן 'מאשר' / 'לא מאשר', גם אם מצטטות את הודעת השיבוץ, וגם כשהן מגיעות שלא לפי הסדר.

כפתור **פנייה למשרד** הוא כפתור URL לפתיחת `wa.me` עם טיוטה ואסמכתת השיבוץ. הטקסט שהספק שולח למשרד לאחר מכן הוא **שיחה רגילה**, ולא תגובת אישור/דחייה במנגנון השיבוצים. הודעות טקסט/תמונה/קול/וידאו/ציטוט/אימוג'י/סקר וכו' אינן נשמרות או נבדקות על ידי *מנגנון השיבוץ*.

## סדר הפעולות העתידי (ללא DB עבור הודעה רגילה)
1. Green מוסר Push ל־Webhook שהוגדר, בלי polling מתמיד. **בשלב זה אין Endpoint כזה בייצור**, וההגדרות של Green אינן משתנות.
2. לפני כל סינון: אימות סוד Green/Authorization, שיטת POST, JSON תקין עד 32KiB, מזהה החשבון והשרת; הודעה לא מורשית לא תקבל ACK מוצלח.
3. **אירוע מוכר שאינו לחיצת כפתור:** למשל טקסט, מדיה, תגובת אימוג׳י, מסר מצוטט, סקר, וכן סוגי התראות ספק מוכרים — נדחה ממסלול השיבוצים ללא DB, ללא עבודה עסקית, ללא שליחה. ה־ACK planner מחזיר רק **מועמד להחזרת אישור** אחרי QA אצל Green; אינו בוחר קוד HTTP או משגר תשובת רשת.
4. **לחיצה מזוהה:** מועברת לבדיקת חתימה/מקור Outbox, ספק/חשבון, revision, idempotency, receipt עמיד, CAS עסקי ועדכון סטטוס יחיד. אין התאמה לפי סדר ההודעות/טקסט/״האחרונה״.
5. **פורמט חדש/בלתי־מוכר של Green או בחירה מרשימה:** לא מוחקים אוטומטית; מעבירים לטיפול מוגן/בירור כדי לא לאבד לחיצות אחרי שינוי ספק. הטיפול אינו משנה שיבוץ בלי אימות מקור. אירוע זר/חתימה שגויה נדחה.
6. **שגיאת DB או תוצאה לא ודאית:** אינה מותרת כ־ACK חיובי רק כי קיימת רשומה. בלי בדיקת receipt סופי לא מנסים שוב אוטומטית.

## הבחנה בין סינון ל־Base44 ובין Edge
- בתוך פונקציית Base44: הודעה רגילה מוכרת נפסלת **לפני קריאות DB**, אך עצם הפעלת פונקציית Backend עשויה עדיין לגבות קרדיט. זה אינו חיסכון של 100% בקרדיטים.
- בגבול Edge נפרד: סינון יכול להתבצע **לפני** קריאת פונקציית Base44. תכנון טהור בקוד `greenButtonsOnlyEdgeIngress.ts` מאמת את סוד Green, מזהה instance, מעביר רק button/unknown, ומסמן non-button ל־ACK עתידי. אין בו `fetch`, `Deno.serve`, DB או קריאה ל־Base44.
- **כדי לפרוס Edge בפועל** נדרשים שירות, סודות שרת, HTTPS, בקרה על חשבון/מכסות, אימות קריאה למערכת הפנימית, ACK אחרי קליטה עמידה/ללא אובדן, תור חירום/Retry, ניטור ומדדי Credit Usage. להימנע מהקמת שרת חדש רק על בסיס אומדן חיסכון.
- **אין לשנות את Webhook URL/מנויי האירועים הקיימים ב־Green** או לבטל התראות משלוח/מכשיר בלי לבדוק שהם אינם נצרכים במקומות אחרים (קיימת תצורת ספק גלובלית). סינון הכפתורים מבודד רק את *מסלול השיבוצים*; אין כאן אישור למחוק ערוצי שירות/ניטור אחרים. אם בעתיד Green מאפשר רק URL יחיד, Gateway חייב להעביר הודעות אחרות לצרכן הקיים בנפרד **לפני** שהוא מסמן קליטה.
- האישור **כן פוטר את מסלול השיבוצים** מהצורך לשמור הודעות ידניות, או לחכות להוכחת טיפול בהן במסד שיבוצים. הוא אינו אישור להפעיל Green API / לפרסם endpoint ללא בדיקות חיות, ולא פותח הרשאות לספקים אחרים.

## מצב בקוד + בדיקות שנוספו
- `greenWebhookAckPlanning.ts`: רשימת סוגי הודעות/metadata מוכרים שאינם כפתור והחזרת `safe_ack_candidate` רק מתוך `ignored_non_button` מאומת ומסלול Assignment-only. אין תוצאה כזו עבור פורמט Beta חדש בלתי מוכר.
- `greenInteractiveHttpStaging.ts`: סינון ישירות לאחר אימות HTTP וחשבון, לפני `reserveVerifiedGreenInboundBudget`, Outbox או Supplier queries; removed the superseded `ordinaryInboundHandlingVerified` gate (approved owner policy applies to the assignment handler only).
- `greenButtonsOnlyEdgeIngress.ts`: שער מיון **עתידי פנימי ולא פרוס**, בעל ארבע אפשרויות: `ignored_non_button`, `forward_verified_button`, `forward_unknown_for_review`, `request_refused`.
- `whatsappInteractiveReadiness.ts` + הגדרות המנהל: המדיניות מוצגת בבדיקת מוכנות לפי לחיצה בלבד; אין DB נוסף ולא כפתור הפעלה.
- `tests/green-buttons-only-inbound-filter.test.mjs` ו־`tests/green-buttons-only-edge-ingress.test.mjs`: סינון הודעות רגילות, quote לסטנזה מקורית, ״מאשר״ בטקסט, אימוג׳י, מדיה, מעמד ספק, URL משרד, התחזות, חשבון אחר, Beta לא מוכר, אפס DB, אפס provider calls.
- בדיקות רגרסיה מפורטות נרשמות בתוכנית הראשית, כולל סימולציית 3 שיבוצים בסדר B→C→A ושמירת RECEIPT יחיד.
- **אין כרגע QA חי בחשבון Green, אין שינוי פרודקשן ב־Webhook, אין שינוי בקצב תור/Watchdog, אין שליחות אמת.**

## Go / No-Go להמשך
- [x] החלטת בעל המערכת: מסלול קליטה **רק כפתורים**; הודעות אחרות מסוננות בלי סטטוס עסקי.
- [x] סטטוסים/הודעות ידניים מוכרים נבדקים מקומית ללא DB; פורמט בלתי מוכר לא נזרק; כפתור למשרד לא מפעיל פעולה עסקית.
- [x] הכנת Edge dispatcher ללא רשת/DB/פריסה ובדיקות Mock.
- [ ] אימות תמיכת חשבון Green המסוים ב־mixed buttons ובדוגמאות callback ממשיות.
- [ ] אימות קודי HTTP ACK/Retry בפועל; דוגמת Green הרשמית מציינת ACK 200 וניסיונות כל כדקה, עד יממה, אך נדרש לאמת בחשבון לפני פרסום.
- [ ] מיפוי webhooks קיימים וצרכנים אחרים; אפס אובדן סטטוסי ספק/משרד/התראות חשובות בעת החלפת `webhookUrl`.
- [ ] בחירת Direct מול Edge רק אחרי מדידת Credit Usage, עלויות Gateway וקצב האירועים בפועל.
- [ ] QA מורשה ושתי הודעות בדיקה בלבד לאחר אישור מפורש לבדיקת חיבור אמיתי, ללא ספקים/לקוחות אמיתיים.
- [ ] הפעלת דגלים וחיבור Worker/Webhook **רק אחרי** רישום מלא של הוכחות ואישור rollout נפרד.

## מקורות
- סוגי התראות: https://green-api.com/en/docs/api/receiving/notifications-format/type-webhook/
- הודעות נכנסות: https://green-api.com/en/docs/api/receiving/notifications-format/
- תגובת כפתור Template: https://green-api.com/en/docs/api/receiving/notifications-format/selected-buttons/TemplateButtonsReplyMessage/
- תגובת כפתור Simple: https://green-api.com/en/docs/api/receiving/notifications-format/selected-buttons/ButtonsResponseMessage/
- Webhook Endpoint: https://green-api.com/en/docs/api/receiving/technology-webhook-endpoint/
- Credits: https://docs.base44.com/Account-and-billing/Credits
