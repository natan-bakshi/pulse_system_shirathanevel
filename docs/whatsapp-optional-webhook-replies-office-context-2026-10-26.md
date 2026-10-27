# PULSE / שירת הנבל — שדרוגי WhatsApp אופציונליים: קליטה חסכונית, זיהוי תגובות ופנייה למשרד
**26.10.2026 | מערכת יחידה:** Base44 `687d1de6659eff83e9c034f7`; GitHub `natan-bakshi/pulse_system_shirathanevel`. לא מערכת Pulse האחרת.  
**סטטוס:** מחקר, תכנון ובדיקות Mock בלבד. אין endpoint ציבורי חדש, אין שליחות חיות ואין אישור להפעיל כפתורים. הגנות נגד כפילויות/שיבושים מתועדפות מעל שיפורים קוסמטיים.

## O1 — Webhook ש״ממתין״ בעלות/קרדיטים נמוכים (אופציונלי; לפני Rollout)
**אפשרי:** Green API Webhook Endpoint הוא **Push**: Green יוזם POST כשמגיעה הודעה; אין צורך להריץ polling כל כמה שניות או worker מתמיד. חשבון Green מאפשר `incomingWebhook=yes` ואת דגלי `outgoingWebhook/stateWebhook/deviceWebhook` לפי צורך. **לא לשנות דגלים קיימים בלי למפות צרכנים קיימים.** הודעות רגילות עדיין עשויות להגיע כסוג incoming; נדרש סינון נוסף לפי `messageData.typeMessage`.

**בחינת שלוש חלופות:**
1. **Direct Base44 ingress** (פשוט לתפעול): endpoint מאומת, סינון מהיר של POST/JSON/GREEN Bearer + `typeMessage`, רק אירוע לחיצת כפתור ממשיך לאימות ו־DB; חסרון: אפילו בקשה שמסתיימת מיד עשויה לצרוך הרצה/קרדיטים או מגבלות Base44. **אסור לטעון שהריצה חינם ללא Credit Usage.**
2. **Lightweight gateway חיצוני** כגון Edge/Function בעל מכסה חינמית מאומתת, מול Green API: מאמת סוד/גודל/צורה, מחזיר ACK **רק לאחר קליטה/דחייה בטוחה**, ומעביר ל־Base44 רק לחיצות; הודעות טקסט/מדיה/סטטוסים לא נכנסות ל־Base44. יתרון: פחות קריאות Base44; חסרון: תשתית נוספת, זמינות, מעקב, Rate Limits, אבטחה ועלות אפשרית אצל ספק ה־Edge. אם משתמשים במסנן בלבד בלי אחסון עמיד, יש לקבוע מה קורה אם Base44 לא זמין לפני ACK.
3. **HTTP API polling** (ReceiveNotification + DeleteNotification): נותן FIFO לפי Green אבל דורש קריאות חוזרות גם בתור ריק ו־Delete בטוח; אופציה רק כגיבוי/במקרה של חסם ממשי ל־Webhook, לא ברירת מחדל חסכונית.

**מדיניות ה־ACK:** GREEN API מציין חזרה של Webhook אחרי כ־1 דקה אם לא התקבל 200, עד 24 שעות. אין להחזיר 200 עבור אירוע עסקי שעלול ללכת לאיבוד: ACK אחרי רישום עמיד או דחייה בטוחה ומתועדת בלבד; אחרת צריך להחליט במפורש על החזרת שגיאה, דד־לטר והגנה מפני סופת ניסיונות/עלות. **לא להפעיל Endpoint ציבורי לפני QA של ACK אמיתי.**

**מדידה נדרשת:** גודל `events` מכל הסוגים ליום, שיעור button clicks, קריאות Base44 שהתקבלו, עלויות Integration Credit בפועל (מד Base44 לפני/אחרי), עלות Edge חיצונית, עלות שמירת receipt, latency, שיעור retries ומצבי `needs_review`. אין התחייבות ל־0 קרדיטים; למזער גם תעבורה וגם צריכת Base44. אין Cron חדש עד שיימצא צורך. **מקטע הקוד הקיים:** `greenInteractiveHttpBoundary.ts`, `greenInteractiveHttpStaging.ts`, `whatsappInboundRateBudget.ts` — פנימיים ולא מפורסמים.

