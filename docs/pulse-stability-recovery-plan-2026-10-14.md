# Pulse — תוכנית עבודה: יציבות מערכת כללית, מהירות שיבוצים ותזכורות עסקיות

**המערכת:** Pulse / שירת הנבל — Base44 App ID: `687d1de6659eff83e9c034f7`  
**מאגר מקור מאומת:** `github.com/natan-bakshi/pulse_system_shirathanevel`  
**אפליקציה שאסור לגעת בה:** Pulse הרב־חברתי, Base44 ID `6a33dd29fd912621a5d8443a`, מאגר `github.com/natan-bakshi/pulse` — שתי האפליקציות נקראות Pulse; תמיד לוודא מזהה ומאגר לפני כתיבה.  
**מיקום קבוע:** `docs/pulse-stability-recovery-plan-2026-10-14.md`  
**עודכן:** 15.10.2026 · **מצב:** תוכנית עבודה חיה, בביצוע · **אחראי החלטות מדיניות:** מנהל המערכת.  
**מקור בסיס:** מסמך הסקר מ־14.10, קריאת קוד ונתוני Base44, היסטוריית checkpoints, ומסמך `docs/whatsapp-unified-outbox-v1-plan-2026-10-12.md`.  
**ייעוד:** מסמך מקור האמת ליציבות מערכת Pulse הכללית: שיבוצים, חוויית משתמש, תזכורות ותשלומים. **שדרוג WhatsApp, ביצועי התור, worker, ספקים וקצב השליחה מנוהלים באופן עצמאי בלבד** ב־`docs/whatsapp-performance-and-reliability-plan-2026-10-15.md`. בכל סשן קוראים את מסמך התחום שבו עובדים; לעבודה חוצת תחומים יש קישור תלות ואסור לשכפל סטטוסים.

> **חוזה עבודה:** אין לסמן "בוצע" כשקוד רק תוכנן; אין לסמן "נבדק בפרודקשן" על בסיס unit tests בלבד; אין להגיד "נשלח" כשההודעה רק הוכנסה לתור או התקבלה ב־API; אין retry אוטומטי ל־unknown; אין שינוי ספק להודעה קיימת באופן סמוי; אין שינוי תשלום/שיבוץ/הרשאות ללא צורך ואימות.

---

## א. נוהל עבודה קבוע לכל שיחה