## O2 — כפתורים עם זיהוי ההודעה המדויקת, ללא תלות בסדר (חובה לפני הפעלה)
**אפשרי ונתמך בתיעוד Green API.** לכל הודעת שיבוץ יוצאת שומרים את `provider_message_id` האמיתי; בכל תגובת כפתור מסרבים להפעיל שינוי בלי `stanzaId` מקורי, `selectedId`, מזהה אירוע נכנס נפרד, חשבון שולח, chatId ספק, supplierId, eventServiceId, revision וחתימת action. **לא להתאים לפי כפתור ״מאשר״, זמן קבלת התגובה, ההודעה האחרונה או סדר האירועים.**

**בדיקת Mock שבוצעה:** שלושה שיבוצים מאותו מספר ובאותו צ׳אט נענו בסדר B→C→A, כל סטטוס עודכן מול ה־EventService המתאים; callback כפול או לחיצה נוספת אחרי הכרעה לא משנים שיבוץ; stanzaId לא מוכר לא מתחלף בהודעה החדשה. `tests/whatsapp-interactive-out-of-order.test.mjs`. בוצעו גם מבחני cache/DB receipt/חתימת action קיימים. נדרש QA עם מזהי Green API אמיתיים, כולל סוגי `templateButtonsReplyMessage` ו־`buttonsResponseMessage`; דוגמת beta `interactiveButtonsReply` בדוקומנטציה דורשת אימות חשבון בפועל, כי הפורמט עשוי להשתנות.

## O3 — הצ׳אט נשאר פתוח; הודעות חופשיות לא משנות שיבוץ
**אפשרי — אין צורך בצ׳אט שרק הבוט כותב אליו.** ה־listener של אישור/דחייה מקבל **רק אירוע לחיצה בעל מזהה מקור וכפתור חתום**. טקסט (אפילו ״מאשר״/״דוחה״), הודעה מצוטטת רגילה, תמונה/קול/וידאו, מיקום, תגובה לא מוכרת או הודעת סטטוס מספק — לא מפעילים שינוי. אם שירותי WhatsApp אחרים במערכת מטפלים בהודעות חופשיות, יש למפות אותם ולמנוע הפעלה עקיפה של שינוי שיבוץ; לא לשנות את מנגנוני שירות הלקוחות.

**בדיקת Mock שבוצעה:** `textMessage`, `quotedMessage`, `audioMessage`, `extendedTextMessage` נדחו *לפני כל DB lookup* במסלול השיבוץ, גם כשהתוכן ״מאשר״ ומצוטטת הודעת שיבוץ. `tests/whatsapp-interactive-out-of-order.test.mjs`.

## O4 — ״פנייה למשרד״ עם הקשר להודעת השיבוץ (אופציונלי)
**פתרון מומלץ:** כפתור URL נפתח ל־`https://wa.me/<office-number>?text=<encoded>`, עם טיוטת שאלה שהמשתמש יכול לערוך/לשלוח; אין שליחה אוטומטית בלחיצה. מקשרים אסמכתא יציבה (`outboxJobId`) + אפשרות לקטע קצר/מסונן מהודעת השיבוץ, במקום להעביר טקסט מלא המכיל טלפון, URL רגיש או מיילים.

**מגבלה:** `quotedMessageId` של Green API נותן ציטוט **בהודעה שנשלחת על ידי API באותו צ׳אט**; אין דרך מבוססת־`wa.me` ליצור reply bubble אמיתי להודעה מצ׳אט אחר כשפותחים צ׳אט עם מספר משרד שונה. במקרה שהמשרד הוא אותו מספר/צ׳אט, אפשר להציע לספק Reply ידני בהודעת המקור; עדיין לא ניתן להבטיח שהתוכנה תתייחס לטקסט חופשי כפעולת שיבוץ. אין להציג קישור `wa.me` כציטוט Native.

**הוכחת היתכנות בקוד (לא פעילה):** `whatsappOfficeInquiryLink.ts` מאפשר מצבים `none` (ברירת מחדל: שומר URL ישן), `reference` (אסמכתא בלבד), `excerpt` (אסמכתא + עד 120 תווים תוך סינון URL/מייל/מספר). `greenInteractiveOutbound.ts` מקבל `officeContextMode` **רק מתוך trusted backend config**, אינו משנה את ה־worker הקיים כשהפיצ׳ר כבוי. `tests/whatsapp-office-inquiry-link.test.mjs`: פירוק URL, escaping, היעדר leakage, קצר ומזוהה. מומלץ לבחור `reference` או `excerpt` רק לאחר אישור בעל מערכת, בדיקת תמיכת mixed buttons בחשבון, ודאגה שהמשרד מסוגל לחפש לפי האסמכתא.

## סדר ביצוע ומדיניות שינוי
- [x] מחקר מקורות רשמיים Green API ו־WhatsApp לקליטה, לחיצות ו־URL של צ׳אט.
- [x] מימוש Mock לזיהוי כפתור מתוך הודעה מקורית, כולל 3 שיבוצים בסדר הפוך.
- [x] בדיקת בידוד הודעות חופשיות, ללא DB ו־status transitions.
- [x] בניית קוד אופציונלי לטקסט פנייה עם אסמכתא/תקציר ללא שינוי ברירת המחדל.
- [ ] למדוד Credit Usage אמיתי של Base44 ל־Webhook direct מול proxy חיצוני ב־QA מורשה, בלי להריץ polling מאסיבי.
- [ ] למפות הגדרות webhook קימות ב־Green API ו־Wasender לפני שינוי `incomingWebhook`/ביטול אירועים אחרים.
- [ ] לאמת חשבון Green API ואת ה־mixed button + URL; לנסות שני מספרי QA מורשים אחרי אישור, ללא ספקים/לקוחות אמת.
- [x] **נבנה חיפוש מנהל־על לקריאה בלבד לפי אסמכתת Outbox מדויקת:** `whatsappOfficeReferenceLookup.ts` והפעולה `WhatsAppQueueAdmin(officeReferenceLookup)`; מסך ניהול התור כולל אזור סגור כברירת מחדל להזנת האסמכתא. מופיעים אירוע, תאריך, שירות, שם ספק, סטטוס נוכחי והאם מדובר בגרסה האחרונה או בהודעה היסטורית. קריאות מסד: 1–4 GET לפי הצורך, רק בלחיצה; ללא סריקת הודעות, חשיפת מספרים/טקסט/סודות, עדכון סטטוס או שליחה. בדיקות מסלול ושתי פניות מאותו ספק בסדר הפוך עברו. הרשאה כעת **רק למנהל־על**; הרחבה למנהל חברה דורשת החלטת הרשאות נפרדת.
- [ ] להחליט האם `reference` מספיק או להפעיל `excerpt` (עשוי לחשוף פרטי אירוע לא רצויים למספר המשרד המשותף בעתיד).
- [x] **נבנתה טיוטת מדיניות ACK פנימית ללא HTTP:** `greenWebhookAckPlanning.ts` מסווג תגובות non-button מוכרות ממופע Green מאומת ללא קריאות DB, ומגדיר מועמד לאישור רק אחרי קליטה עסקית סופית/עמידה. שגיאות DB לא ודאיות, Rate Limit וסוגי בטא לא מוכרים אינם מסווגים כהצלחה. גם `greenInteractiveHttpStaging.ts` הוקשח לזיהוי בטוח זה. **זהו כלי תכנון בלבד, לא החזרת ACK לספק ולא Webhook חי.**
- [ ] לקבוע **קודי HTTP ו־ACK/retry אמיתיים** לאחר דוגמה חיה מאושרת, תקציב תעבורה וקרדיטים, ניטור ושחזור; לא לזרוק תגובה עסקית שנכשלה ללא רישום עמיד.
- [ ] לא להפעיל את `interactive_outbound_live_enabled`, לא לפתוח Webhook ציבורי, לא לשנות תזמוני Watchdog/פייסינג/גיבויים לפני אישור מפורש ובדיקות.