1. לקרוא **את כל המסמך** בתחילת עבודת הייצוב הכללית, כולל יומן הסשן האחרון והמשימה הבאה. בעבודה על ביצועי WhatsApp קוראים קודם את `docs/whatsapp-performance-and-reliability-plan-2026-10-15.md` ולא מערבבים Backlog. אין להמשיך רק מתמצית הזיכרון.
2. לבדוק `base44/config.jsonc` ולצלוב `list_user_apps` (שתי אפליקציות Pulse), App ID **`687d1de6659eff83e9c034f7`**, `git remote -v` עם `pulse_system_shirathanevel`, ואז `git status`, HEAD, checkpoints, פרסום אחרון ומצב התור *לקריאה בלבד*. אם מזהה או מאגר שונים — **לעצור מייד, לא לבצע כתיבה**.
3. להגדיר **מזהה משימה** (למשל C09) ונקודת עצירה לפני כל מקטע שינוי. להודיע מה יבוצע בסשן.
4. לפני שינוי גדול: checkpoint. בעת ביצוע — קריאת הקבצים, חוזים, טריגרים, תבניות, RLS, משמעויות בין־ערוציות, קוד ישן ושחזור.
5. כל שינוי מקבל: **ID**, קבצים, החלטת תכנון, הסבר הבעיה, השלכות רוחב, בדיקות שליליות וחיוביות, סיכון כפילויות, סטטוס `CODE`/`TEST`/`PROD`, ותאריך.
6. `[x]` = המשימה המסוימת בוצעה ויש ראיה; `[ ]` = חסר או לא אומת. למשימה שבוצעה בקוד ועדיין לא נבדקה בפרודקשן יהיו **שתי שורות נפרדות**.
7. QA בכל מקטע: בדיקת תחביר TS, בדיקות יחידה/אינטגרציה רלוונטיות, Build, Lint ממוקד, רגרסיות, סקירת Git diff, ובדיקה שהנתונים/השליחות שלא נועדו להשתנות לא השתנו.
8. לא מייצרים הודעות אמת ללקוחות/ספקים, לא משנים תורים חיים, לא שולחים מחדש ולא משחזרים DB לשם בדיקות אוטומטיות. כל פיילוט חי מחייב אישור נמען ובדיקה תחילה של מצב קודם.
9. בסיום כל מקטע: לרשום עדכון במסמך זה **באותו סשן**, לציין חסמים ומה נותר; ליצור checkpoint ולסמן נקודת המשך קונקרטית ביומן.
10. שינוי מדיניות עסקית (מועד תזכורת, fallback אוטומטי, תקרות retry, הרשאות, נוסח חוזה וכו') נרשם ב"נדרש אישור" — לא נבחר לבד.
11. רעיון לא דחוף נכנס ל־Backlog עם ID, ערך עסקי, תלות וסיכון, אך לא מבוצע אוטומטית בגלל שנתקלנו בקוד סמוך.
12. אין "פתרון התקלה של היום" בנפרד מהארכיטקטורה: כל תיקון חייב למנוע הישנות, להיות מדיד ולא להכביד על פעולות שגרתיות.

**סוגי ראיות:** CODE = כתוב בקוד; TEST = עבר בדיקה מבוקרת; DATA = נבדקו רשומות Base44; PROD = נבדק מסלול אמיתי לאחר פרסום; USER = המשתמש אישר במפורש.  
**סדר עדיפות:** P0 — הודעות חסרות/כפולות ושיבוצים תקועים; P1 — ביצועים, מדידה, נגישות ו־UX; P2 — תוספות שאינן חוסמות הפעלה.

## ב. תמונת מצב, נתונים ואבחון — 15.10.2026

### עובדות שנבדקו
- `WhatsAppOutbox`: 23 רשומות במדגם החי, מהן 21 `accepted` ו־2 `unknown`. **אף אחת מהן אינה ראיית מסירה לנמען.** שתי `unknown` הן `scheduled_notification` דרך Green API, מהתאריכים 14.10 ו־15.10. לא לשגר מחדש לפני אימות בספק.
- `WhatsAppQueueControl` בזמן המדגם: `enabled=true`, `paused=false`, עובד ללא lease תפוס; `green_interval_ms=3000`, `wasender_interval_ms=7000`, `max_messages_per_run=16`. ריצת עובד אחרונה שתועדה סביב 09:41 ב־15.10 שעון ישראל.
- בסקר 14.10 נמדד חציון של כ־4 דקות מרישום ל־accepted בקבוצה של 17 הודעות, ונצפו פערים של כחמש דקות בין אצוות למרות מרווח ספק של שלוש שניות. אין עדיין מדידות p95 תקינות של זמן שמירת שיבוץ בפרודקשן.
- שתי הודעות הסכם/לקוח מ־15.10 (09:11 ו־09:19 שעון ישראל) נכשלו לפני יצירת Outbox בגלל העברת `asServiceRole` במקום Base44 root client. הקוד שונה; שתי ההודעות **לא שוחזרו ולא נשלחו מחדש**.
- בתוכנית המקורית דווחו 13 התראות `WHATSAPP_QUEUE_ERROR`, חלקן חוזרות על אותו EventService. הכשל ב־catch אינו בהכרח הוכחה שההודעה לא נרשמה ממסלול אחר.
- קיימים מספר נתיבי תזכורות חופפים: `dailyScheduledNotifications`, `processScheduledPushNotifications`, `scheduleEventLifecycleNotifications`, `sendEventReminders`. התוכנית אינה מניחה שכל הנתיבים כרגע פעילים, רק שקיימת חפיפה בקוד שדורשת מיפוי.
- `node --test tests/*.test.mjs` בעת הסריקה: **176/177 עברו**, בדיקת RLS אחת ב־`EventAgreement` נכשלת (מצפה ל־`create=false` אך סכמה מאשרת מנהל). `npm run build` עבר. לא לשנות מדיניות אבטחה רק כדי לגרום לבדיקות לעבור.
- Base44 HEAD המקורי שנסרק: `17c7f0b`; checkpoint קודם `6ad0be8826a151c493e31216`. בעבודת אימות זהות נוספת נוצר checkpoint `6ad0bf85c616ac178b9bc786`. המסמך הורחב לאחר מכן ב־commit `c2b9b14`. **אין מכאן מסקנה שכל הקוד פורסם לפרודקשן.**

### תמונת מצב עסקית מבוקשת
- שיבוץ נשמר במהירות, ללא spinner ממושך כי שרת WhatsApp איטי; יצירת הודעת שיבוץ עמידה בפני סגירת דפדפן.
- אין הודעה שעוברת "בשקט" ללא Outbox או תקלה מזוהה; אין הודעה שנשלחת פעמיים.
- אין המתנה לפני ההודעה הראשונה כשהתור פנוי; מרווח בין הודעות ניתן להגדרה **לכל ספק במילישניות**.
- מסך אחד מציג סטטוסים מדויקים: מתוכננת, בתור, ניסיון, התקבל אצל API, נמסר רק עם הוכחה, כשל ודאי, תוצאה לא ידועה, בוטלה, פג תוקף, טופלה.
- תזכורות לאירועים קרובים נוצרות/נשלחות לפי מדיניות זמן ידועה, בלי להסתמך על כך שמישהו ערך ספק; פעמון מציג חריגים אמיתיים ולא שגיאות מטעות/חוזרות.
- Green API ו־WasenderAPI נשארים זמינים לבחירה, בלי שינוי בדיעבד של ספק הודעה קיימת.

---

## C — ביצועי שדרוג WhatsApp: מסמך נפרד לחלוטין

**התוכנית, המדדים, רשימת המשימות, מצב הביצוע, הרגרסיות וה־Backlog של שדרוג WhatsApp מנוהלים אך ורק בקובץ:** `docs/whatsapp-performance-and-reliability-plan-2026-10-15.md`.

כולל: `WhatsAppOutbox`, `WhatsAppQueueControl`, `whatsappQueueWorker`, continuation/wake, קצב לפי Green API ו־WasenderAPI, ספק נעול לפי הודעה, הודעות טקסט/מסמך/קבוצה, ביצועי HTTP, latency, SLA, `unknown`, תוכנית failover ו־rollback של שכבת WhatsApp. כל משימות C01–C16 הועברו כהיסטוריה למסמך העצמאי וממופות ל־WA-P. אין לסמן כאן התקדמות בתחום הזה.

**גבול תחומי:** תיקון זמן שמירת שיבוץ/UI נשאר בתוכנית הכללית D/G; בחירת אופן יצירת הודעת שיבוץ עמידה, מניעת כפל ופעולות Worker הן תלות למסמך WhatsApp — יש לעדכן בשני הקבצים רק קישור תלות, לא שני פנקסי ביצוע.

---

## D — שיבוצים והחזרת מהירות (P0)

**מפת קוד:** `src/components/assignments/SupplierAssignmentDialog.jsx`, `src/components/event-details/ServicesCard.jsx`, `src/pages/EventDetails.jsx`, `src/components/events/EventsBoard.jsx`, `src/lib/assignmentWhatsAppGuarantee.js`, `base44/functions/ensureAssignmentWhatsApp/entry.ts`, `handleEntityEvents/entry.ts`, `base44/shared/assignmentWhatsApp.ts`.

- [x] **D01 — חיווי כשל:** אחרי שמירת `EventService` קיימת בדיקה מפורשת ליצירת הודעת WhatsApp במקום הסתמכות רק על טריגר. **CODE** קודם.
- [x] **D02 — הורדת המתנות סדרתיות:** קריאת Event/Template/QueueControl/Service במקביל, ואת ספקי השיבוץ בקבוצות קריאה של שמונה; יצירת Outbox עדיין סדרתית. **CODE**.
- [x] **D03 — פעולות עצמאיות במקביל:** ארבעה מסכים משתמשים ב־`verifyAndRefreshAssignment` כדי לבצע בדיקת WhatsApp וחישוב סטטוס במקביל אחרי שמירת DB, ולא אחד אחרי השני. **CODE**. עדיין לא פתרון סופי ל־spinner.
- [x] **D04 — Push לספקים חדשים בלבד:** שינוי במסך EventDetails מפעיל Push רק ל־`added`, לא לכל מי שכבר שובץ לשירות. **CODE**.
- [x] **D05 — מניעת התראה מטעה:** בעת כשל ב־`handleEntityEvents` מתבצעת בדיקה ל־Outbox קיים לפני הכרזה על "לא נוצרה הודעה", ומוגבלת התראה פעילה אחת לכל שירות. **CODE**.
- [x] **D06 — חיסכון בשאילתות:** אין `User.list()` לכל תזכורת WhatsApp־בלבד כשאין ערוץ Push רלוונטי. **CODE**.
- [x] **D07 — מפת טריגרים קנונית (CODE REVIEW 15.10):** נמצאו שני workflows ל־EventService: `EventService Notification Trigger.jsonc` ב־UPDATE ו־`EventService Notification Trigger - Create.jsonc` ב־CREATE. שניהם מפעילים `handleEntityEvents`. ה־Frontend שומר `EventService` ואז קורא `verifyAndRefreshAssignment`, שבתוכו `ensureAssignmentWhatsApp` ו־`refreshEventStatus` במקביל; במסך EventDetails מופעל גם `notifySupplierAssignment` ל־Push. שני יוצרי WhatsApp קיימים: `handleEntityEvents` ו־`ensureAssignmentWhatsApp`, שניהם מפנים ל־`sendWhatsAppToChat` ול־Outbox לפי `assignmentWhatsAppKey`. Worker מופעל ע"י CREATE של `WhatsAppOutbox`, UPDATE של `WhatsAppQueueControl` (wake) ו־watchdog כל חמש דקות. **מיפוי קוד בוצע; מדידת זמני UI, ביטול/העברה בקצה ופיילוט עדיין פתוחים ב־D12–D17.**
- [ ] **D08 — מקור אמת בשרת אחד:** לבטל בעלות כפולה על יצירת WhatsApp בין Frontend safeguard ו־entity workflow. **אסור** להסיר את ה־await בדפדפן לפני שיש בקשת הודעה עמידה בשרת.
- [ ] **D09 — מפתח שיבוץ קנוני:** לא להשתמש ב־`updated_date` כדי להבדיל פעולת שיבוץ עסקית משינוי פרט אחר. להגדיר גרסת בקשת אישור/transition יציבה, כולל הוספה מחדש ומצב `rejected/confirmed → pending`.
- [ ] **D10 — יצירת הודעה עמידה:** שלב DB/Server transaction או אירוע change-log שיש בו סטטוס "דרישת הודעה נקלטה" לפני שה־UI מאשר; reconciler חסום־כפילויות יטפל בשיבוץ שנשמר אך enqueue נכשל.
- [ ] **D11 — UX שמירה מהיר:** להחזיר חיווי "השיבוץ נשמר" ברגע אישור DB, בלי לחסום על בקשת ספק; סטטוס הודעה עצמאי מתעדכן ברקע. לא fire-and-forget בדפדפן כתחליף למקור עמיד.
- [ ] **D12 — הסרת fetch כפול:** למדוד `refreshEventStatus` / `loadEventData` / `notifySupplierAssignment` ונקודות re-render; לדחות/למזג רק שאילתות שהוכחו כמיותרות.
- [ ] **D13 — בדיקת מהירות מספרית:** 1/5/10 ספקים, רשת איטית ונייד; למדוד p50/p95 בנתוני ניסוי; יעד מוצע p95 ~2 שניות עד חיווי שמירה, כפוף לבסיס אמיתי.
- [ ] **D14 — שיבוץ קבוצתי:** יעד `@g.us` מדויק, ללא fallback שקט למספר פרטי כשהמנהל בחר קבוצה. לוג שגיאה בטוח ליעד חסר.
- [x] **D15 — טקסט חסר שעה (CODE+TEST):** נמצא קוד `cleanMissingAssignmentTime` ב־`base44/shared/assignmentWhatsApp.ts` בשימוש במסלול הטריגר, ובדיקה `assignment message without a known time omits dangling בשעה . without fabricating a time` עוברת. **פיילוט תוכן ב־PROD עדיין נדרש**.
- [ ] **D16 — בטיחות פעולות:** double click, שני מנהלים עורכים אותו שיבוץ, ספק שמאשר בזמן עדכון, ביטול, החלפה והעברה — ללא כפילות/אובדן.
- [ ] **D17 — בדיקות פרודקשן:** הדיאלוג נסגר מהר, השיבוץ נשמר פעם אחת, Outbox מקושר, הודעה מתקבלת אצל ספק הבדיקה והדפדפן אינו נדרש.
- [x] **D18 — אין הצלחה מדומה ב־dedup (CODE+TEST 15.10):** `ensureAssignmentWhatsApp` החזיר בעבר `success=true` גם כאשר Outbox קודם באותו `idempotency_key` היה `failed/unknown/cancelled/expired/resolved`, כי סיווג אותו כ־`skipped`. כעת המצבים הללו מוחזרים כ־`success=false`, עם jobId ואזהרה למנהל **ללא יצירת שליחה חוזרת**. גם תשובה לא מזוהה כבר אינה `skipped` מוצלח. נוסף כיסוי בדיקות ל־failed/unknown/accepted ותשובה לא מזוהה ב־`tests/assignment-whatsapp-guarantee.test.mjs`.
- [ ] **D19 — PROD:** אחרי פרסום, לבדוק ש־D18 מוצג נכון בממשק ושלא נוצרים retry או הודעות נוספות כאשר קיימת שגיאת עבר במפתח עסקי זהה.

- [x] **D20 — שעת שיבוץ חסרה (CODE+TEST 15.10):** הפונקציה `cleanMissingAssignmentTime` ב־`base44/shared/assignmentWhatsApp.ts` מנקה רק ביטוי "בשעה ." כשהשעה חסרה, הן בתבנית הנבנית דרך `ensureAssignmentWhatsApp` והן ב־`handleEntityEvents.triggerWhatsApp`. אם קיימת שעה, שומרים אותה ללא שינוי. נבדק ב־`tests/assignment-whatsapp-guarantee.test.mjs` וב־`tests/assignment-trigger-quiet-outbox.test.mjs`. **נדרשת עדיין בדיקת תוכן LIVE לאחר פרסום.**
- [x] **D21 — שעות שקט עם מפתח ותור אחיד (CODE+TEST 15.10):** לפני השינוי, הטריגר שמר הודעת שיבוץ בשעות שקט ב־`PendingPushNotification` עם מפתח `scheduled-wa:<pendingId>`, בעוד בדיקת השיבוץ שמרה את אותה הודעה ב־`WhatsAppOutbox` עם מפתח `assignment:<serviceId>:<supplierId>:<updated_date>:SUPPLIER_NEW_ASSIGNMENT` — ולכן היה סיכון לשליחה כפולה כשהגיע זמן ההמתנה. מעכשיו **המסלול של הודעת שיבוץ** משתמש ב־`assignmentWhatsAppContext`, `resolveNotificationDelay(supplier)` ו־`availableAt` בתוך Outbox *בשני היצרנים*, גם בשעות שקט/שבת. נתיבי Pending של **תבניות שאינן הודעת שיבוץ** לא שונו.
- [x] **D22 — בדיקת שעות שקט (TEST 15.10):** `tests/assignment-trigger-quiet-outbox.test.mjs` מפעיל את קוד `triggerWhatsApp` האמיתי בסביבה מדומה עם תזמון עתידי; מאמת Outbox יחיד, מפתח אחיד, `availableAt` ו־**אפס** יצירות Pending נוספות. `assignment-whatsapp-guarantee.test.mjs` בודק בנפרד אותו context עבור שני היצרנים. **לא בוצעה שליחה אמיתית**.
- [x] **D23 — תאימות SDK (CODE+TEST 15.10):** ה־SDK הישן של `handleEntityEvents` עודכן מ־`0.8.6` לגרסת `0.8.38` שכבר שימשה במסלול השרת הפעיל; המודול עבר parse ו־Build. תאימות וטריגרים בפרודקשן עדיין דורשים אימות.
- [ ] **D24 — PROD:** לבדוק שיבוץ יחיד בזמן quiet-hours/שבת לפי מדיניות הנמען: Outbox יחיד עם `availableAt`, אין Pending כפול, אין מסירה מוקדמת, השליחה נשמרת אחרי סגירת דפדפן, וכל שינוי נוסף אינו יוצר הודעה חדשה בטעות.
- [ ] **D25 — GROUP SAFETY:** ב־`supplierTargetChatId` וב־`getSupplierWhatsAppTarget` יש עדיין fallback למספר פרטי כאשר הוגדר יעד קבוצה אך chat ID אינו תקין. נדרש להחליט על כשל סגור עם הודעת מנהל במקום ניתוב בשקט למספר אחר; לכתוב בדיקות לפני המימוש.
- [x] **D26 | CODE+TEST 15.10** ב־`handleEntityEvents` נכנס Cache **לריצה אחת בלבד** עבור נתוני Event/Service/Supplier שכבר נטענו בתזכורות שיבוץ, ומשותפים גם להודעות השיבוץ המיידיות. בבדיקת יצירת 3 שיבוצים וקלקול תזכורת אחד נדרשו קריאת Event.get יחידה ו־Service.get יחידה, בלי להשמיט 3 הודעות שיבוץ. אין cache חוצה משתמשים ואין שינוי נוסח/יעד הודעה. **אימות ביצועי UI בפרודקשן עדיין פתוח ב־D13/D17**.

### D08–D11 — פירוק העבודה הארכיטקטונית למקטעים מחייבים

- [x] **D08.1 | CODE REVIEW 15.10** נכתבה מטריצת כל מעבר עסקי רלוונטי להלן, עם הבחנה בין הודעת שיבוץ ראשונית, תזכורת אישור והתראות שינוי/ביטול. מטריצת המימוש החדש עדיין טעונה בדיקות לפני קוד שיחליף את היצרנים.
**מטריצת D08.1 — שינוי ב־EventService → פעולה רצויה**

| מעבר | הודעת שיבוץ חדשה | תזכורת אישור | הערות בטיחות |
|---|---|---|---|
| ספק לא משובץ → נוסף כ־pending | כן, פעם אחת | אחת, אם זמן האירוע מאפשר | מזהה מעבר עמיד, לא `updated_date` בלבד |
| ספק חדש נוסף בסטטוס confirmed/rejected | לא לבקש אישור | לא | לא להודיע בטעות שכבר יש בקשת אישור |
| pending → confirmed | לא | לעצור/לדלג על הקיימת | אין לשלוח הודעת שיבוץ חדשה |
| pending → rejected | לא | לעצור/לדלג | הודעת דחייה למנהל נפרדת ובכפוף לתבנית |
| rejected/confirmed → pending | כן, גרסה חדשה | אחת לתקופה החדשה | אותו supplierId, **revision חדש** |
| ספק הוסר | לא | לבטל תזכורות לא רלוונטיות | הודעת ביטול נפרדת רק אם אושר בעבר, בהתאם לכלל הנוכחי |
| שינוי הערות/מחיר/מועד ללא שינוי שיבוץ | לא | לא לייצר מחדש | שינוי מועד מהותי נשאר בתהליך אישור מנהל הקיים |
| שני מנהלים שומרים במקביל | אפס או אחת לכל מעבר מאושר | ללא כפל | CAS או revision; last-write-wins ללא ביקורת אינו מספיק |
| יעד קבוצת WhatsApp מוגדר ותקין | לקבוצה בלבד | ליעד שנבחר | `@g.us` מאומת, אין שינוי שקט בפרטי קשר |
| יעד קבוצה שגוי / טלפון חסר | להציג חריג | לא לשלוח ליעד חלופי שקט | **D25 פתוח — נדרש אישור התנהגות סופית** |
| שעות שקט / שבת | ליצור Outbox זמין בעתיד בלבד | לפי מדיניות רלוונטיות | מפתח זהה גם ב־trigger וגם במסך, אין Pending נוסף |
| הודעת ספק קודמת unknown | לא replay אוטומטי | לא להניח נמסר | בדיקת היסטוריית ספק לפני פעולה |

- [x] **D08.2a | CODE+TEST 17.10 — מקור אמת עמיד בצד שרת:** נבנו `base44/shared/assignmentIntent.ts` ו־`base44/functions/saveSupplierAssignmentsV2/entry.ts`: שמירת `supplier_ids`, `supplier_statuses`, `supplier_notes` ויומן בקשות WhatsApp מבוצעת **באותו `EventService.updateMany` עם תנאי CAS על `id+updated_date`**, ולא בשתי פעולות נפרדות שעלולות להשאיר שיבוץ ללא Intent. בקשת שמירה ישנה/מקבילה מקבלת 409. נבדק בסימולציה; **אטומיות SDK מול Base44 LIVE טרם אומתה**.
- [x] **D08.2b | CODE+TEST — התאוששות לאחר CAS:** נשמר `assignment_intents_pending=true`, מנגנון `reconcileSupplierAssignmentIntents` מוצא בקשות שלא הגיעו ל־Outbox ומנסה רק `enqueue` לפי מפתח קבוע. נוצר טריגר UPDATE חדש על `assignment_intent_wake_at` באמצעות `EventService.update()` **לאחר** כתיבת CAS, ולא מסתמכים על `updateMany` שיפעיל Workflow. עובד התור המתוזמן הקיים משמש גיבוי, בלי אוטומציה מתוזמנת נוספת. טיפול מרבי 8 Intents בקריאה; ב־Watchdog עד 4 שירותים ו־4 Intents לכל שירות. ה־reconciler נעצר אם Feature Flag כבוי.
- [ ] **D08.2c | PROD:** לאמת בפיילוט מאושר ש־`EventService.updateMany` אכן מבצע CAS אטומי נגד עריכה בו־זמנית, ששדה wake חדש מפעיל Workflow, ושה־Watchdog התאושש כאשר ה־wake נחסם. לא לבצע בדיקה על שיבוצים עסקיים קיימים.
- [x] **D08.3a | CODE+TEST — מפתח מעבר קבוע:** לכל מעבר `not_assigned→pending` או `confirmed/rejected→pending` נוצר `revision` עולה ושדה יומן `assignment_notification_intents`. מפתח: `assignment:<eventServiceId>:<supplierId>:r<revision>:SUPPLIER_NEW_ASSIGNMENT`. שינוי הערות/מחיר/פרטי שירות אינו מעלה revision. `assignmentWhatsAppKey()` משתמש במפתח ה־Intent לשירותים במצב `durable_v1`, ומשאיר את המפתח הישן **ללא שינוי** בשירותי Legacy. בדיקות transition, two producers, note edit ו־reopen עברו.
- [ ] **D08.3b | MIGRATION SAFETY:** להוכיח rollback לאחר שכל מסכי העריכה עברו ל־V2; כאשר חוזרים ל־Legacy אסור ששיבוץ חוזר ישתמש בטעות במפתח V2 ישן. נדרש מסלול כיבוי שמטפל גם בשירותים ש־`assignment_intent_mode=durable_v1`, לא רק בכיבוי Feature Flag.
- [x] **D08.4a | CODE+TEST — מבנה Intent:** נוספו ב־`EventService.jsonc` השדות `assignment_intent_mode`, `assignment_intent_revision`, `assignment_notification_intents` (JSON תחום עד 120 בקשות), `assignment_intents_pending`, `assignment_intent_wake_at`. כל Intent כולל `key`, `supplier_id`, `revision`, `transition`, `state`, `created_at`; אחרי reconcile גם `outbox_id` ו־`resolution/last_error` במידת הצורך. ערכי סטטוס: `requested`, `queued`, `accepted`, `failed_definite`, `unknown`, `cancelled`, `resolved`. **`accepted` = אישור API, לא הוכחת מסירה**. אין מספר טלפון או טקסט הודעה בתוך היומן.
- [ ] **D08.4b | UI/AUDIT:** להציג תוצאה בנפרד לשיבוץ ולכל בקשת הודעה, עם קריאת סטטוס Outbox העדכני; אין להציג את ערך ה־journal כאישור מסירה. לתכנן טיפול כאשר היומן מגיע למגבלת 120 ללא מחיקת בקשות שאינן מבוררות.
- [x] **D08.5a | CODE+TEST — מניעת כפילויות:** Reconciler בודק `WhatsAppOutbox` לפי `idempotency_key` **לפני** יצירה; הבקשה המקורית ו־handleEntityEvents משתמשים באותו מפתח כאשר `assignment_intent_mode=durable_v1`. ה־Outbox שומר CAS/נעילה מרכזית. בדיקות: שני מנהלים באותו revision (רק אחד שומר), שני reconcilers בו־זמנית (רשומת Outbox יחידה), קריסה **אחרי** יצירת Outbox ולפני receipt (בקריאה הבאה נמצא קיים), מסר `unknown` ללא replay, ספק שביטל/אישר, ומצב `accepted` שאינו הופך בדיעבד ל־cancelled.
- [ ] **D08.5b | PROD+CONCURRENCY:** לבחון trigger legacy ו־Reconciler שמתחרים בפועל בזמן שיבוץ, תזכורת שיבוץ והפעלה חוזרת של Worker לאחר קריסה. אין לשנות ספק או להפעיל retry כללי במהלך הבדיקה.
- [x] **D08.6a | CODE+TEST — מתג כבוי וחזרה בטוחה בקוד:** `AppSettings.setting_key=assignment_intent_v1_enabled` חייב להיות רשומה **אחת בדיוק** עם `setting_value='true'` כדי להתיר mutation/reconcile; **היעדר רשומה = כבוי**. ב־17.10 שאילתת DATA לא מצאה רשומה כזאת ולא נמצאו רשומות `EventService.assignment_intents_pending=true`. ללא המתג אין כתיבת Intent או שליחת הודעה, וה־Watchdog אינו סורק EventService. אין תלות בבחירת ספק Green/Wasender.
- [ ] **D08.6b | ROLLBACK PROD:** תהליך כיבוי מדורג לשירותים שכבר עברו ל־V2, כולל Pending/Unknown, ניקוי `mode` כאשר מתאים, ויכולת להחזיר את ארבעת מסכי השיבוץ ל־Legacy **בלי לשגר שוב בקשות עבר**. לא להפעיל את המנגנון טרם פתרון זה.
- [ ] **D08.7 | BLOCKER לפני הפעלה — שאר ערוצי ההתראות:** `EventService.updateMany` ב־V2 נבחר בגלל CAS אבל לא ניתן להניח שהוא מפעיל את ה־workflow הקיים `EventService Notification Trigger` על `supplier_ids` / `supplier_statuses`. לכן **אסור להפעיל V2 לפני שמוכחת רציפות** של תזכורת אישור שיבוץ `PendingPushNotification`, הודעות Push לספק, הודעות מנהל על דחייה, ולוגיקת סטטוס/יומן. ה־wake החדש מפעיל כרגע רק Intent WhatsApp; נדרש עסקית לשמר את כל יתר ההשלכות של שינוי השיבוץ, עם מניעת כפל בכל ערוץ.
- [ ] **D08.8 | COVERAGE — כל נקודות כתיבת שיבוץ:** לבדוק/להעביר ל־V2 את המסכים `SupplierAssignmentDialog`, `EventsBoard`, `ServicesCard`, `EventDetails`, וכן עריכות שיבוץ ב־`AdminDashboard`, `SupplierManagement`, `EventForm` ופעולות Backend, או להוכיח שאינן יוצרות הודעת שיבוץ חדשה. **לא להפעיל V2 בעוד כותב Legacy ממשיך לשנות `supplier_ids` / `supplier_statuses` ללא revision.**

### D08 — תנאי מעבר קשיחים (Go/No-Go)

1. **ברירת מחדל OFF בלבד:** לא ליצור את `AppSettings.assignment_intent_v1_enabled=true` לפני אישור לאחר פיילוט, השלמת D08.7/8 ו־D08.6b. המתג הזה **אינו** הגדרת ספק WhatsApp, ואסור לחשוף אותו כעוד כפתור פעיל בדף ההגדרות כרגע.
2. **שמירת DB:** יש להוכיח ב־Base44 Preview ששתי בקשות עם `expectedUpdatedAt` זהה לא משבצות שתי גרסאות במקביל; אם `updateMany` לא מעדכן `updated_date` אוטומטית או ה־CAS אינו אטומי בפועל — לעצור את המעבר ולבנות מנגנון version/fencing בשרת.
3. **התעוררות:** לבדוק שה־`EventService.update({assignment_intent_wake_at})` אחרי CAS מעורר רק את Workflow החדש, בלי ליצור הודעות שיבוץ Legacy נוספות; לעקוב אחרי גיבוי ה־Watchdog הקיים. בלי ודאות לגבי wake לא מסמנים PROD.
4. **אותן תופעות לוואי עסקיות:** Push, תזכורות אישור, סטטוס אירוע, יומן ספק ואישור ספק אינם נעלמים. לא להסתפק בכך שהודעות WhatsApp נוצרו.
5. **תחרות ואיבוד קישוריות:** שני מנהלים, כיבוי דפדפן מיד אחרי שמירה, כשל אחרי יצירת Outbox ולפני receipt, חידוש status, תוצאה unknown, הצטרפות/הסרה וחזרה לשיבוץ — ללא שליחה כפולה או שיבוץ שנעלם.
6. **חוויית משתמש:** דיאלוג שיבוץ נסגר ברגע שקיים `saved:true` ו־intent עמיד (לא אחרי משלוח), וחיווי אחר כך מבחין `requested`/`queued`/`accepted`/`unknown`/`failed` בלי שגיאת שמירה מדומה. לא לחסום את המסך על תוצאת Provider.
7. **Rollback אמיתי:** מתג כבוי בלבד אינו מספיק לשירותים שיש להם `assignment_intent_mode=durable_v1` — יש לטפל בהיסטוריה ובמפתח הישן; אין למחוק Outbox/Unknown או לשגר שוב הודעות כדי להחזיר גרסה.
8. **אישור הפעלה:** פיילוט במספר/משתמש בדיקה מאושר בלבד. בלי ממצאי ביצועים ומסירה אמיתיים אין טענת Production Ready.

- [ ] **D09.1** להעביר את ארבעת מסכי השיבוץ ל־persist intent בשרת, ואז **להפסיק להמתין ל־HTTP לספק**, רק אחרי שבקשת הודעה עמידה נמצאת ב־DB.
- [ ] **D09.2** UI מציג בנפרד "השיבוץ נשמר" ו"ההודעה ממתינה/נכשלה/נמסרה עם הוכחה", ולא חלון מתמשך שמונע עבודה.
- [ ] **D09.3** בדיקות תחרות והמשך עיבוד כשמנהל יוצא מהמסך; לא להחליף בהפעלת Promise לא־ממתין בדפדפן.
- [ ] **D10.1** מבחן עומס 1/5/10 ספקים ו־p95 ברשת סבירה; להשוות למצב הבסיס, לתעד תוצאות ולא לנחש.
- [ ] **D10.2** בדיקת רגרסיה רוחבית: תשלום, שינוי תאריך אירוע, אישור ספק, ביטול שיבוץ, קבוצה, מסמך, הגדרות התראה, הרשאות וספק חלופי.


**תנאי קבלה:** שיבוצים חדשים יציבים ומהירים; אין תלות בתוצאת ספק בהשלמת שמירת DB; כל שינוי עסקי יוצר אפס או הודעת אישור אחת מתועדת — לפי כללים מפורשים.

## E — תזכורות אירוע, תזכורות אישור והתראות מתוזמנות (P0)

**מפת קוד:** `processScheduledPushNotifications`, `dailyScheduledNotifications`, `scheduleEventLifecycleNotifications`, `sendEventReminders`, `handleEntityEvents`, `base44/shared/assignmentReminderTiming.ts`, מודלים `PendingPushNotification` ו־`NotificationTemplate`.

- [x] **E01 — הפרדה עסקית:** תזכורת יום־לפני אירוע ≠ תזכורת "נא לאשר שיבוץ" ≠ הודעת שיבוץ ראשונית ≠ תזכורת תשלום. **ANALYSIS**.
- [x] **E02 — owner יחיד לתור Pending:** הוסרה מ־`dailyScheduledNotifications` התערבות ב־`PendingPushNotification` וסימון `is_sent` מוקדם מדי; הסריקה השעתית נשארה המטפלת. **CODE**.
- [x] **E03 — הסרת ניקוי כפול:** הסריקה היומית אינה עוד קוראת ומנקה Pending של המעבד האחר. **CODE**.
- [x] **E04 — fanout חלקי בטוח:** כשל של נמען אחד ב־WhatsApp enqueue לא מסמן את אירוע המקור כהושלם; הריצה הבאה משחזרת רק חסר בעזרת מפתח idempotency. **CODE+TEST**.
- [x] **E05 — בדיקה חוזרת:** `tests/whatsapp-scheduled-owner.test.mjs` מכסה כשל לנמען שני ו־retry לנמען החסר בלי כפילות ראשון. **TEST**.
- [x] **E06 — cutoff לתזכורת אישור:** מונעים תזכורת לאישור שיבוץ לאחר שעת התייצבות/פתיחת אירוע, כולל DST בירושלים. **CODE+TEST**, `assignmentReminderTiming.ts`.
- [x] **E07a | CODE+TEST 17.10 — WhatsApp בלבד:** שני יצרני תזכורת האירוע (`dailyScheduledNotifications` ו־`sendEventReminders`) יוצרים כעת **אותו מפתח עסקי** עם סוג תזכורת+Event+תאריך/שעה+תזמון+recipient, ושעות שקט מעבירות אותו ב־`PendingPushNotification` עד worker. שינוי שדה שאינו רלוונטי אינו מייצר הודעת WhatsApp חדשה. הבדיקות ב־`tests/whatsapp-event-reminder-idempotency.test.mjs` עברו. ביצועי Idempotency/Outbox מתועדים *רק* במסמך WhatsApp.
- [ ] **E07b | P0 — איחוד מקור עסקי של כל הערוצים:** ההגנה על WhatsApp לבדה **לא** מבטיחה InApp/Push יחיד. שני מנגנוני תזכורת האירוע עדיין יכולים ליצור שתי רשומות לוג/Push נפרדות או לחסום שליחה לאחר שינוי אירוע. יש לבחור מקור יחיד או Intent רב־ערוצי עם tracking לנמען לפני ביטול יצרן Legacy; ללא replay של הודעות היסטוריות.
- [ ] **E08 — אירועים היסטוריים ושינוי תאריך:** ליצור/לבטל תזכורות חדשות במעבר סטטוס/יום, בלי לשגר ישנות; יש לבחון אירועים שנוצרו לפני יצירת lifecycle scheduler.
- [ ] **E09 — בקרה לאירועים הקרובים:** כל אירוע פעיל ב־48 השעות הבאות חייב תזכורת מחייבת או הסבר מדוע היא לא נדרשת, עם מצב `scheduled/queued/accepted/unknown/failed`; אין replay אוטומטי אם חסרה היסטוריית ספק.
- [ ] **E10 — מניעת שליחה מאוחרת:** אירוע שהתחיל / שירות שהתחיל / שבת ושעות שקט — לדחות רק אם עדיין רלוונטי; אחרת `skipped/expired` עם סיבה.
- [ ] **E11 — state machine רב־ערוצי:** `is_sent` פירושו מקור שטופל ולא הוכחת מסירה של Push/WhatsApp; לנהל status נפרד לפי ערוץ ומקבל.
- [ ] **E12 — תזכורת לאישור שיבוץ:** להציב "שולי ביטחון" לפני התחלה (למשל שעתיים) רק לאחר אישור. בינתיים לא אחרי שעת התחלה.
- [ ] **E13 — נתוני 14/15 באוקטובר:** לתעד למשפחת חכים שבע הודעות `accepted` בלי מסירה מוכחת; למשפחת רהב לא נמצאה תזכורת ב־Outbox החדש במדגם — לבדוק ערוצים קודמים, לא להניח כשל/לשלוח מחדש.
- [ ] **E14 — אבטחת retry לתזכורות:** 429 דחייה ברורה מול timeout לא ידוע, מניעת כפילות בין Push, WhatsApp ו־Cron.
- [ ] **E15 — פיילוט:** אירוע בעוד 24–48 שעות בנתוני בדיקה, שינוי תאריך, שינוי סטטוס, שעת האירוע, ימים עבריים/לועזיים, עובדים סגורים, שעון קיץ.
- [ ] **E16 — היסטוריה ביקורתית:** לא למחוק רשומת Pending אחרי `is_sent=true` לפני שנשמרה ראיה שניתנת לאיתור במערכת ההודעות.
- [x] **E17 | CODE+TEST 15.10** פונקציית `pendingApprovalReminderSupplierIds()` ממזגת ספק חדש ומעבר סטטוס ל־pending *למועמד יחיד*, מתחשבת בספקים שעדיין משובצים, מדלגת על confirmed/rejected ולא מייצרת תזכורות כפולות בגלל אותו שינוי סטטוסים. בדיקות ב־`tests/assignment-reminder-timing.test.mjs`.
- [x] **E18 | CODE+TEST 15.10** תזכורת כושלת לספק אחד אינה מפסיקה טיפול בהודעות שיבוץ מיידיות ובהתראות ספקים אחרים. `handleEntityEvents` מטפל בשגיאה לכל ספק, מחזיר מספר `reminder_schedule_errors` ובאותה ריצה משתמש ב־cache אירוע/שירות/משתמשים במקום לטעון לכל ספק. בדיקת VM אינטגרטיבית: 3 ספקים, תזכורת אחת נכשלת, נוצרות 2 תזכורות תקינות ו־**3 הודעות שיבוץ ממשיכות להיווצר**; template/Event/Service/User נטענים פעם אחת. **עדיין לא PROD**.
- [x] **E19 | CODE+TEST 17.10 — האצת חישוב תזכורות:** `dailyScheduledNotifications` ו־`sendEventReminders` מקימים `indexEventServicesByEvent` ו־`indexEventReminderReceipts` פעם אחת לכל ריצה, במקום לסרוק את כל שירותי האירועים ואת התראות העבר לכל אירוע+ספק/מנהל. בדיקות התאמה ל־4,200 שירותים, 215 אירועים וסדר התוצאה עברו. **לא** נמדד זמן CPU/רשת בפרודקשן.
- [x] **E20a | CODE+TEST 17.10 — סימון משימה לאחר הוכחת Queue בלבד:** ב־`dailyScheduledNotifications` הוסרה כתיבת `Task.whatsapp_notification_sent` מתוך Phase 6.5. Phase 7c מסמנת Task **רק אחרי** שכל מנהל רלוונטי קיבל Outbox `queued/accepted/sending/retry_wait` או InApp נוצר במסלול Push-only. `Task.updateMany` מחייב אותה גרסת `due_date` ומשימה שלא הושלמה. הודעה כושלת לנמען אחד אינה מסמנת את המשימה, והנמען שכבר נקלט לא יקבל הודעה שנייה בעת retry בזכות `taskDigestWhatsAppKey`. `tests/task-digest-outbox-ack.test.mjs` כולל VM של כל הפונקציה, שני מנהלים, כשל חלקי, Push-only ושינוי due date.
- [x] **E20b | CODE+TEST — הכרעה על בעלות המתזמן:** `scheduleTaskReminder` יוצר הודעת Task עם מפתח קבוע למנהל+מזהה Task+גרסת תאריך (גם כש־Pending נמחק ונוצר מחדש). לפני Phase 6.5, `readScheduledTaskOwners` טוען רק Pending של המשימות הרלוונטיות, בודק `task_due_date` מקורי, ובמצב `is_sent` עם WhatsApp דורש קישור Outbox שאינו `unknown`. המנגנון היומי מדלג על הנמען שהמתזמן כבר אחראי לו; כל Pending שעדיין ממתין מונע כתיבת דגל Task שתמחק אותו בעקבות Task.update. בדיקות `tests/task-schedule-stable-key.test.mjs` ו־`task-digest-outbox-ack.test.mjs` עברו. **אין replay ל־unknown.**
- [ ] **E20c | P0 — מקור אחד עם תיעוד Push ו־WhatsApp לכל נמען:** `Task.whatsapp_notification_sent` עדיין דגל יחיד המשותף למספר מנהלים/ערוצים. אם `InApp/Push` נוצר אך WhatsApp נכשל, הריצה הבאה עלולה ליצור שוב InApp/Push; אם WhatsApp נקלט אך Push נכשל, דגל Task עלול להסתיר כשל ערוץ שני. נדרש מזהה הודעה עמיד גם לערוץ Push/מראה InApp ו־CAS בין יצרנים, בלי לשנות את המדיניות העסקית של עיכול משימות מאוחד. היסטוריית Pending מעל 7 ימים מתנקה ולכן לא להניח ששתיקה מספיקה כהוכחת מסירה.
- [x] **E21a | CODE+TEST — בדיקת התאמת מקור ↔ Outbox ללא שליחה:** הוספה פעולת `sourceAudit` למנהל בעלים בלבד. משווה במדגם metadata בלבד: Outbox `accepted` מול `InApp.whatsapp_sent=false`, Outbox `unknown` מול InApp שסומן true, ומקור ישן שאינו מקושר. אינו מסיק אובדן ממקור היסטורי/Push-only, אינו יוצר הודעות ואינו משנה מצב לקוחות. פעולת הבדיקה אינה נטענת בהצגת דף הגדרות הרגיל. `tests/whatsapp-source-audit.test.mjs` והרשאות ב־`whatsapp-queue-admin.test.mjs`.
- [ ] **E21b | P0 — התאוששות מקור עסקי בטוחה:** מקור שנרשם ב־`InAppNotification` **לפני enqueue** עלול להיחשב קיים ולהידחות בריצה הבאה בלי Outbox. האבחון החדש מאתר פערים בלבד; טרם קיימת פעולה אוטומטית בטוחה ליצירת Intent עמיד/תיקון מקור ללא כפילויות. אין לשגר מחדש מקור היסטורי/unknown רק מפני שאין קישור ל־Outbox במדגם.
- [x] **E21c | CODE+TEST 18.10 — תיקון אוטומטי מוגבל לסטטוס מקור שהספק כבר אישר:** אם Worker קיבל ACK מפורש של ספק WhatsApp אך עדכון `InAppNotification.whatsapp_sent` נכשל, `WhatsAppOutbox.mirror_sync_pending` יסומן. ב־watchdog הקיים מבוצע `reconcileAcceptedWhatsAppMirrors` על עד 10 עבודות `accepted` שסומנו מראש; ללא מגע עם WhatsApp/Push ותוך CAS וניקוי הדגל. `attachOutboxInAppReceipt` טופל גם ל־dedupe accepted (queued=false), מסרב לדרוס מקור קודם ולא מקשר Unknown. החיבור למנגנון במישור הטכני מתועד בנפרד ב־WA-P42c. **E21b עדיין פתוח** לסוגי מקור אחרים או מצב שבו InApp נוצר לפני ניסיון enqueue/לא יצר Outbox.
- [x] **E22 | CODE+TEST — פעולות שינוי שיבוץ מחזירות כשל אמיתי:** שלוש פונקציות שינוי השיבוץ/זמן התייצבות (`handleSupplierArrivalTimeChange`, `cancelAssignmentsAfterDateChange`, `confirmReassignAfterDateChange`) כבר אינן בולעות שגיאת קליטת WhatsApp. אם לפחות התראת חובה אחת נכשלת, מחזירות `409/recovery_required`, משאירות ביטול שיבוצים לא מבוצע/אירוע `date_change_pending_action` לא מנוקה, ובכך מאפשרות ניסיון חוזר עם מזהה עסקי יציב. הספקים שאצלם קיימת הודעה בתור אינם מקבלים חדשה עבור אותו מעבר. **מגבלה:** `confirmReassignAfterDateChange` מעדכן סטטוסי ספק ל־pending לפני אישור כל Outbox; תיקון טרנזקציוני מלא הוא חלק מ־D08.7/D08.6b. Push שבוצע לפני כשל אינו עדיין idempotent; אסור להציג הבטחה ל־exactly once בכל הערוצים.
- [x] **E23 | CODE+TEST — אין הצלחת־שווא של Push לספק:** `sendPushNotification` מחזיר כישלון חלקי בפירוט גם אם אין טוקן, או Firebase מאותחל באופן שגוי, ושומר תוצאת WhatsApp הבלתי תלויה. `notifySupplierAssignment` מעביר את כשל Push/אין טוקן ללקוח; `EventDetails.handleAssignSuppliers` מציג אזהרה שהשיבוץ נשמר אבל ה־Push לא אומת, במקום להציג שגיאה בשמירת השיבוץ. בדיקות `tests/send-push-whatsapp-partial.test.mjs`, `notify-supplier-push-report.test.mjs`. **עדיין פתוח:** D08.7 לבניית מקור אמת וקיבוץ Push עמיד שאינו מאריך זמן שמירת שיבוץ.

**תנאי קבלה:** אין אירוע קרוב עם תזכורת חסרת סטטוס; אין תזכורת מאוחרת/כפולה; כל נמען שנכשל נכנס למסלול תיקון מבוקר וגלוי.

## B — לקוחות, הסכמים, מסמכים וקישורים (P0)

- [x] **B01 — תיקון root client:** `agreementLifecycle.deliver` משמש scoped service-role ל־DB ושורש תקין ל־WhatsApp enqueue; זה פתר את כשל הקוד הנצפה של שתי ההודעות בלי לתקן היסטוריה אוטומטית. **CODE+TEST**.
- [x] **B02 — PDF/קבצים פרטיים:** קובץ נשמר כהפניה פרטית ב־Outbox, קישור חתום נוצר סמוך לשליחה. **CODE+TEST**.
- [x] **B03 — קישור כרטיס:** אותו root-client תוקן ב־`invoice4uStoredCards`. **CODE+TEST**.
- [x] **B04 — כשל mirror:** אם ה־Outbox כבר קיבל receipt, כשל כתיבת סטטוס משני ל־`ClientMessageDelivery` לא יוצר שגיאת false failed. **CODE+TEST**.
- [x] **B05 — איחוד הודעות פעמון:** התראת "נדרשת בדיקת תור הודעות לקוח" אינה נוצרת שוב אם יש אחת פתוחה לאותו אירוע/מנהל. **CODE+TEST**.
- [x] **B06 — סטטוס הזמנה ותשלום:** מסך EventClosingPanel מבדיל בין `queued` ל־`accepted`; Audit מזהה `invitation_queued` ו־`reminder_queued`, ואינו קורא לתור "נשלח ללקוח". **CODE**.
- [x] **B07 — סנכרון expiry:** ביטול/פקיעת תוקף של הודעה ב־Outbox מתעדכן גם ברשומת הלקוח המקושרת. **CODE+TEST**.
- [x] **B08 — כיסוי בדיקות:** `tests/agreement-whatsapp-context.test.mjs` מכסה הזמנה, PDF, כשל, mirror וכרטיס; בדיקות נוספות ל־worker. **TEST**.
- [ ] **B09 — PROD: קישור הסכם:** על מספר בדיקה מאושר, queue→accepted→אם נתמך delivered; לא לשלוח ללקוח אמיתי בלי אישור.
- [ ] **B10 — PROD: PDF וחשבונית:** לבדוק קישור חתום, פרטיות URL, פקיעת תוקף, דחיית תור, ספק Green/Wasender.
- [ ] **B11 — reconcile mirror:** לתקן `ClientMessageDelivery=dispatching` כאשר Outbox כבר `accepted/unknown/expired` בלי לייצר retry לספק.
- [ ] **B12 — שתי הודעות failed היסטוריות:** לא לשגר מחדש; נדרש בירור אצל ספק/אישור מנהל.
- [ ] **B13 — מסלולי שגיאה אחרים:** לעבור על invoice, quote, client billing, card, payment links ולוודא root-client נכון, idempotency, receipt ואזהרה מדויקת.
- [ ] **B14 — בדיקת ביצועים:** תהליך הפקת PDF/חתימה לא נחסם על timeout של ספק; UX נשאר מהיר, אך אסור לאבד מסר.
- [x] **B15 | CODE+TEST 17.10 — הודעות חיוב:** `sendClientMessage` בודק receipt לפני שיצר הצלחה; תזכורת `Payment` וקבלת סליקה קיבלו מפתח WhatsApp קבוע לפי מזהה התשלום (ותאריך expiry לתזכורת קישור). `failed` ודאי יכול לבצע fallback לאימייל כפי שהיה; `unknown` אינו גורר אוטומטית אימייל נוסף שיכול להיחשב הודעה כפולה. כשאין ערוץ מאושר הפונקציה מחזירה שגיאה למקור. בדיקות ל־7 מצבים ב־`tests/client-billing-whatsapp-receipt.test.mjs`. אין שינוי בסכומי תשלום, גבייה או מסמכים.
- [ ] **B16 | P0 — קשר לסטטוס תשלום:** יש לאמת ש־`Payment.link_reminder_sent=true` נקבע לפי Intent/Queue מוכח, ושכשל ספק מאוחר לא מוחק את יכולת הבקרה וההתאוששות. אם fallback לאימייל נכשל אחרי שהשרת שלח אותה אבל לפני כתיבת סטטוס Payment, אסור לשלוח אימייל כפול באופן עיוור. נדרש אודיט והחלטת מדיניות, ללא חיוב אוטומטי.

## F — פעמון, התאוששות ופעולה ידנית (P0)

- [x] **F01 — זוהתה הצפה:** catch בתבנית יכול להפיק שגיאה למרות Outbox קיים ממסלול אחר; ההתראה אינה ראיה מספקת שלא נשלח.
- [x] **F02 — guard לשיבוץ:** ב־`handleEntityEvents` בודקים קיום Outbox ב־idempotency key לפני התראת כשל, ונמנעת התראה פתוחה חוזרת לאותו EventService. **CODE**.
- [x] **F03 — guard להסכמים:** התראה פתוחה אחת ללקוח/אירוע על כשל הכנסת הודעה. **CODE**.
- [ ] **F04 — סיבת תקלה:** תיעוד `jobId`, `sourceId`, `phase`, סוג ספק וקוד שגיאה ללא גוף הודעה/טלפון בלוגי מערכת.
- [ ] **F05 — resolution אחרי התאוששות:** אם אותה הודעה נכנסה לתור בהצלחה או התקבלה אצל הספק, לעדכן התראה קודמת; לא ב־unknown ולא בעסקה שקיבלה סטטוס מטעה.
- [ ] **F06 — התראות עסקיות:** הודעת כשל פעמון רק ב־definite failure, unknown, חסר Outbox אחרי חלון התאוששות, או חריגה משמעותית מזמן המשלוח.
- [ ] **F07 — פעולות ניהול:** Cancel רק לפני send, retry מבוקר, resolve ידני עם תיעוד, archive ללא מחיקת היסטוריה; bulk עם CAS והרשאות.
- [ ] **F08 — כפתור "שלח ידנית":** רק כאשר הודעה נכשלה בבירור, עבור שיבוץ, תזכורת, קישורים, חשבוניות ו־PDF. בהודעת `unknown` — חובה לבדוק ספק קודם.
- [ ] **F09 — מדיניות קבצים ידנית:** כפתור WhatsApp יכול לפתוח טקסט/קישור; אינו מצרף קובץ אוטומטית. לבדוק חשיפה של קישור/תוקף.
- [ ] **F10 — UX:** מקור ההודעה, זמן יעד, זמן ניסיון, ספק, מצב אמת, פעולה אחת רלוונטית. פחות בלונים, יותר פרטים בפאנל.
- [ ] **F11 — PROD:** שיבוץ תקין אינו מפיק שגיאת פעמון; כשל אמיתי מפיק חריג אחד שניתן לפתור; לא להעלים שגיאות אמיתיות.

## G — ביצועים כלליים והפחתת עומס (P1)

- [ ] **G01 — מדידה:** p50/p95 ל־EventDetails, EventsBoard, Dashboard, שיבוץ 1/5/10, רשת סלולרית ואיטית.
- [ ] **G02 — פרופיל API:** לספור והפריד `User.list` / `Supplier.list` / `EventService.list` / ריבוי `filter`, טעינות כפולות, כמות נתונים ו־console errors.
- [ ] **G03 — תחום אחריות fetch:** לא לפעול פעמיים על אותו עדכון סטטוס; למזג/לדחות `refreshEventStatus` ו־`loadEventData` כאשר הוכח שזה בטוח.
- [ ] **G04 — חיווי חכם:** לסגור דיאלוג אחרי שמירת DB עמידה, לטעון סטטוס WhatsApp במקום המתנת spinner ממושכת.
- [ ] **G05 — concurrency:** double click, race בשיבוץ, ספקים שכבר אישרו, שינוי אירוע, דפדפן נסגר.
- [ ] **G06 — עלויות:** מדידת invocation/credits אמיתית, שמירת watchdog כמנגנון התאוששות ולא כתחליף להפעלה רציפה.
- [ ] **G07 — UI:** אפשרויות ניהול מתקפלות, מי שאינו מנהל אינו רואה פעולות ניהול; mobile-first, נגישות, הודעות ברורות.
- [ ] **G08 — שיפור ארכיטקטוני:** עדכון מסכים לפי invalidate ממוקד רק לאחר בדיקת עקביות רב־משתמש.
- [x] **G09 | CODE+TEST 17.10 — זמן עיבוד תזכורות:** `shared/notificationLookup.ts` מחליף סריקות חוזרות לאינדקסים של שירותי האירועים ושל לוגי תזכורת supplier/admin. פלט הפונקציות שקול ל־`filter`/ `some` הקודמים, סדר רשומות נשמר. אין שינוי ב־Push או בהכרזת delivery. תקפות ביצועים אמיתיים תימדד ב־G01/G02.
- [ ] **G10 | P0 — מסך שיבוצים:** D08.7 (Push ו־triggers עסקיים), D08.8 (כותבי Legacy), D08.6b (rollback) והוכחת CAS ב־LIVE נותרו חסמי הפעלה. אין לקצר את spinner בעזרת send לא־ממתין בדפדפן; קודם לשמור Intent שרת עמיד, רק אז לסגור דיאלוג לפני dispatch.
- [x] **G11 | CODE+TEST 17.10 — תיקון רגרסיית אינדקס Scheduled Templates:** בפונקציית `dailyScheduledNotifications`, העברת `servicesByEvent` לפונקציית `sendScheduledToAudiences` דרך `processScheduledTemplate` הייתה חסרה. תוקן והוסף מבחן VM שמפעיל `scheduled_check` עם ספק ושירות ויוצר בקשת WhatsApp ממשית בזיכרון בלי ReferenceError. `tests/scheduled-template-supplier-index.test.mjs` עבר. **אין מדידת שיפור UI בפרודקשן; אין שינוי ביצועי saveSupplierAssignmentsV2.**
- [x] **G12 | CODE+TEST 18.10 — שקיפות תור ללא פגיעה בביצועי רענון:** במקום להסתמך רק על `last_worker_at` של הודעה פעילה (הנראה מיושן כאשר התור ריק), `processWhatsAppOutbox` רושם `last_watchdog_at` גם בריצה ריקה באמצעות `updateMany` לבקרת הרקע הקיימת של 5 דקות. `WhatsAppQueueAdmin.status` מדווח `watchdogLate` אחרי 15 דקות, ומסך הניהול מבדיל "טרם נצפתה ריצת WATCHDOG" מ"איחור מאז ריצה קודמת". אין Cron חדש, אין הודעת WhatsApp שנשלחה לבדיקה, אין API provider; המחיר הוא כתיבת בקרה אחת בכל ריצת watchdog. מדידת אמת תבוצע רק לאחר פרסום מבוקר.

## H — אבטחה, איכות ונתוני אמת (P1)

- [x] **H01 — בדיקות ממוקדות:** כיסוי worker, enqueue, fanout, reminder cutoff, PDF, הסכם, card, crash ו־idempotency נכתב. **TEST**.
- [x] **H02 — רגרסיה מתועדת:** בגל תיקונים קודם 176/177; לאחר D18–D23 נבדקו **183/184** (183 עברו, 1 נכשל), `npm run build` הצליח, backend syntax תקין. הכשל היחיד שנצפה: `tests/event-agreement.test.mjs`, מדיניות `EventAgreement.create` של מנהל סותרת ציפיית RLS בטסט. **אין לשנות RLS ללא החלטה ואימות נפרדים**. **TEST**, לא PROD.
- [ ] **H03 — הכרעת אבטחה:** `EventAgreement.create` — האם רק backend מוגן או יצירה ישירה למנהל? לבדוק workflow לפני שינוי RLS; לא "לתקן" בדיקה בהחלשת אבטחה.
- [ ] **H04 — RLS מקיף:** Outbox, QueueControl, ClientMessageDelivery, Pending, Supplier, User, לוג התראות ופעולות ניהול.
- [ ] **H05 — סקירת secrets:** אין מפתחות Green/Wasender/Invoice4U או URL חתום בפלט ללקוח/לוג/קובץ תכנון.
- [ ] **H06 — אינטגרציה:** 0/429/5xx/timeout, callback כפול, שינוי ספק בזמן תור, לקוח ללא מספר, קבוצה לא תקינה, כניסה כפולה.
- [ ] **H07 — רגרסיה לפני checkpoint:** בדיקות, Build, ESLint ממוקד, סקירת diff וידוא שכל שינוי צפוי; לא לשנות תשלומים, מחיר, חוזים או שיבוצים בלי בקשה.
- [ ] **H08 — נוהל פרסום:** תיעוד מי אישר ומה נשלח בפיילוט, ומה נבדק בפלטפורמה מול מה שנבדק בסביבת כלי בלבד.

## I — פרסום, ניטור ו־rollback מבוקר (P1)

- [x] **I01 — checkpoint בסיס:** `6ad0be8826a151c493e31216` נשמר לפני המשך תכנון/שינויים.
- [ ] **I02 — checkpoint סיום:** לסיים סשן עם מזהה checkpoint ותוצאות QA מדויקות.
- [ ] **I03 — פרסום:** לוודא מה גרסת Live מול Git HEAD; אין להסיק שכתיבה ב־Base44 היא פרסום. לתעד מועד פרסום ורשומת build.
- [ ] **I04 — Pilot:** הודעה יחידה לנמען בדיקה, שיבוץ, תזכורת, הסכם/PDF/חשבונית, קבוצה וטקסט; רק באישור מפורש.
- [ ] **I05 — עומס:** 10–20 הודעות בבת אחת, ספק משתנה, סגירת דפדפן, wake, watchdog ומשך השלחה מדוד.
- [ ] **I06 — 48 שעות ניטור:** מספר missed reminders, כשלי enqueue, unknown, p95 UI ו־p95 תור, חיווי false errors.
- [ ] **I07 — Go/No-Go:** 0 אובדן/כפל בבדיקה מבוקרת, שקיפות סטטוסים, תזכורות בזמן, ביצועי UI סבירים ויכולת חזרה מיידית.
- [ ] **I08 — rollback מדורג:** snapshot נתונים → בדיקת jobs `sending/unknown/queued` → הקפאת worker/בידוד → החזרת רכיבי WhatsApp בלבד לגרסה יציבה ושמירת ספק גיבוי → QA → הפעלה.
- [ ] **I09 — הימנעות משחזור נתונים:** אין Revert גורף של EventService/Payments/Contracts או מסדי נתונים עסקיים כדי לתקן תור הודעות.
- [ ] **I10 — תיעוד החלטות:** אם תידרש נסיגה, לכתוב כאן מי אישר, מה בדיוק הוחזר, מה נשאר, מתי ואיך אומת.

## J — רעיונות ושינויים עתידיים: **Pulse הכללי בלבד**

**Backlog של תור WhatsApp וביצועי השדרוג אינו מתנהל כאן.** הוא נמצא באופן בלעדי ב־`docs/whatsapp-performance-and-reliability-plan-2026-10-15.md`, כולל Webhooks, SLA תור, WAHA, Failover, תור הודעות והוצאות קרדיטים של Worker. תיעוד ישן של רעיונות אלה נשמר ב־Git ובהיסטוריית המסמך הנפרד. אין לפתוח אותן בשני מקומות.

- [ ] **J05 | P1 — יציבות שיבוץ:** גרסת בקשת אישור אטומית ועמידה בתהליכי שינוי עסקיים; התלות בשכבת WhatsApp מתועדת במסמך הטכנולוגי, אך UX השיבוץ נבדק כאן.
- [ ] **J11 | P2 — ממשק מובייל:** קיצורי פעולה לפי הרשאה ומניעת עומס גלילה; כפתורי מנהל אינם מופיעים לספק/לקוח.
- [ ] **J12 | P1 — בקרה על אירועים קרובים:** כל אירוע בתוך 48 שעות עם תזכורת אירוע מתוזמנת או סיבת היעדר מפורשת, בלי replay אוטומטי של WhatsApp לא ידוע.
- [ ] **J13 | P2 — Feature flags בין מודולים:** בידוד שינויי תזמון/שיבוץ כדי שניתן יהיה לחזור מרכיב עסקי אחד, תוך קישור לדגלי Worker הטכנולוגיים במסמך WhatsApp.
- [ ] **J14 | P1 — מדידת זמן שמירה:** השוואת שמירת שיבוץ 1/5/10 ספקים, כולל refetch/React render, בנפרד לגמרי מזמני dispatch של WhatsApp.
- [ ] **J15 | P2 — עקיבות פעולות עסקיות:** חיווי "השיבוץ נשמר" אינו חיווי "ההודעה נמסרה"; היסטוריה אירועית וקישור רק לסטטוס התור הטכנולוגי.

---

## K — מדיניות עסקית ממתינה לאישור

1. שולי ביטחון: כמה זמן **לפני האירוע** לא שולחים תזכורת אישור שיבוץ? כיום מוגבל ל"לפני תחילת האירוע/התייצבות" בלבד; רעיון: שעתיים, אך לא להחיל בלי אישור.
2. מדיניות direct manager create ל־EventAgreement מול פונקציית שרת בלבד (RLS).
3. פרסום ופיילוט: רק משתמש מוסמך בוחר מספר בדיקה, מפרסם ומאשר בדיקות אמת כאשר יש סיכון הודעות לצדדים שלישיים.
4. מחיקת התראות ישנות: לא למחוק רשומות כשל או לסמן להן resolved באופן סיטוני; לתעד תיקון לפני החלטת ניקוי.

**מדיניות תור WhatsApp טכנולוגית:** SLA ל־dispatch ו־failover Green/Wasender מנוהלים **אך ורק** בפרק ההחלטות של `docs/whatsapp-performance-and-reliability-plan-2026-10-15.md`.

---

## L — יומן סשנים, החלטות, בדיקות והמשך

### 14.10.2026 — סקר בסיס
- בוצע: השוואה לגרסה לפני ריבוי מנגנוני WhatsApp; נמצאו עומס שיבוצים, ריבוי יצרני הודעות, תור שנעצר בין אצוות, תזכורות חופפות, רעש פעמון וחוסר הבחנה בין queued/accepted/delivered.
- תוצאה: תוכנית P0/P1 ותסריט rollback ממוקד. **הסקר עצמו לא שינה קוד.**

### 15.10.2026 — גל תיקוני P0 ראשון
- בסיס התיקונים: checkpoint `6ad07165fa0715203e5da55e` לפי הסשן הקודם. נבחנו הסכמים/לקוחות, שיבוצים, עובדים ותזכורות.
- בוצע בקוד: root-client להסכמים ולכרטיס, מניעת false failed לאחר enqueue, dedupe התראות לקוח, wake אחרי שחרור lease, fanout מתוזמן עם owner יחיד, תזכורת אישור לא אחרי האירוע, אופטימיזציית קריאות שיבוץ, צמצום Push כפול, הבחנת queued/accepted.
- נוספו בדיקות: `agreement-whatsapp-context.test.mjs`, `whatsapp-scheduled-owner.test.mjs`, `assignment-reminder-timing.test.mjs` והורחבו בדיקות worker.
- QA רגרסיה נכון לסריקה: **176/177 עברו, Build עבר**; כשל RLS `EventAgreement.create` אינו מטופל בשלב הזה ללא מדיניות.
- פרודקשן: **לא הופעלו ניסויי שליחה** במקטע זה; לא נשלחו שוב ההודעות הבעייתיות.
- תיקון התיעוד בסשן המשך: התוכנית הישנה של 106 שורות הוחלפה במסמך מרכזי עם משימות ממוספרות, סטטוסים וקריטריונים.
- **המשימה הבאה לאחר עדכון המסמך:** D07–D10 — מיפוי מדויק של טריגרים והחלפת יוצרי שיבוץ כפולים בבעלים עמיד אחד, בלי לאבד מהירות שמירה; במקביל בדיקת C08–C09 כאשר יש פרסום ונמען בדיקה מאושר.
- **נקודת עצירה:** אחרי בדיקת התוכנית, הרצת QA מחדש, עדכון יומן סשן, checkpoint נפרד. אין לקפוץ לשינוי גורף של מודל השיבוץ באותו גל ללא חוזה נתונים ובדיקות תחרות.

### 15.10.2026 — אימות חד־משמעי בין שתי אפליקציות Pulse + תיקון D18
- **זהות פרויקט:** נשלפה רשימת האפליקציות; Pulse שירת הנבל ID `687d1de6659eff83e9c034f7` מחובר ל־`natan-bakshi/pulse_system_shirathanevel`. Pulse הרב־חברתי ID `6a33dd29fd912621a5d8443a` מחובר ל־`natan-bakshi/pulse`. **לא נכתב דבר לרב־חברתי.** הוסף guard למסמך זה ונוהל בדיקה בתחילת כל סשן.
- **Checkpoint לפני שינוי:** `6ad0bf85c616ac178b9bc786` (בסיס commit `17c7f0b`). לאחר ההרחבה הראשונה המסמך נוכח בקוד בעדכון `c2b9b14`. קיים קובץ תכנון מרכזי **בן למעלה מ־240 שורות** עם משימות אטומיות; נמשיך לערוך אותו ולא ליצור תוכניות מתחרות.
- **ממצא D18:** בחזרה של `enqueueWhatsApp` עם מפתח שכבר קיים וסטטוס `failed/unknown`, בדיקת השיבוץ ספרה זאת כדילוג תקין. תוקן fail-closed; אין resend אוטומטי, ומה שנשלח כבר לא נשלח שוב.
- **מפת D07:** שני workflows של EventService; שני מסלולי יצרן WhatsApp; worker CREATE/UPDATE+watchdog. טרם פישטנו את הארכיטקטורה; D08–D11 עדיין פתוחים, ולא מסירים await בלי תחליף עמיד.
- **QA:** 35/35 בדיקות ממוקדות; 181/182 רגרסיות מלאות, אחת קיימת בתחום RLS; `npm run build` הצליח; פענוח backend עבר. **לא בוצעה שליחת WhatsApp אמיתית**.
- **נתוני מערכת:** מדגם אחרון 21 `accepted`, שתי `unknown`, תור enabled ו־unpaused. לא בוצעו שינויים ב־Outbox, בלקוחות, בשיבוצים או בתשלומים.
- **נקודת עצירה הבאה:** לשמור checkpoint אחרי תיעוד התיקון; לפתח D08–D10 (יוצר שיבוץ עמיד יחיד, תוך שמירת מהירות) רק אחרי פירוט מדויק של חוזה הנתונים ובדיקות תחרות. בנפרד להוכיח C08–C09 לאחר פרסום ופיילוט מאושר. אי־ודאות במשלוח או רגרסיה ביצועים מחייבות עצירה.
- **פרסום:** לא בוצע בסשן זה; בדיקת קוד ו־Build אינן הוכחת יציבות בפרודקשן.

### 15.10.2026 — מסמך מרכזי מעודכן, תיקוני D20–D23 ותכנון D08
- **בסיס:** פרויקט Pulse שירת הנבל המקורי; `base44/config.jsonc` תקין; Git HEAD בסיס הסשן `17c7f0b`; נקודת שחזור לפני כתיבת מסמך `6ad0be8826a151c493e31216`.
- **מסמך:** הורחב `docs/pulse-stability-recovery-plan-2026-10-14.md` לכדי מקור אמת מפורט עם משימות אטומיות, סטטוס CODE/TEST/PROD נבדל, backlog, החלטות, מדדי הצלחה, יומן ונוהל חובה בכל שיחה. נוסף קישור בראש `README.md` כדי שכל מי שעובד בקוד ימצא את התוכנית.
- **מיפוי D07:** `EventService` CREATE ו־UPDATE מפעילים `handleEntityEvents`; ארבעה מסכי שיבוץ שומרים את הישות וקוראים `ensureAssignmentWhatsApp` דרך `verifyAndRefreshAssignment`; במסך EventDetails יש גם Push לחדשים. `WhatsAppOutbox` CREATE מעורר Worker, `WhatsAppQueueControl` UPDATE מעורר המשך אצווה ו־watchdog מתוזמן לגיבוי. שני יצרני הודעת שיבוץ עדיין קיימים — אין לסמן D08–D11 הושלמו.
- **תיקון D20:** הודעה שבה אין שעת התייצבות או שעת אירוע כבר לא מציגה `בשעה .`. לא הומצאה שעה במקום נתון חסר. בדיקה בשני מסלולי הטקסט.
- **תיקון D21:** בזמן quiet-hours/שבת הודעת שיבוץ מהטריגר הישן כבר לא נוצרת ב־Pending נוסף; גם טריגר וגם safeguard משתמשים ב־`assignmentWhatsAppContext` וב־Outbox עם אותו business key ו־`availableAt`. תבניות אחרות עדיין במסלולים הקיימים.
- **תיקון D23:** `handleEntityEvents` משתמש ב־Base44 SDK `0.8.38` כמו מסלול השרת הנבדק, במקום `0.8.6` הישן.
- **בדיקות ממוקדות:** 15/15 ליצרן השיבוץ ולמצב quiet-hours, כולל בדיקת trigger backend באמצעות VM (ללא provider אמיתי) ואפס Pending נוסף. בדיקות TypeScript parser עברו.
- **בדיקות רוחב:** **183/184 עברו**; `npm run build` עבר; ESLint ממוקד לקבצי הבדיקות עבר. הכשל היחיד נותר `EventAgreement.create` מול RLS — טעון הכרעת אבטחה עצמאית, לא תוקן במחיר החלשת הרשאות.
- **נתוני אמת:** נמצאו 0 רשומות Pending פתוחות מסוג `SUPPLIER_NEW_ASSIGNMENT` במדגם החיים; לא בוטלו או נמחקו רשומות. הודעות שיבוץ היסטוריות שנמצאו ב־Outbox כבר `accepted` אצל ספק API — **לא נשלחו מחדש**. אין להשליך מכך על delivered.
- **לא בוצע:** פרסום לגרסת Live, שליחה אמיתית, מבחן טעינה מספקים, אימות קבוצות, בדיקת wake end-to-end, פתרון RLS, או מעבר יצרן יחיד עמיד. הסעיפים הפתוחים נשארים `[ ]`.
- **סיכון פתוח:** המפתח הקיים ב־`assignmentWhatsAppKey` עדיין תלוי ב־`EventService.updated_date`; שינוי שאינו בקשת שיבוץ עלול לייצר מפתח חדש. אסור להסיר אחד משני היצרנים בלי מנגנון intent עמיד וגרסת transition.
- **המשימה הבאה:** D08.1–D08.6 — לתכנן ולממש בקשת שיבוץ עמידה אחת בצד שרת תוך מניעת כפל ומדידת השפעתה על UI; לאחר מכן D09–D10, ולבסוף PROD C08/C09/D24 באישור נמען בדיקה.
- **נקודת שחזור לאחר המימוש וה־QA:** Base44 checkpoint `6ad0c4097ca7e55fa7ef3aa7`, commit `ec38a136a1de24fde03ff4b2bc0a915e44d0c6b1`. מסמך, בדיקות וסקירת diff נכללו בנקודה זו. אין שינוי נתונים עסקיים או ניסיון לשליחה בזמן הסשן. כל תוספת לאחר נקודה זו תחייב checkpoint נוסף.

### 15.10.2026, 17:45 — הפרדת תחומי ביצועים ושמירת עקיבות
- **החלטת המשתמש:** ביצועי *שדרוג WhatsApp* אינם נכללים יותר במעקב ביצועי המערכת הכללית, גם כאשר קיימת תלות. נוצר **מסמך תכנון עצמאי, פעיל ומפורט**: `docs/whatsapp-performance-and-reliability-plan-2026-10-15.md`.
- **מבנה תיעוד:** סעיף C של תוכנית Pulse הכללית הוחלף בקישור בלבד; תוכן C המקורי נשמר כהיסטוריה במסמך WhatsApp. סעיף J (Backlog) שויך לתחומי Pulse הכלליים; רעיונות טכנולוגיים של WhatsApp והחלטות SLA/failover מנוהלים רק במסמך החדש. `README.md` מקשר לשני הקבצים באופן שווה.
- **אין שינוי במנגנון השיבוץ הכללי בסשן הזה.** D08–D11 (מקור בקשת שיבוץ עמידה יחידה; UX שמירה מהיר) נשארים פתוחים בתוכנית זו; הם לא סומנו בטעות כבוצעו בעקבות אופטימיזציית התור.
- **בדיקות רגרסיה של כלל Pulse:** 188/189 עברו; Build הצליח. הבדיקה היחידה שנכשלה היא RLS ישן `EventAgreement.create` שמצריך בדיקה/החלטת מדיניות. לא שונו הרשאות.
- **נתוני WhatsApp ומדדי ביצועי התור:** נשמרו **אך ורק** במסמך WhatsApp, לא נכנסים ליומן זה כדי למנוע דוחות מקבילים.
- **פרסום/ניסיון אמת:** לא בוצעו במסגרת הסשן הזה; לא נשלחו מחדש הודעות, לא עודכנו שיבוצים או תשלומים.
- **Checkpoint של הפרדת התוכניות ומדדי WhatsApp:** `6ad0ecd534451b2c13104dc7`. הוא אינו מאשר פרסום Live או מסירה לנמען.
- **משימה כללית הבאה:** D08.1–D08.6 לבקשת שיבוץ עמידה יחידה, אחריה D11–D13 לשיפור חוויית השמירה, בלי לבצע מיגרציה חיה לפני בדיקת עקביות.

### 15.10.2026, 21:56 — הימנעות מתזכורות כפולות וחוסם הודעות, ואיחוד שליפות
- **בסיס:** נקודת חיתוך טכנולוגי WhatsApp אחרי WA-P02b/WA-P03 ו־WA-P30: checkpoint `6ad127c45869cfeb43b53589`. שינויי הסשן הכלליים בוצעו רק לאחריו, כך שניתן לחזור לקוד התזכורות בנפרד מן התור.
- **משימות שהושלמו בקוד/בדיקות:** E17 (איחוד ספקים שהופיעו גם כ־added וגם כשינוי ל־pending), E18 (כשל מתוזמן אינו חוסם הודעת שיבוץ מיידית או אחרים), D26 (שימוש חוזר בפרטי Event/Service/Supplier/User בתוך בקשה), D08.1 (מטריצת שיבוץ/סטטוסים/שעות שקט/תחרות). המטריצה היא **אפיון בלבד**, לא מעבר ליצרן עמיד אחד.
- **ראיות:** `tests/assignment-pending-reminder-isolation.test.mjs`, `tests/assignment-reminder-timing.test.mjs`, ארבע חבילות בדיקות שיבוץ; **22/22 ממוקדות**, **199/200 בדיקות מערכת**, כשל RLS יחיד ישן ב־EventAgreement. Build, parse ו־Lint עברו. לא שונו הרשאות או שדות EventService עסקיים.
- **לא בוצע:** אימות LIVE/פרסום, ריצה מול WhatsApp, שינוי ספק, שליחה חוזרת של הודעות ישנות, D08.2–D08.6 ודחיפת UI מוקדמת ללא Intent מתמשך.
- **סיכון פתוח:** הסתמכות על `updated_date` במפתח WhatsApp; טריגר ובדיקת מסך עדיין שני יצרנים. יצרן יחיד חייב מנגנון revision ו־reconciler חסין־כפילויות **לפני** שחרור שמירה מהירה בלתי־חוסמת.
- **השלב הבא:** D08.2–D08.6 — בדיקת יכולות CAS ב־EventService, מודל durable intent ותרחישי concurrent saves; אחריהם D09.1–D10.2 בפרסום מבוקר. D25 (קבוצת WhatsApp שגויה) מחכה להחלטת מדיניות. נדרש checkpoint סיום.

### 17.10.2026, 22:18 — תשתית Durable Assignment Intent V2 (כבויה עד פיילוט)
- **App ID ו־Checkpoint פתיחה:** Pulse המקורי `687d1de6659eff83e9c034f7`, Git HEAD בתחילת העבודה `c621969a409fff1be105cdd6e1bebe7703742786`, checkpoint `6ad3ca38225302ab7056df21`.
- **מצב נתוני אמת לפני העבודה:** 24 רשומות Outbox במדגם, 21 `accepted` (אישור ספק API בלבד), 2 `unknown` (ללא replay) ו־1 `cancelled`; תור enabled ולא paused. `AppSettings` לא כלל `assignment_intent_v1_enabled`, ואין `EventService.assignment_intents_pending=true` בנתוני LIVE שנבדקו — המנגנון החדש **כבוי**.
- **משימות שבוצעו בקוד/בדיקות:** D08.2a/b, D08.3a, D08.4a, D08.5a, D08.6a. תכנון מדיניות ומסלולי חסימה D08.2c, D08.3b, D08.4b, D08.5b, D08.6b, D08.7, D08.8 נרשמו כ־[ ] ולא יופעלו לפני QA.
- **קבצים חדשים:** `base44/shared/assignmentIntent.ts`, `base44/shared/assignmentIntentReconciler.ts`, `base44/functions/saveSupplierAssignmentsV2/entry.ts`, `base44/functions/reconcileSupplierAssignmentIntents/entry.ts`, `base44/workflows/Assignment Intent Reconcile On Change.jsonc`, `tests/assignment-durable-intent.test.mjs`, `tests/assignment-intent-reconciliation.test.mjs`.
- **קבצים שהורחבו:** `base44/entities/EventService.jsonc` (שדות optional), `base44/shared/assignmentWhatsApp.ts` (key יציב רק ל־`durable_v1`), `base44/functions/processWhatsAppOutbox/entry.ts` (גיבוי Intent ב־Watchdog הישן בלבד), `tests/whatsapp-background-worker.test.mjs`, `tests/assignment-trigger-quiet-outbox.test.mjs`.
- **מנגנון מדויק:** backend מאמת admin ו־Feature Flag, קורא EventService ומבצע CAS מול `updated_date` לשמירת השיבוץ וה־Intent **באותה כתיבה**; אחרי שמירת הצלחה מבצע `EventService.update` על `assignment_intent_wake_at` להערת Workflow מפורשת. failure של wake אינו מוחק Intent. Reconciler בודק Outbox קודם, מגן על unknown, קבוצות לא תקינות ושיבוץ שכבר לא pending, ומסיים לכל היותר 8 בקשות בריצה עם wake המשך. במקרה נפילה, Watchdog התור הקיים בודק עד 4 EventServices ועד 4 Intents בכל שירות, **רק כשהמתג מופעל**. כשמתג כבוי אין סריקת EventService או יצירת Outbox.
- **QA מעודכן:** לפני עדכון יומן זה עברו **226/227 בדיקות מערכת**, וה־Build, Backend TS parse ו־JSON schema parse הצליחו. הכשל היחיד מוכר וישן: `EventAgreement.create` RLS תואם admin לפי schema מול test הדורש `false` — **לא שונו הרשאות ולא הוסתר הכשל**. בנוסף **27/27 בדיקות ממוקדות** למנגנון Intent ולמפתח המשותף עברו לאחר תיקון ההתעוררות.
- **סיכוני הפעלה קריטיים:** (1) יש לאמת CAS בפועל ב־Base44 ולא להסתפק במוק; (2) `EventService.updateMany` יכול שלא להפעיל טריגר עסקי Legacy עבור Push ותזכורות אישור — D08.7 הוא **חסם הפעלה**; (3) כותבי Legacy עדיין קיימים ומפתח V2 יכול להישאר בשירות אחרי rollback; D08.6b ו־D08.8 פתוחים; (4) אין ראיית משלוח פרודקשן. אין להפעיל flag או להעביר UI כרגע.
- **לא נעשה:** לא פורסמה גרסת Live חדשה בסשן הזה, לא נוצרו שיבוצים/Outbox חדשים בנתוני אמת, לא נשלחו הודעות לנמענים ולא שוחזרו ההודעות הלא־ודאיות; הגדרת ספק WhatsApp נשמרה כפי שהייתה.
- **Checkpoint סיום קוד ותיעוד:** `6ad3cfe5d5ea539fff20d0b1`, commit `d2e50b9efdb1a73aa9f81f8ef90184555036dc27`. נקודה זו מכילה את השינויים שנבדקו; עדכון מספר checkpoint במסמך עצמו יוצר commit תיעוד עוקב.
- **משימה הבאה ונקודת עצירה:** קודם D08.7 — לשמור את Push, אישור ספק ותזכורות עסקיות במעבר לכתיבת CAS; אחריה D08.8 (לסגור כותבי Legacy), D08.6b (rollback) ורק אז D09–D10 ומבחן פרודקשן בנמען בדיקה מאושר. בשלב הבא למדוד חיסכון latency בפועל ורק אם תקין לשקול rollout.

### 17.10.2026 — השלמת תיקוני מהירות לתזכורות, תשלום וקישור למעקב WhatsApp
- **חלוקת תחומים נשמרה:** כל תיקון ב־Worker/Green/Wasender/Outbox, latency וספקים מנוהל **רק** ב־`docs/whatsapp-performance-and-reliability-plan-2026-10-15.md`, משימות WA-P32–WA-P43. כאן מנוהלים רק כלל עסקי של תזכורת, מקור הודעה, UI של Pulse ואמינות ה־business state.
- **משימות כלליות שנגמרו בקוד ובדיקות:** E07a (מפתח הודעת WhatsApp משותף לשני מנגנוני תזכורת; E07b עדיין פתוח ל־Push/InApp), E19 (אינדקס EventService/תזכורות בלוג), G09 (שיפור חישוב O(E×S) לשליפה מקומית באינדקס O(E+S), בלי שינוי סדר/נמענים), B15 (קבלה ותזכורת קישור תשלום עם idempotency, אימות receipt לפני סימון הצלחה או email fallback).
- **באגים רוחביים שנמצאו ודורשים המשך:** E20 — תזכורת משימות מסמנת `Task.whatsapp_notification_sent` לפני ש־WhatsApp נקלט בתור; E21 — InAppNotification יכול להיווצר לפני enqueue ובכך לחסום תיקון עתידי; E07b/E08 — עדיין קיים יותר מיצרן עסקי אחד ל־Push/InApp או גרסת אירוע משתנה; B16 — מקור Payment יכול להיחשב שטופל כשהתור קיבל אבל הספק נכשל מאוחר יותר. **אין להחיל כעת שינוי סמנטיקת תזכורת או מחיקת היסטוריה בלי ולידציה.**
- **מהירות שמירת שיבוצים:** D08.7 (שימור Push/תזכורות במעבר ל־CAS), D08.8 (כל כותבי Legacy), D08.6b (rollback) ו־D09.1/2/3 עדיין פתוחים. V2 נשאר כבוי; אין להעלים spinner תוך הפעלת תהליך לא עמיד בדפדפן. שיפור מהירות המסכים עצמם דורש מדידת G01/G02 ו־Go/No-Go.
- **QA:** 252/253 בדיקות המערכת עברו, כשל יחיד ישן ב־`EventAgreement.create` מול ציפיית RLS של הבדיקה; Build/TS parse/JSON schema/ESLint עברו. בדיקות אינדקס שקול לסריקה מלאה ב־4,200 שירותים וב־215 אירועים עברו; **אין עדיין נתון p95 ברשת משתמשי פרודקשן**.
- **DATA/PROD:** לא נשלח מסר אמת, לא שונו הודעות שיבוץ, תשלום או תאריך אירוע, לא שונה ספק פעיל ולא בוצע replay של `unknown`. מצב פרסום Live לא אומת. אין לטעון שהפיתוח הסגור מוכיח end-to-end פרודקשן.
- **משימה כללית הבאה:** E20/E21 ובמקביל D08.7–D08.8 כחסמי שיבוץ מהיר, B16 לרישום קישור תשלום ו־G01/G02 למדידות מהירות מסכי Mobile. לתאם QA נמען בדיקה ו־rollout *רק* אחרי אימות ספק אמיתי.
- **Checkpoint בסיס סשן:** `6ad3d1c83397822398d50155`. **Checkpoint סיום QA:** `6ad3d9666fbef9071c8086ee`, commit `36ecf88765269d8bd6ddefd56d9d19243b5fcb97`. הוספת מזהה הצ'קפוינט למסמכים יוצרת commit תיעוד נוסף; יש להמשיך לקרוא בתחילת כל סשן את שתי התוכניות אך לעדכן כל תחום רק בקובצו.

### 17.10.2026, סשן המשך — יציבות משימות ו־UI ותזמונים
- **App/Checkpoint בסיס:** Pulse `687d1de6659eff83e9c034f7`, `6ad3dbece6680c5a1a12e4ea`. מצב `assignment_intent_v1_enabled` לא הופעל; Outbox 24 במדגם (21 accepted אצל ספק API, 2 unknown, 1 cancelled); ספק/מרווחי קצב לא שונו.
- **E20a/b:** תזכורת Task לא מסמנת דגל לפני enqueue; משימות מרובות נמענים דורשות אישור כל נמען. מניעת כפילויות מול המתזמן המונחה־אירועים על ידי קריאת `PendingPushNotification` לפי משימות due ו־`WhatsAppOutbox` לפי המפתח של אותה משימה/מנהל/גרסת תאריך. משימה שהתזכורת שלה עדיין ממתינה או `unknown` אינה נשלחת שוב ממנגנון יומי. בדיקות VM: נמען ראשון הצליח/שני נכשל, retry חוזר, due version השתנה, Push-only, Pending מוחזק ומתאשר, `unknown` אינו replay.
- **E20c נשאר פתוח:** חובה לייצג Push ו־WhatsApp בנפרד עם Intent לכל נמען. דגל Task גלובלי עדיין לא מהווה הוכחה שכל ה־Push נמסר; Push/InApp שנוצר לפני כשל WA עלול להיווצר שוב. ריצת Scheduler מנקה Pending sent אחרי 7 ימים; לדרוש reconciliation/historical audit ולא לשגר מחדש תזכורת ישנה בהעדר ראיה.
- **E21a:** נוסף Admin `sourceAudit` קריאה בלבד ללא פעולה בשום מסר, מכיל mismatch אפשרי `Outbox ↔ InApp` בהפרדה בין `accepted`, `unknown` ורשומות Legacy לא מקושרות. **E21b עדיין פתוח** לתיקון Origin חסר מול Outbox ולחזרת מקור במקרים בטוחים בלבד.
- **G11 רגרסיית מתזמן תוקנה:** בעקבות אופטימיזציית אינדקסי EventService מ־15.10 לא הועבר `servicesByEvent` לפונקציה הפנימית של scheduled_check. תוקנה חתימת `processScheduledTemplate` ו־`sendScheduledToAudiences`. מבחן VM ייעודי מפעיל Template עם ספק/שירות ומוודא שאין `ReferenceError`.
- **WA-P40a:** תזכורות ספק/מנהל, לקוח בתשלום, Task digest, scheduled_check כולל יצרן Legacy ו־Pending שעות שקט יוצרות Outbox עם מפתח יציב ומובחן; ההקשר הטכנולוגי וניתוח הביצועים מתועדים **רק במסמך WhatsApp**.
- **QA:** **277/278** בדיקות מערכת עברו; כשל יחיד קיים `EventAgreement.create` RLS, Build/Parse/Lint הצליחו. **לא בוצעו שליחות אמת, שיבוצים, תשלומים או שינוי נתוני לקוח**. ההפעלה והמהירות בפרודקשן לא נמדדו.
- **חסם UI השיבוצים:** D08.7 (רציפות תוצאות לוואי Push/טריגרים), D08.8 (כל כותבי Legacy), D08.6b (rollback) והוכחת CAS לא הסתיימו. לפיכך V2 נשאר כבוי, ואין לקצר זמני spinner על ידי שליחה לא־עמידה בדפדפן. **השלב הבא:** D08.7 בצירוף תכנון source-of-truth ל־Push/WhatsApp, D08.8/E21b, ורק אז D09 ו־Go/No-Go.
- **Checkpoint סיום:** `6ad3e1774633d4a171a089aa`, commit `4904a5a828159212ed6106d895045b757904a703` (לפני הוספת מספר הצ'קפוינט למסמך), ללא שינוי מצב הספק/הדאטה.

### תבנית חובה ליומן סשן הבא

- תאריך/שעה:
- Commit HEAD לפני העבודה + checkpoint:
- מצב חי לפני השינוי (read-only):
- משימות ID:
- קבצים שנקראו:
- שינויים שבוצעו:
- מה נבדק: unit / integration / build / lint / PROD + מספרים:
- מה לא אומת ולמה:
- השפעה על פרודקשן/Workflows:
- ממצאים ובעיות חדשות + מזהי Backlog:
- checkpoint סוף + commit:
- המשימה הראשונה בסשן הבא ונקודת עצירה:

**אין לסיים עבודה בלי לעדכן יומן זה ואת סטטוס המשימות הרלוונטיות.**