### 26.10.2026 — התקדמות נוספת: ACK מדויק, כפילויות וחיסכון
- [x] **תוקנה כפילות שנקלטה לאחר עדכון סטטוס ספק:** כעת מזהים קבלה קיימת רק לאחר אימות סוד הספק, החתימה, ההודעה המקורית ופרטי השיבוץ, ובדיקה ממוקדת של Receipt שמור עם זהות מלאה, חותמת סיום ותוצאת טיפול. אין שינוי ספק שני.
- [x] **כפילות לא גמורה לעולם אינה ACK חיובי:** קבלה במצב pending/processing/needs_review לא מאומת, כשל מסד או פעולה שונה עם אותו providerEventId מחייבים בירור ולא נסיון נוסף לשנות שיבוץ.
- [x] **שמירת צ׳אט משרד פתוח — עודכן לפי החלטת בעל המערכת:** טקסט ידני, קול, תמונה, ציטוט, סקר וכו' אינם נקלטים כלל כפקודות שיבוץ; אין צורך ביומן הודעות ידניות או בדגל `ordinaryInboundHandlingVerified` במסלול השיבוצים המבודד. לאחר אימות Webhook/חשבון, אירוע מוכר שאינו כפתור נעצר לפני DB, ומסווג כ־ACK עתידי בלבד, ללא הפעלת Endpoint חי. **אין אישור לשנות או לבטל צרכני Webhook אחרים**; אם Green מאפשר URL יחיד יש לשמור על יכולת העברה קיימת לפני שינוי ההגדרה.
- [x] **מחשבון קרדיטים מקומי:** סרגל מתקפל בהגדרות WhatsApp, ללא קריאת רשת/DB/Backend. על פי תיעוד Base44: כקרדיט אחד לכל 100 הפעלות Backend (עשוי להשתנות לפי החשבון). בדוגמה היפותטית של 200 אירועים נכנסים, 10 כפתורים ו־2 לא מזוהים ביום, 30 יום: כ־60 קרדיטי פונקציות במסלול ישיר מול כ־3.6 במסלול מסונן, **בלי עלות ה־Gateway, retries וספק**. מקור: https://docs.base44.com/Account-and-billing/Credits
- [x] **637/637** בדיקות Mock עברו, בניית Vite תקינה, lint ממוקד ו־git diff check נקיים; אין Webhook ציבורי, אין שליחות אמת, מד הקרדיטים של החשבון לא נבדק.
- [ ] להמשיך: בדיקת פורמט ו־ACK של Green בחשבון בפועל, מיפוי צרכני inbound קיימים, מדידת Credit Usage והשוואת עלות Gateway/תחזוקה ואמינות לפני החלטה והפעלה.

### WA-OPT-03b — 26.10.2026 | החלטת בעל המערכת אושרה ובוצעה בקוד הפנימי
- [x] **מדיניות: קליטת כפתורים בלבד.** אין ניסיון לפענח הודעות ידניות כפקודות; רק אישור/דחייה מכפתור חתום עם הודעת מקור ושיבוץ תקין. ״פנייה למשרד״ היא טיוטת `wa.me` עם אסמכתא ופתיחת שיחה ידנית שאינה משנה שיבוץ.
- [x] `greenInteractiveHttpStaging.ts` מסנן 19 סוגי הודעות ידניות מוכרות ו־11 התראות ספק מוכרות **לאחר אימות סוד וחשבון Green ולפני DB/Receipt/CAS**. מטא־דאטה חדש/פורמט אינטראקטיבי לא מוכר נשלח לבירור, ולא נזרק בטעות.
- [x] `greenWebhookAckPlanning.ts` אינו זקוק עוד לדגל הפנימי `ordinaryInboundHandlingVerified` עבור מסלול Assignment-only; אירוע מסונן ומאומת הוא מועמד בלבד ל־ACK לאחר QA, ללא החזרת 200 בפועל.
- [x] שכבת מיון עצמאית עתידית `greenButtonsOnlyEdgeIngress.ts` תוכננה ונבדקה ב־Mock: הזדהות Green, 4 מצבי ניתוב, **אפס fetch, אפס DB, אפס פנייה ל־Base44**; לא נפרסה ולא הוגדר Webhook חדש. זהו הבסיס לאפשרות חיסכון משמעותי במידה שנתוני Credit Usage יצדיקו Edge.
- [x] **649/649** בדיקות Node, בניית Vite, ESLint ממוקד ו־`git diff --check` עברו; אין שליחות אמת.
- [ ] תלויות שלא הוסרו: בדיקת חשבון Green/ACK אמיתי, שמירת אינטגרציות Webhook קיימות במקרה של URL יחיד, החלטת Direct/Edge לפי עלויות בפועל, אישור פריסה חיה בנפרד.
- **מסמך ההחלטה המלא:** `docs/whatsapp-buttons-only-inbound-filter-2026-10-26.md`.

### WA-OPT-01d — 26.10.2026: בדיקת תצורת Green API אמיתית, רק בלחיצה
- [x] קיים קוד בדיקה על בסיס `GetSettings` הרשמי: קריאת GET **אחת בלבד לפי לחיצה של מנהל־העל**, ללא retries, ללא סריקת Base44, ללא `SetSettings` וללא שינוי ב־Green. `SetSettings` מאתחל את המופע ולכן אסור להשתמש בו לאבחון. מקור: https://green-api.com/en/docs/api/account/GetSettings/ וגם https://green-api.com/en/docs/api/account/SetSettings/
- [x] הממשק מציג רק דגלי webhook נבחרים, אם קיימת כתובת, אם מוגדר סוד, אם `incomingWebhook` פעיל ואם יש סיכון להחליף כתובת קיימת. **URL, token, מספר WhatsApp ותגובת API גולמית אינם עוברים לדפדפן**.
- [x] מצב תשלום: בלחיצה יש לקרוא ל־Green פעם אחת והפעלה אחת של פונקציית Base44, ולכן אין לקרוא לזה ״אפס קרדיטים״. בדיקות הפיתוח משתמשות ב־Mock בלבד: **0 בקשות Green חיות**.
- [x] `greenWebhookHttpContract.ts` ממפה תוצאות ל־**קודי HTTP מוצעים בלבד**, על בסיס 200 ACK / non-200 retry בתיעוד Green. אין `Deno.serve` חדש ואין הודעת ACK אמיתית. Unknown Beta/DB failure/receipt לא ודאי אינם מקבלים 200.
- [x] **662/662** בדיקות מקומיות עברו, Vite build ו־ESLint ממוקד תקינים.
- [ ] מנהל־העל יפעיל בדיקת GetSettings לפי הצורך כדי לקבל מצב אמת של החשבון. לאחר מכן יש למפות מי צורך את כתובת ה־Webhook הקיימת, לאמת account beta והחזרת ACK אמיתית ולשמור על רציפות שירות בהחלפת כתובת.
- [ ] נותר להגדיר קליטה עמידה גם ל־callback בעל פורמט חדש, לפני בחירה ב־HTTP 200 או סיכון retries במשך 24 שעות. לא להפעיל את המסלול החי בלי הוכחת idempotency ואישור rollout.

### WA-OPT-01e — יומן בירור לתגובות כפתורים לא מזוהות (26.10.2026)
- [x] נוצרה ישות `WhatsAppInboundQuarantine` ורכיב `greenUnknownCallbackQuarantine.ts` לרישום metadata בלבד עם HMAC מזהה אירוע + HMAC תוכן, ללא טלפונים/טקסט/מזהי כפתור או פרטי ספק. תומך במניעת כפילויות, נעילת CAS עצמאית ובדיקה חוזרת לאחר CREATE; במקרה timeout לא ודאי Guard נשמר לבירור ידני.
- [x] ל־`greenInteractiveHttpStaging.ts` נוסף ניתוב של אירועים נכנסים מאומתים בעלֵי פורמט לא מוכר לבירור עם Rate Budget; אירוע מוכר הוא הודעת טקסט ידנית מסונן בלי DB. **רישום metadata אינו אישור/דחיית שיבוץ ואינו ACK של הודעה שלא ניתן לשחזר.**
- [x] נוסף `unknownCallbackAudit` לקריאה של עד 40 רישומי בירור באמצעות מסך מנהל־על, ללא כתיבות או שליחת הודעות; ב־Readiness נוסף חסם להימצאות Guard וסידור התאוששות מאושר.
- [x] **673/673** בדיקות Mock, בניית Vite, ESLint ו־Diff clean. אין Webhook חי.
- [ ] **מגבלה הכרחית לפני הפעלה:** כיוון שהודעה גולמית לא נשמרת, לא ניתן לשחזר לחיצה לא מוכרת מתוך טביעת HMAC בלבד. ספק Green עשוי להפסיק retries כעבור יממה. יש לתכנן עם בעל המערכת התאוששות מאובטחת/מוצפנת או מסלול בירור אנושי בזמן קצר, כולל פרטיות, ניטור, עלויות ו־ACK.
- **מסמך מפורט:** `docs/whatsapp-unknown-green-callback-quarantine-2026-10-26.md`.





### WA-OPT-01f — פתרון שחזור מוצפן אופציונלי (27.10.2026)
- [x] במקום לעבור ל־HTTP Polling (שאינו זמין במקביל ל־Webhook URL מותאם של Green), נבנתה מעטפת AES-256-GCM זמנית וניתנת לשחזור עבור **תגובות אינטראקטיביות בלתי מוכרות בלבד**. היא כבויה כברירת מחדל ודורשת אישור retention ומפתח שרת נפרד, ללא פענוח אוטומטי או שליחת הודעה.
- [x] נבנו מניעת כפילויות וקנוניזציית JSON, אימות כתיבה תחת CAS באותה ישות, TTL של 48 שעות, חסימת שינויים/מפתח שגוי ופקיעת תוקף, ללא הארכת שמירה בעקבות Retry. רשומות טקסט ידני לא נכנסות לשמירת תוכן מוצפן.
- [x] נוסף ניקוי יזום של עד 20 מעטפות מוצפנות שפג תוקפן, בהפעלת מנהל־העל ולא מאחורי Cron. אין מחיקת HMAC, אין תלות ב־Green, אין שינוי ב־Watchdog או בתור השולח. המחיקה מגיבויים טרם אומתה.
- [x] **688/688** בדיקות מקומיות + Build/Lint תקינים. שום Webhook חי לא פורסם, לא נשלחו הודעות. החיוב של סביבת Base44 אינו מדוד.
- [ ] עדיין דורש אישור: lifecycle של המפתחות, מנגנון מחיקה אוטומטית אמין/גיבויים, מסך שחזור מורשה ומבוקר עם אימות מלא, QA אמיתי ב־Green ו־Credit Usage לפני LIVE.
- **תיעוד:** `docs/whatsapp-unknown-green-recovery-encryption-2026-10-27.md`.

## מקורות שנבדקו
- GREEN API: https://green-api.com/en/docs/api/receiving/technology-webhook-endpoint/
- GREEN API HTTP polling: https://green-api.com/en/docs/api/receiving/technology-http-api/
- GREEN API interactive selection: https://green-api.com/en/docs/api/receiving/notifications-format/selected-buttons/ButtonsResponseMessage/
- GREEN API beta mixed buttons: https://green-api.com/en/docs/api/sending/SendInteractiveButtons/
- GREEN API beta reply-only: https://green-api.com/en/docs/api/sending/SendInteractiveButtonsReply/
- GREEN API beta incoming: https://green-api.com/en/docs/api/receiving/notifications-format/incoming-message/InteractiveButtonsReply/
- GREEN API quoted outgoing: https://green-api.com/en/docs/api/sending/SendMessage/
- WhatsApp official click-to-chat: https://faq.whatsapp.com/5913398998672934
- Base44 pricing (credit quantities, **not per-endpoint billing proof**): https://base44.com/pricing

**חיסכון:** אין שינוי חי ל־Webhook ואין Polling חדש; כל הבדיקות והקישורים נעשו עם Mock, לא על חשבון Green API או שליחות Base44. עלות Sandbox/Base44 בפועל לא אומתה.
