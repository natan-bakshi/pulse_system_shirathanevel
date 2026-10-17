# Pulse — תוכנית עצמאית: ביצועי שדרוג WhatsApp, תור שליחה ואמינות ספקים
**קובץ קבוע:** `docs/whatsapp-performance-and-reliability-plan-2026-10-15.md`  
**עודכן:** 17.10.2026 | **סטטוס:** תוכנית ביצוע עצמאית פעילה | **P0**  
**מערכת:** Pulse — שירת הנבל (Base44 `687d1de6659eff83e9c034f7`; GitHub `natan-bakshi/pulse_system_shirathanevel`).

> **תחימה חד־משמעית:** המסמך הזה אחראי **רק לשדרוג WhatsApp ולביצועיו**: קליטת הודעה לתור, worker, זמני תגובה, קצב לפי ספק, Green API / WasenderAPI, קבוצות, מסמכים, שגיאות ספק, ניטור קצה ומניעת כפילות. **ביצועי UI הכלליים, מסכי השיבוץ, סטטוס האירוע, תשלומים ותכנון עסקי של תזכורות** מנוהלים **בנפרד** ב־`docs/pulse-stability-recovery-plan-2026-10-14.md`. אם משימה נוגעת בשני התחומים, פותחים שתי משימות משויכות עם תלות מפורשת, לא מבצעים שינוי כפול.

## 1. נוהל חובה והגדרות מצב
1. בתחילת סשן WhatsApp לקרוא **את כל הקובץ הזה** ואת יומן הסשן האחרון; לקרוא את מסמך Pulse הכללי **רק עבור תלות חוצת־גבולות**. לא לערבב Backlog של WhatsApp עם Backlog UX/כספים.
2. לאמת App ID ו־git remote ולהצליב מצב התור (read-only), לפני כל עריכה או פנייה לספק.
3. לפני שינוי רחב ליצור checkpoint. אחרי כל מקטע: בדיקות ממוקדות, בדיקות תחרות, Backend parse, Build וסקירת diff; לסמן בוצע ב־`[x]` **רק כשיש ראיה**, ולציין אם CODE / TEST / PROD בנפרד.
4. **אין לשלוח** הודעות אמת או לשחזר הודעות ישנות אוטומטית; שתי הודעות `unknown` מ־14–15.10 מחייבות בדיקת היסטוריית Green API לפני retry.
5. אין לטעון שמסר "נמסר" כאשר ידוע רק `accepted`. הסטטוסים הנכונים: `queued`, `retry_wait`, `sending`, `accepted` (התקבל אצל הספק), `failed`, `unknown` (בדיקה), `cancelled`, `expired`, `resolved`, ומסירה רק לאחר אישור מוכח.
6. כל תוספת מתוכננת עתידית מוכנסת לסעיף 7, לא לתוכנית הכללית. בסוף לעדכן Checkpoint/Commit/QA/מה נשאר.

## 2. נתוני בסיס מאומתים וסיכוני ביצועים
- מדגם חי 15.10: **23 רשומות Outbox, 21 accepted ו־2 unknown**, ללא pending באותה שאילתה. שתי `unknown` הן `scheduled_notification` דרך Green API; ללא ניסיון חוזר אוטומטי.
- הגדרות חיות: queue `enabled=true`, `paused=false`, `green_interval_ms=3000`, `wasender_interval_ms=7000`, `max_messages_per_run=16`, אין lease תפוס במדגם.
- במדגם המקורי של 17 הודעות: חציון כ־240 שניות מיצירה ל־accepted, וגלים בפער כ־5 דקות — חריגה ממרווח ספק של 3 שניות.
- **מדידת בסיס חדשה 15.10 (DATA; 23 Outbox, כולן Green API):** זמן “מועד זמין→תחילת ניסיון”: **p50=35.581 שניות, p95=1,622.340 שניות (כ־27 דקות)**. זמן “תחילת ניסיון→רישום תוצאה”: **p50=1.103 שניות, p95=15.167 שניות**. חציון זמן כולל מזמינות לתוצאה: 36.623 שניות. המדידה **מראה עיכוב בעיקר לפני ניסיון השליחה**, אך אינה מוכיחה איזה workflow גרם לכך או מה קורה לאחר פרסום התיקון. אין במדגם רשומות WasenderAPI להשוואה.
- **לא הוכח עדיין** שיעור ההצלחה וקצב התור לאחר תיקון ההפעלה או מסירה בפועל.
- שליחת הסכמים/קישורי כרטיס קיבלה תיקון `asServiceRole` לקליטת Outbox, אבל פרודקשן של כל סוג טרם אומת. המסמך הזה בוחן **רק** תחום הכניסה לתור ושליחתו, לא נוסח הסכמים ומדיניות גבייה.
- אסור להעריך latency כ־`accepted - created` בלבד בלי לפרק `created→available→claim→HTTP start→response`: הודעה שנדחתה מפאת שעות שקט אינה איטית.
- בעלות על Worker = `base44/shared/whatsappQueueWorker.ts`; עטיפה `processWhatsAppOutbox`; תזמון `WhatsApp Outbox Wake On Create`, `WhatsApp Outbox Continue Batch`, `WhatsApp Outbox Watchdog 5min`; שליטה `WhatsAppQueueControl`.

## 3. תוכנית ביצוע אטומית לשדרוג WhatsApp (רק המסלול הטכנולוגי)

### WP0 — מדידת אמת והגנה מנסיגה
- [x] **WA-P00** נקודת שחזור לתחילת ההפרדה: `6ad0e7210802938b27437a28`, commit `6e5f43d9bd014a26802286071dbd2d741e25cac3`.
- [x] **WA-P01** מקור אמת טכנולוגי נפרד ל־WhatsApp נוצר במסמך זה, שומר היסטוריית C הקודמת בפרק 9 ומצוין ממסמך Pulse הכללי.
- [x] **WA-P02a | CODE+TEST 15.10** נבנה מודול read-only `base44/shared/whatsappQueueMetrics.ts` לחישוב זמני המתנה **מרגע זמינות ההודעה** (לא כולל שעות שקט), זמן מניסיון עד רישום תוצאה, וזמן כולל. p50/p95 מחושבים רק מחותמות זמן אמיתיות; חסרים נספרים ולא מומצאים. נוסף endpoint מוגן `WhatsAppQueueAdmin(action=metrics)` וטבלת מדדים בהגדרות; הבדיקה מופעלת בלחיצת מנהל בלבד ומחזירה לכל היותר 200 רשומות, ללא תוכן או מספרים. בדיקות קצה/הרשאות ב־`tests/whatsapp-queue-metrics.test.mjs` עברו.
- [x] **WA-P02b.1 | CODE+TEST 15.10** נבנתה טלמטריה מפורקת לכל ניסיון: `job_claimed_at`, `rate_ready_at`, `prior_dispatch_at`, `configured_interval_ms`, `transport_started_at`, `transport_finished_at`, `worker_run_id`, `worker_wake_reason`. פירוק: המתנה להודעות קודמות, ויסות קצב, איחור Worker אחרי מועד זכאות, תקורה מ־claim עד התחלת פונקציית transport, משך transport ושמירת תוצאה במסד. שדות חדשים מתווספים לאותם עדכוני DB קיימים **ללא עדכוני DB נוספים לכל הודעה**. נבדקו UTC, שעות שקט, דיוק בחותמות זמן ומידע ישן שאינו מכיל שדות חדשים.
- [ ] **WA-P02b.2 | CODE** להפריד זמן HTTP עצמו מזמן הכנת קובץ/יצירת URL חתום בתוך `sendWhatsAppTransport`. כיום `transport_started_at→transport_finished_at` כולל גם הכנת קבצים, ולכן אינו זמן HTTP טהור. למדוד רק לאחר בדיקת שתי אינטגרציות ובחירת צורת hook שאינה משפיעה על שליחות.
- [ ] **WA-P02b.3 | PROD** למדוד קריאה חיה של CREATE→worker, UPDATE→worker, watchdog→worker לאחר פרסום; הקוד מתעד מקור אבל **אין עדיין הוכחת זמני trigger בפרודקשן**.
- [ ] **WA-P02c | PROD** לאמת את כפתור המדדים בפרודקשן אחרי פרסום ואת המגבלות של המדגם; לבדוק השוואה בשני ספקים, כשקיימות מספיק הודעות מכל אחד.
- [x] **WA-P03.1 | CODE+TEST** נוסף `worker_run_id`, סיבת wake מתוך שלוש אוטומציות CREATE/UPDATE/Watchdog או פעולה ידנית, וכן `last_worker_finished_at`, `last_batch_count`, `last_batch_elapsed_ms` ל־QueueControl. ה־API דורש role=admin, ורק ערכי reason ברשימה מותרת נרשמים; לא נשמרים טלפונים או תוכן בהיסטוריית המדדים. הנתונים נכתבים בפעולות CAS קיימות, לא בהפעלת idle cron.
- [ ] **WA-P03.2 | CODE** סיווג `errorPhase` מפורט גם כאשר wrapper backend נפסק לפני claim, ו־run history להבדיל בין התעוררות שלא נקלטה לבין Worker ללא הודעות. אין להוסיף כתיבות רק בגלל idle watchdog.
- [ ] **WA-P04** למדוד בנפרד p50/p95/p99 של wake כשהתור פנוי, לאורך 10/20/100 הודעות, Green API מול WasenderAPI.

### WP1 — רציפות עובדי התור ללא דיליי שרירותי
- [x] **WA-P05 | CODE+TEST קיים** `continue_wake` מתבצע ב־entity `update` אחרי שחרור lease וכאשר נשארה עבודה, במקום `updateMany` בלבד. בדיקה עם batch של 1×3 עברה.
- [ ] **WA-P06 | PROD** לוודא ש־CREATE חדש מעורר Worker **ללא דפדפן פתוח** בתוך שניות; לתעד קריאות Workflow שלא נרשמו וגורם.
- [ ] **WA-P07 | PROD** להוכיח ש־16+ הודעות ממשיכות לאצווה הבאה מייד אחרי המרווח הדרוש, ללא תלות ב־Watchdog 5 דקות.
- [ ] **WA-P08** למנוע מצב שבו UPDATE של `wake_requested_at` משגר Worker מרובה בעת עומס; CAS/lease ו־fencing generation מגנים על כל פנייה לספק.
- [ ] **WA-P09** בטיחות lease שפג באמצע HTTP, worker מת אחרי HTTP לפני persist, והספק החזיר timeout/5xx. סטטוס `unknown` אינו retry אוטומטי; נדרש מסלול reconcile.
- [ ] **WA-P10** לבחון זמן ריצה מקסימלי, `max_messages_per_run` ו־Backpressure. כל הודעה ראשונה בתור ריק יוצאת בלי sleep; בין הודעות אותו ספק רק בהתאם ל־ms מוגדר. בדיקת מעבר ספק באמצע backlog.

### WP2 — קליטת הודעות, קבצים ואמת סטטוסים
- [x] **WA-P11 | CODE קיים** `requested_provider` מקובע בהכנסה ל־Outbox. אין שינוי ספק של הודעה קיימת בדיעבד.
- [x] **WA-P12 | CODE+TEST קיים** Idempotency, סוג מסר טקסט/קבוצה/מסמך, כתובת קובץ פרטית ומניעת expiry לפני יצירת URL חתום.
- [ ] **WA-P13** לוודא שכל מסלול שולח דרך אותה שכבת Outbox: שיבוץ, תזכורת, חשבונית, הצעת מחיר, קישור תשלום/אשראי, הסכם, הודעה ידנית והודעה לקבוצה; לא לשנות לוגיקה עסקית בתהליך. **תלות בין-תחומית בלבד:** מסלול שיבוץ V2 עם `idempotency_key` יציב נבנה במצב כבוי ומתועד ב־`docs/pulse-stability-recovery-plan-2026-10-14.md` (D08.2–D08.8). העדיפות העסקית/הפעלת UI וה־rollback נשארים *שם*; כאן בוחנים רק את קבלת ה־Outbox, Worker, ביצועים ואמינות Provider. אין להפעיל מצב V2 דרך מסמך WhatsApp.
- [ ] **WA-P14** אם producer קיבל `queued`, לא להציג `accepted`; אם mirror של ClientMessageDelivery נכשל, להסתמך על job מאומת ולתקן mirror בהמשך, לא לסמן `failed`.
- [ ] **WA-P15** כתיבת receipt אסינכרונית אחרי הספק: `accepted` = API אישר, לא delivery. מיפוי `delivered/read` יגיע רק מאירוע חתום לפי יכולת ספק; להציג "לא ידוע" כשלא נתמך.
- [ ] **WA-P16** לקובץ/חשבונית/PDF: חידוש URL חתום רק סמוך לשליחה ושמירת תוכן לוגי/שם קובץ, בלי פקיעת תוקף בעת תור ארוך.
- [ ] **WA-P17** תוצאת `unknown`: ליצור מסלול בירור ידני עם ההיסטוריה אצל ספק, ולא לאפשר resend אוטומטי ללא אישור שלא נשלח.
- [ ] **WA-P18** כשל 429 ודאי: retry מתוזמן עם backoff מתאים ושמירת `retry_after`; לא לבצע replay עיוור ל־timeout.

### WP3 — לוח בקרה, התראות ופעולות בטוחות
- [ ] **WA-P19** UI מציג לכל הודעה: מקור, תאריך קליטה, זמן יעד, ספק קבוע, זמן ניסיון, סטטוס, קוד שגיאה/שלב, Receipt, ו־"התקבל אצל ספק ≠ נמסר".
- [ ] **WA-P20** חיוג "שלח ידנית" **רק** במצב failed מוכח לאחר בדיקת מקור. עבור `unknown` דורש אישור ובדיקה; עבור PDF לא להבטיח צירוף קובץ אוטומטי ב־wa.me.
- [ ] **WA-P21** מטריקת חריגת SLA דינמית: זמן ציפייה = כמות הודעות due קודמות × מרווח, ועוד זמני provider שנמדדו; התראה אחת למקור ולא לכל ניסיון.
- [ ] **WA-P22** Dedup התראות פעמון וקישור ישיר ל־Outbox; אם יש row `accepted`, לא לדווח "לא נוצרה הודעה" בדיעבד. שינוי סטטוס אחרי התאוששות ללא מחיקת audit.
- [ ] **WA-P23** ממשק שליטה למנהל בלבד: paused/resume, ביטול הודעות שטרם נשלחו, retry מבוקר, resolve/archive עם audit, מעבר ספק דיפולטיבי ללא שינוי jobs קיימים.

### WP4 — בדיקות פרודקשן ושחרור
- [ ] **WA-P24 | PROD** משתמש מאשר מספר בדיקה; לבצע טקסט, קבוצה, PDF, חשבונית, לינק והסכם בכל ספק רלוונטי, ולראות שליחה ב־WhatsApp עצמו.
- [ ] **WA-P25 | PROD** להפעיל מאמץ 10–20 הודעות בזמן מוגדר, worker ללא browser, ואת 3 דרכי ההתעוררות; להשוות baseline בתיעוד.
- [ ] **WA-P26** לבדוק שלא השתנו שיבוצים, תזכורות עסקיות, הרשאות, חשבוניות וסטטוס Event בעקבות שינוי תשתית.
- [ ] **WA-P27** לשמור rollback ממוקד של שכבת התור בלי למחוק DB, בתנאי שה־`sending/unknown` נבדקו ואין סיכון להודעות כפולות.
- [ ] **WA-P28** Go/No-Go לאחר SLA מוכח, כיסוי כל המסלולים, ושני ימי תפעול ללא הודעות שאבדו/נשלחו פעמיים.
- [x] **WA-P29 | CODE+TEST 15.10** הוסר בירור ספק מיותר בתהליך enqueue כאשר מתקבלת בקשה כפולה עם אותו `idempotency_key`. `resolveWhatsAppProvider()` מופעל עכשיו **רק אם נוצרת רשומת Outbox חדשה**, תחת נעילת ה־dedupe; מפתח קיים מחזיר רשומה קיימת בלי קריאת הגדרות נוספת. כוסה בבדיקה ב־`tests/whatsapp-central-outbox.test.mjs`. אינו משנה נתונים, קצב, או ספק שמקובע ברשומה.
- [x] **WA-P30 | CODE+TEST 15.10 21:56** צומצם מסלול enqueue עם מפתח idempotency ל־**שתי** קריאות של QueueControl.filter במקום שלוש וללא קריאת `get` עודפת לאימות CAS שכבר החזיר `updated=1`. ה־Backend מעביר לספרייה את Control שנקרא, ונעילת CAS קוראת גרסה עדכנית ומוודאת ש־enabled לא בוטל בינתיים. בדיקות: מניעת כפל במקביל, החלפת ספק, כיבוי בעת יצירה והעדר שליחה בלתי־מורשית. אינו מפעיל אף HTTP ספק בעצמו.
- [ ] **WA-P31 | PERF — תוספת גיבוי Intent לשיבוץ:** `processWhatsAppOutbox` משתמש ב־Watchdog הקיים (אחת ל־5 דקות) גם לאיתור בקשות שיבוץ V2 שלא הוכנסו ל־Outbox. **אין Cron חדש.** כאשר המתג העסקי כבוי, נדרשת קריאת `AppSettings.filter` אחת בלבד בקריאת Watchdog וללא סריקת `EventService` או שליחה. לפני הפעלת V2 למדוד עומס וקרדיטים בפועל ולשקול cache/control flag אם הקריאה מהווה עלות משמעותית. תוכן/מדיניות Intent העסקי מנוהלים *רק* במסמך Pulse הכללי D08, לא כאן.
- [x] **WA-P32 | CODE+TEST 17.10 — קצב לכל ספק לפי שליחה אמיתית:** לשדה הבקרה נוספו `last_green_dispatched_at`, `last_wasender_dispatched_at`. Worker אחד נשאר בעל נעילה אחת, אבל המתנה בין הודעות מחושבת בנפרד לכל ספק. בזמן מיגרציה, אם טרם קיימת חותמת ספק, משתמשים בחותמת הגלובלית הישנה לשמירת מינימום בטוח. גם `WhatsAppQueueAdmin.status.nextAllowedInMs` מציג חישוב לפי הספק הפעיל ולא לפי האחרון בכלל התור. בדיקות שינוי ספק בזמן backlog, מינימום מילישניות ותאימות לאחור עברו. אין שינוי במרווחים שנבחרו בידי המנהל.
- [x] **WA-P33 | CODE+TEST — Green API 2xx שאינו אישור אמיתי:** `shared/whatsappSend.ts` אינו מסמן `accepted` בלי מזהה `idMessage` תקף או כאשר התקבלה `success:false`. HTTP 200 ללא אישור מוגדר `unknown` (אולי הספק שלח, לכן **אין ניסיון חוזר אוטומטי**). בדיקת HTTP 200 ללא מזהה מול receipt תקין עברה.
- [x] **WA-P34 | CODE+TEST — בידוד תקלות ספק ותור תקוע:** עובד התור סופר הודעות שבוטלו/פגו בתוך `maxMessagesPerRun` כדי שלא יעבד 1,000 הודעות כושלות בלי לעצור. HTTP 401/403 ודאי מסיים רק את ההודעה שנדחתה, בלי לעצור הודעות Wasender/Green אחרות. חוסר credentials לפני פנייה לספק משנה את הרשומה ל־`retry_wait` עם ניסיון בטוח עתידי — אין HTTP, אין attempt, אין חסימה של הספק השני. בדיקות 401, העדר מפתח, תוצאה `unknown` ומגבלת batch עברו.
- [x] **WA-P35 | CODE+TEST — האצת דשבורד התור ושמירת פרטיות:** `WhatsAppQueueAdmin.status/list/metrics` מבקש מ־Base44 רק את השדות הנדרשים (field projection), במקום למשוך תוכן הודעות, private FileUri ו־URLs חתומים של 500/200/60 רשומות בעת רענון. פתיחת פרטי הודעה (`get`) ממשיכה לטעון תוכן מלא למנהל המורשה. בדיקות קיום שדות דרושים ואי־שליפת גוף הודעה עברו. **השיפור בזמני מסך Live טרם נמדד**.
- [x] **WA-P36 | CODE+TEST — אמת אחת לתשובת הכנסת הודעה לתור:** `shared/whatsappReceipt.ts` מסווג באופן אחיד `queued/retry_wait/sending/accepted/unknown/failed/cancelled/expired/resolved/unverified`. סדר הבדיקה מכריע מצבי כשל/Unknown גם אם `queued:true` שגוי. אומץ ב־`dailyScheduledNotifications`, `processScheduledPushNotifications`, `sendPushNotification`, `sendEventReminders` ו־`clientBillingMessages`. אלה אינם טוענים "הודעה נשלחה" כשיש רק תור, אינם מסמנים מקור PPN כ־sent בגלל dedupe unknown, ולא מחשיבים כישלון לתוצאת accepted. קיימות בדיקות רגיסטר לסיווג כל הסטטוסים.
- [x] **WA-P37 | CODE+TEST — מניעת שליחה כפולה של תזכורות אירוע:** `shared/whatsappBusinessKeys.ts` יוצר מפתח קבוע מאירוע+תאריך/שעה+תבנית/תזמון+ספק או מנהל. `dailyScheduledNotifications` ו־`sendEventReminders` משתמשים באותו מפתח גם אם המערכת רצה פעמיים; `PendingPushNotification.data.idempotency_key` נושא אותו מפתח בשעות שקט, ו־`processScheduledPushNotifications` משתמש בו בעת הכנסה ל־Outbox. בדיקת שני יצרנים ו־Outbox יחיד עברה. **זהו רק dedupe של הודעת WhatsApp**; איחוד יצירת InApp/Push ותזכורת בעקבות שינוי תאריך עדיין פתוחים במעקב העסקי הכללי E07/E08.
- [x] **WA-P38 | CODE+TEST — קישורי תשלום וקבלות:** `clientBillingMessages` קורא receipt לפני הצלחה. הודעת תשלום `unknown/resolved/cancelled/expired` אינה מפעילה אימייל חלופי אוטומטי שעלול לכפול מסר, ו־`failed` ודאי יכול לבצע fallback לאימייל הקיים. אם אף ערוץ לא נקלט — שגיאה נשמרת אצל הקורא ולא מסמנים תזכורת תשלום כטופלה. שני מקורות תשלום משתמשים במפתח קבוע: `payment-receipt:<paymentId>` או `payment-link-reminder:<paymentId>:<expiry>`; תזכורת של קישור מחודש מקבלת מפתח חדש. בדיקות VM ל־7 מצבים עברו. **לא בוצע חיוב כספי ולא הודעה ללקוח אמיתי.**
- [x] **WA-P39 | TEST — עומס 100 הודעות מכל המקורות:** מבחן מדומה של 100 הודעות × 10 סוגי מקור, עם Green/Wasender לסירוגין, שני Workers מתחרים, 401/429/503 סינתטיים, ובדיקת worker נוספת אחרי העיבוד: כל 100 ההודעות קיבלו מצב, לכל הודעה לכל היותר ניסיון Provider אחד, שום `unknown` לא נשלחה שוב. אינו מדד SLA ממשי או מסירה בפרודקשן.
- [ ] **WA-P40 | P0 — כיסוי כל יצרני ההודעות:** במסלולים נוספים של `dailyScheduledNotifications` (משימות, תשלום, חסר שיבוץ, תזכורת pending ועוד), `sendPushNotification` ו־`manualTriggerNotification` עדיין יש הודעות ללא מפתח עסקי יציב. **אסור להוסיף אוטומטית hash של גוף הודעה או dedupe גלובלי** כי הדבר יכול להשתיק שליחות ידניות לגיטימיות. יש למפות סמנטיקה של כל מקור, version, חלון תזכורת והאם מותרת חזרה — לאחר מכן להוסיף מפתח לכל יצרן ובדיקת two-producers. השלב הבא ב־WhatsApp.
- [ ] **WA-P41 | P0 — אימות התעוררות Live:** להוכיח `Outbox.create→Worker` תוך שניות גם כשאף מסך אינו פתוח, `continue` מעל 16 הודעות, שמירת lease ו־watchdog להתאוששות ללא replay. ההמתנה בתור נצפתה בעבר p95 כ־27 דקות; *היא אינה נחשבת מתוקנת עד מבחן פרודקשן.*
- [ ] **WA-P42 | P0 — חיווי/רקונסיליאציה ל־source:** נדרשת התאמה בין `Task.whatsapp_notification_sent`, `Payment.link_reminder_sent`, `InAppNotification.whatsapp_sent` לבין `Outbox`; מקור עסקי שנכתב לפני enqueue אינו ראיה שהודעה אכן הוכנסה לתור. תיעוד אירועי הפצה/תזכורות מנוהל בתוכנית Pulse הכללית E/B, אך ביצועי Outbox וקישור `sourceId/jobId` כאן.
- [ ] **WA-P43 | P1 — עומס ונתוני אמת:** p50/p95 dispatch ו־UI, 1/10/20 הודעות, טקסט/קבוצת WhatsApp/קובץ/חשבונית/הסכם/קישור תשלום, שתי תצורות ספק, שינוי ספק באמצע backlog. נדרש נמען QA מאושר; לא ליצור הודעות לנמענים אמיתיים לבדיקה.
- [x] **WA-P40a | CODE+TEST 17.10 (סשן המשך) — מפתחות Idempotency עסקיים נוספים:** בשש קבוצות של הודעות אוטומטיות נוסף מזהה קבוע שאינו hash של גוף ההודעה: תזכורת ספק ממתין לפי שירות+ספק+סבב, התראת חסר שיבוץ למנהל לפי אירוע+revision, תזכורת חוב ללקוח לפי אירוע+נמען+סבב, תבנית scheduled_check לפי אירוע+נמען+תבנית+שירות, עיכול משימות יומי לכל מנהל לפי SHA-256 של מזהי המשימות ותאריכי היעד, ומשימה בודדת דרך Pending ב־`scheduleTaskReminder`. גם `checkAutomatedTriggers` היוצר הישן חולק עם `dailyScheduledNotifications` אותו מפתח ל־scheduled_check, כולל שעות שקט; מצב `unknown` אינו מדווח כהצלחה. בדיקות ריצה אמיתיות של הפונקציות עם DB/ספק מדומים מאשרות מפתח יציב ושינוי גרסה תקין. **לא הופעל שינוי בנתוני Live.**
- [ ] **WA-P40b | P0 — השלמת כיסוי מסלולי Legacy נוספים:** `handleSupplierArrivalTimeChange`, `cancelAssignmentsAfterDateChange`, `confirmReassignAfterDateChange`, `checkAutomatedTriggers` בלוג InApp וב־Push, `handleEntityEvents` ו־`sendPushNotification` טעונים מיפוי מקור/גרסה. הודעות ידניות `manualTriggerNotification`, `WhatsApp_SendText`, `shareFinancialDocument` נשארות ללא dedup גלובלי **בכוונה**, כדי לא להשתיק בקשת שליחה חדשה ומפורשת של מנהל. אין להשוות `InApp` ו־`Outbox` כאילו נדרשת רשומת WhatsApp עבור כל Push.
- [x] **WA-P42a | CODE+TEST — בדיקת Mirror Audit ללא פעולת שליחה:** `WhatsAppQueueAdmin.sourceAudit` לבעלים בלבד, לפי לחיצה נפרדת במסך `WhatsAppQueueSettings`; קורא field projections של עד 300 `InAppNotification` ועד 500 `Outbox`, בלי גוף הודעה או טלפון. מציג `accepted` שלא שוקף בשדה `whatsapp_sent`, מקור המסומן כנשלח מול `unknown`, ורשומות היסטוריות לא מקושרות תחת סיווג "לא ראיה לכשל". מגביל כל רשימה ל־25 פריטים, אינו שולח, אינו מתקן DB, ואינו פוגע במהירות `status` הרגילה. נבדקו הרשאות, פרטיות, סיכומי נתונים ו־ESLint.
- [ ] **WA-P42b | P0 — התאוששות/תיקון ממשי של Source state:** יש לבנות Intent עמיד או התאמה אטומית ל־Outbox, ורק לאחר הוכחת קליטת תור לאפשר תיקון אוטומטי של `Task`/`Payment`/`InApp`. מקור שהתעדכן **לפני** יצירת Outbox יכול לחסום שליחה מאוחרת (E21), ואין לשלוח מחדש הודעות היסטוריות או `unknown` בלי ראיות ספק. להקפיד גם על Push בעל Idempotency משלו ועל היסטוריה מעל 7 ימים.



## 4. נתיבים ואחריות
- **WhatsApp infrastructure:** `base44/shared/whatsappOutbox.ts`, `whatsappQueueWorker.ts`, `whatsappSend.ts`, `whatsappProviderConfig.ts`, `base44/functions/processWhatsAppOutbox/entry.ts`, `WhatsAppQueueAdmin/entry.ts`, שלושת workflows, מסכי `WhatsAppQueueSettings` ו־`WhatsAppQueueMessages`. שינוי ביצועים באחד מאלה מתועד **כאן בלבד**.
- **Business UI / assignment speed:** `SupplierAssignmentDialog`, `ServicesCard`, `EventDetails`, `EventsBoard`, `verifyAndRefreshAssignment` — ביצועיהם מתועדים ב־Pulse הכללי ב־D/G, כולל תלות ב־WA-P13 כשנדרשת שליחה.
- **Reminder business rules:** `scheduleEventLifecycleNotifications`, `dailyScheduledNotifications`, `processScheduledPushNotifications`, התניות שבת/שעה/ספק — תכנון הזמנים והכיסוי **ב־Pulse הכללי E**, ביצועי enqueue ו־provider **כאן**.
- **Client agreement/business payments:** נוסח, חתימה, חיוב וזמני תשלום בתוכנית עסקית; חיבור המסר ל־Outbox, ביצועים ואבחון delivery כאן.

## 5. סיכוני ביצועים ותנאי עצירה
- אם provider מאשר באיחור: לא לשייך אוטומטית איחור לתור בלי למדוד זמני HTTP. אם `available_at` בעתיד: זהו deferred תקין.
- אם Workflow חדש אינו מתעורר: אין "לסדר" זאת עם Cron כל דקה בלי בדיקת עלויות Base44. Watchdog נשאר גיבוי בלבד.
- אם endpoint שולח ישירות מחוץ לתור: לשמר תאימות לאחור רק עם feature flag ויצירת תיעוד, ולא לאפשר שני נתיבי שליחה בעת ובעונה אחת.
- אם נוצרה רשומת `unknown`: לעצור retry רגיל ולדרוש בירור.
- אם שינוי גורם לנפילת ביצועי שיבוץ/אירוע: rollback ממוקד של רכיב WA בלבד אחרי בדיקת data consistency.
- לעולם לא להבטיח 0 שגיאות לכל הזמנים; היעד הוא **אפס אובדן לא מדווח** והחלטה ברורה לכל חריגה.

## 6. החלטות תלויות מנהל
- האם יעד SLA לניסיון ראשון בתור פנוי = עד 10 שניות או מותאם לפי ביצועי Base44 הנמדדים.
- באילו מצבים מותר failover Green↔Wasender (תוצאה unknown תמיד מוחרגת).
- אישור נמעני פיילוט, שינוי ספק, ופרסום שמפעיל worker מול ספק חי.
- הגדרת השהיית ספק במילישניות נשארת בידי מנהל מערכת.

## 7. Backlog עתידי — **WhatsApp בלבד**
- [ ] **WA-F01:** webhooks סטטוס delivered/read מאומתים ומניעת replay.
- [ ] **WA-F02:** dashboards של latency p50/p95 לכל ספק וסוג מסר.
- [ ] **WA-F03:** WAHA self-hosted חלופה שלישית לבחינת עלות/אמינות/תחזוקה, בלי שילוב לפני אבטחה ופיילוט.
- [ ] **WA-F04:** failover מבוקר לספק גיבוי, ללא התערבות ב־unknown.
- [ ] **WA-F05:** ייצוא היסטוריית Outbox לניתוח איכות השירות, ללא פרטי הודעות רגישים.
- [ ] **WA-F06:** מדידה של Base44 automation credits ועומס queue worker לפי שעה וספק.
- [ ] **WA-F07:** ניתוח sender reauthentication, QR loss ומגבלות provider כאשר Linked Device נופל.
- [ ] **WA-F08:** reconciler ייעודי לדרישות הודעה שנשמרו במקור עסקי אבל לא נוצר להן Outbox; רק אחרי מיפוי idempotency ומניעת replay מסוכן.
- [ ] **WA-F09:** runbook תפעולי למנהל: בדוק ספק, סטטוס unknown, בחירת provider, wake/diagnose, retry מבוקר, ביטול ושליחה ידנית אחרי כשל מוכח.
- [ ] **WA-F10:** מסך היסטוריית הודעות מאוחדת לפי מקור עסקי, עם קישור בין Intent → Outbox → ניסיון → ספק → מסירה מאומתת.

## 8. יומן סשן (WhatsApp בלבד)
### 13–15.10.2026 — תשתית ושינויים קודמים
- התור המרכזי, ה־worker, ביצוע batching, קצב per-provider, בחירה בין Green/Wasender, הוספת retry/unknown ו־UI קיימים בקוד.
- תיקוני worker continuation ב־`controls.update` אחרי lease, בדיקות race/מניעת כפילויות, ותיקון client context למסלולי לקוח נבחנו במבחני קוד. **טרם אומתו כל מסלולי WhatsApp בפרודקשן.**
- כל מסרי `unknown` והודעות legacy נשמרים להיסטוריה; אין לשלוח מחדש מתוך תוכנית זו.

### 15.10.2026 — הפרדת תוכניות ביוזמת מנהל המערכת
- checkpoint תחילה: `6ad0e7210802938b27437a28`.
- הופרדו אחריות ושמות מסמכים: ביצועי WhatsApp בתוכנית זו; מהירות מערכת כללית ב־`docs/pulse-stability-recovery-plan-2026-10-14.md`.
- מצב מדגם חי: 23 Outbox, מתוכן 21 `accepted`, שתי `unknown`; עובד פעיל/לא מושהה.
- **נקודת עצירה מתוכננת:** ליצור מסמך עצמאי; להסיר כפילות C ממסמך Pulse הכללי; לבצע QA קוד וביצועי Worker מבוקרים ללא שליחת אמת; לעדכן יומן ובדיקות.
- פרסום: לא נדרש לשינוי תיעוד. בדיקת end-to-end מחייבת אישור שימוש במספר ניסוי.

### 15.10.2026, 17:45 — מדדי ביצועים מבוססי אמת וייעול enqueue
- קבצים: `base44/shared/whatsappQueueMetrics.ts` (חדש), `base44/functions/WhatsAppQueueAdmin/entry.ts`, `src/components/admin/notifications/WhatsAppQueueSettings.jsx`, `base44/shared/whatsappOutbox.ts`, `tests/whatsapp-queue-metrics.test.mjs` (חדש), `tests/whatsapp-queue-admin.test.mjs`, `tests/whatsapp-central-outbox.test.mjs`.
- **WA-P02a ו־WA-P29 הושלמו בקוד ובבדיקות**, WA-P02b/c נותרו פתוחים. endpoint המדדים **read-only**, זמין רק למנהל מערכת ונטען בלחיצה בלבד, אינו נוגע בספק או בתור.
- מדד DATA לפני שינוי פרודקשן: מתוך 23 jobs, 21 `accepted`, שתי `unknown` (אין retry אוטומטי), זמן המתנה p50 35.581s / p95 1622.340s, זמן עיבוד אחרי ניסיון p50 1.103s / p95 15.167s. כל ההודעות הללו עברו Green API, ולכן אין מסקנה על ספק WasenderAPI.
- QA: **38/38 ממוקדות**, **188/189 בדיקות מערכת**, כשל יחיד ישן של מדיניות `EventAgreement.create` מול בדיקת RLS, שאינו בתחום WhatsApp. `npm run build` עבר, ESLint למסך WhatsApp עבר ופענוח TypeScript עבר. לא בוצע ניסוי ספק/שליחה אמיתית.
- **סטטוס פרסום:** לא אומת שהקוד החדש פורסם בפרודקשן; נדרשת בדיקת משתמש/פיילוט מבוקר. לא שונו שיבוצים, לא עודכנו הודעות קיימות ולא נשלח שום מסר בבדיקות.
- **Checkpoint אחרי שינויי הקוד והמדדים:** `6ad0ecd534451b2c13104dc7`, commit `3642bb99a16247cec0546082b173fe9266bc682f`. הוא אינו מהווה פרסום לגרסת Live.
- **משימה הבאה:** WA-P02b / WA-P03 (חותמות זמן מפורטות) בתכנון מבוקר, אחריה WA-P06/07 לאימות wake אמיתי לאחר פרסום; אם מתברר שמדד `p95` נותר דקות, לנתח התעוררות Worker לפני העלאת קצב או תדירות Cron.

### 15.10.2026, 21:56 — מדידה מפורקת לפי מקור התעוררות וייעול נעילת תור
- **בסיס:** app `687d1de6659eff83e9c034f7`, repo `pulse_system_shirathanevel`; checkpoint לפני עריכה `6ad1226967b086b876d05b26` (commit `bcfa78f7...`). התור החי בזמן הבדיקה: enabled, unpaused, 23 הודעות היסטוריות, מהן 21 `accepted` ושתי `unknown`. **לא נעשה replay לשתי unknown**.
- **בוצע קוד:** שדות מדידה ב־`WhatsAppOutbox` וב־`WhatsAppQueueControl`; שמירת טיימסטמפים ורווחי קצב בעדכוני Worker הקיימים; סיבת התעוררות בתצורת שלושת Workflows; קריאת reason ב־`processWhatsAppOutbox`, reason ידני ב־`WhatsAppQueueAdmin`; חישובי מדדים חדשים ב־`whatsappQueueMetrics`, וממשק פירוט טכני מתקפל ב־`WhatsAppQueueSettings`.
- **ייעול WA-P30:** הוסר read מיותר מ־enqueue וכן אימות CAS redundant באמצעות `get`; נשארה נעילה אטומית וקריאת enabled עדכנית תחת הנעילה. אופטימיזציה זו מקצרת טיפול בהודעות שיבוץ מרובות **ברמת מספר קריאות מסד**, לא מובטחת עדיין האצה במספר שניות בפרודקשן.
- **בדיקות:** 50/50 בדיקות WhatsApp/queue ממוקדות עברו; **196/197** בדיקות רוחב עברו, כשל RLS ישן בתחום EventAgreement (אינו שייך לשדרוג). `npm run build` ו־ESLint למסך התור עברו. לא שונו תוכן הודעות או מפתחות, לא נוצרו רשומות Outbox אמיתיות ולא השתנה ספק הפעולה.
- **מה לא אומת:** רציפות הפעלת Worker בפרודקשן, ביצועים אחרי פרסום, HTTP טהור ומסירה לנמען; לא לפרש metrics כראיית משלוח.
- **המשימה הטכנולוגית הבאה:** WA-P02b.2/WA-P03.2 לפי עדיפות, אחריה WA-P06/07 בפיילוט לאחר פרסום ונמען מאושר. לשמור checkpoint אחרי QA.

### 17.10.2026 — P0: כל סוגי WhatsApp, בידוד ספקים ומניעת כפל
- **App ו־checkpoint פתיחה:** Pulse המקורי `687d1de6659eff83e9c034f7`, checkpoint `6ad3d1c83397822398d50155`. לא הוחלף ספק ואין שינוי ב־`green_interval_ms=3000` או `wasender_interval_ms=7000` בפרודקשן.
- **מדגם הנתונים לפני השינוי (DATA):** 24 רשומות Outbox (21 `accepted` אצל ספק API, 2 `unknown`, 1 `cancelled`), 0 `queued` במדגם; worker enabled=true, paused=false, ללא lease פעיל; `assignment_intent_v1_enabled` עדיין אינו קיים ולכן V2 כבוי. אין ראיה למסירת 21 ההודעות לנמענים; לא שוחזרו שתי `unknown`.
- **תיקוני קוד/QA שהושלמו:** WA-P32–WA-P39. Worker מפריד קצב ספקים ב־DB, שומר FIFO/lease יחיד, אינו קורס/עוצר את יתר ההודעות בגלל 401/403 ודאי או credentials של ספק אחר; ביטול job נספר במגבלת batch. Green API 2xx ללא id אינו הצלחה. Read-only ניהול התור מושך Projection בלבד. `whatsappReceipt.ts` מאחד את תוצאת `queued/accepted/unknown/failed` בחמישה מקורות; קבלת הקישור לתשלום וקבלה קיבלה מפתח idempotency לפי תשלום; שתי ריצות תזכורות אירוע (כולל שעות שקט) משתמשות במפתח אחד, ללא Replay אוטומטי. שום חיווי `accepted` אינו אישור `delivered`.
- **מקורות Outbox שבוקרו:** `WhatsApp_SendText`, `WhatsApp_SendFile`, `sendWhatsAppMessage`, `sendEventReminders`, `dailyScheduledNotifications`, `processScheduledPushNotifications`, `sendPushNotification`, `manualTriggerNotification`, `shareFinancialDocument`, `clientBillingMessages`, `invoice4uStoredCards`, `agreementLifecycle` ו־`invoice4uClearingCallback`. **כיסוי idempotency עדיין חלקי**: תזכורות אירוע ותשלום תוקנו; יש להוסיף מפתחות ייעודיים לתזכורות משימות/תשלום אחרות ולפעולות לפי מקור, בלי למנוע שליחה ידנית חוזרת שהמשתמש ביקש. מסלולים ישנים במצב queue-off עדיין יכולים לשלוח ישירות מכוח feature flag rollback — המתג לא שונה.
- **מבחני איכות:** `node --test tests/*.test.mjs` — **252/253 עברו**; הבדיקה היחידה שנכשלה היא אותה `tests/event-agreement.test.mjs` ישנה (RLS Create למנהל מול בדיקה שמצפה false), ללא שינוי הרשאות. `npm run build` עבר, Backend TypeScript parse, schema JSON parse ו־ESLint למסך WhatsApp עברו. מבחן מדומה 100 הודעות × 10 מקורות × 2 ספקים × 2 workers, 401/429/503 סינתטיים, נעילת worker וכפילות — ללא ניסיון provider כפול או אובדן שקט. **זהו Test ולא מדידת LIVE**.
- **קבצים חדשים:** `base44/shared/whatsappReceipt.ts`, `whatsappBusinessKeys.ts`, `notificationLookup.ts`, `tests/client-billing-whatsapp-receipt.test.mjs`, `tests/whatsapp-event-reminder-idempotency.test.mjs`, `tests/whatsapp-notification-lookup.test.mjs`. שונו בנוסף shared transport, worker, schema QueueControl, Admin endpoint, כל יצרני ההודעות שנזכרו ובדיקותיהם.
- **אין Claim של פרודקשן:** לא בוצעה הודעת אמת, לא הופעלה גרסת V2, לא בוצעה החלפת ספק, לא התקבלה ראיית delivery ומצב פרסום Live של גרסת הקוד הנוכחית **לא אומת**. ה־checkpoint אינו deployment. אסור להכריז על פתרון מלא או על שיפור p95 עד בדיקות WA-P41/WA-P43 ו־PROD WA-P24/25/28.
- **סדר התחלה בסשן הבא:** P0 WA-P40 — מפתחות מקור משימות/תזכורת/מסמכים בהקשרים עסקיים מבלי להשתיק ידני; WA-P42 — source state ↔ Outbox; WA-P41 — אימות אמת של Worker wake בלי דפדפן, לאחר פרסום מבוקר; WA-P43 — מבחן שליחה לנמען QA בלבד. בטרם הפעלה יש למדוד timeout/ניטור ומקרי failover (unknown לעולם אינו אוטומטי).
- **Checkpoint סיום QA:** `6ad3d9666fbef9071c8086ee`, commit `36ecf88765269d8bd6ddefd56d9d19243b5fcb97` (לפני הוספת מספר הצ'קפוינט למסמכים עצמם). הסתיים ללא פעולה בנתונים עסקיים; אין לפתוח תהליך שליחה חדש לאחר עצירה זו.

### 17.10.2026 — סשן המשך P0: Task, scheduled_check, מקור מול Outbox
- **App/Checkpoint פתיחה:** Pulse המקורי `687d1de6659eff83e9c034f7`, checkpoint `6ad3dbece6680c5a1a12e4ea`, Git HEAD בסיס `f554b5f0cb04359751d1fab6d3e7d6d747fec67a`. לא שונו הגדרות ספק/קצב או מתג V2.
- **QA ונתוני אמת לפני השינוי (Read only):** מדגם Outbox **24 הודעות** — 21 `accepted` אצל API (לא הוכחת מסירה), 2 `unknown` ו־1 `cancelled`; QueueControl `enabled=true`, `paused=false`, `green_interval_ms=3000`, `wasender_interval_ms=7000`. אין הודעות queued במדגם; האחרון שנשלח לא מוכיח את בריאות Wake/Watchdog כעת.
- **WA-P40a שנעשה:** `automatedWhatsAppKey` מוגבל למקורות אוטומטיים ומבוסס זהות עסקית/נמען/גרסה (ללא hash גוף הודעה); `taskDigestWhatsAppKey` הוא SHA-256 של מזהי משימות + גרסאות due ו־admin, נשאר קצר גם ל־500 משימות. `dailyScheduledNotifications`, `scheduleTaskReminder`, `checkAutomatedTriggers` וכן Pending מתוזמן דרך `processScheduledPushNotifications` חולקים מזהים מתאימים לאותו אירוע; `unknown` אינו הצלחה. שליחה ידנית יזומה נשארה ללא dedup בכוונה. **WA-P40b עדיין פתוח** ליתר נקודות הכתיבה והודעות חילופי אירוע.
- **WA-P42a שנעשה:** `WhatsAppQueueAdmin.sourceAudit` + כפתור בדף ניהול תור, לבעלים בלבד, קריאה בלבד; שליפת שדות metadata בהפעלה יזומה ולא ב־page load. מזהה mismatch בין `InApp` ל־`Outbox`; הודעת `unknown` לעולם אינה משודרת שנית; `InApp` היסטורי ללא קישור אינו מוצג כאובדן מוכח.
- **מקטעי Business משלימים (לקרוא במסמך הכללי):** E20a/b — הדגל `Task.whatsapp_notification_sent` נכתב רק לאחר קליטה עמידה לכל הנמענים הדרושים; המתזמן לפי Task/Pending הוא בעלים לפני ה־digest היומי, כולל שמירת version ותוצאה לא ידועה. G11 — תיקון העברת `servicesByEvent` דרך עזרי `scheduled_check` ומבחן ריצה המונע ReferenceError.
- **QA:** סוויטה מלאה `node --test tests/*.test.mjs`: **277/278 עברו**; כשל אחד מוכר **ישן** ב־`tests/event-agreement.test.mjs`, RLS `EventAgreement.create` למנהל מול ציפיית הבדיקה `false`. Build Vite, Parse של קוד Backend, ESLint למסך Admin עברו. בדיקות VM לא־חיות לספקים/תזמונים/Task/מפתחות/היסטוריה לא יצרו הודעה אמיתית.
- **לא הושלם:** אין בדיקות E2E ספק/קבוצת WhatsApp/קבצי PDF/חשבוניות/פוש בפרודקשן, אין הוכחת wake מידי או latency p95 חדש (WA-P41/43), אין reconciliation שמתקן מקור חסר (WA-P42b/E21b), ואין מפתחות business לכל `arrival_time_change`, `assignment_cancel`, `assignment_update` (WA-P40b). הודעות שכבר הוגדרו `unknown` אינן משוחזרות; אין שינוי במסדי Live.
- **פעולת השחרור:** עדיין **לא ידוע/לא אומת** אם גרסת הקוד פורסמה ב־Live; אין להציג "Production Ready". להפעיל רק אחרי פיילוט נמען מאושר, QA עסקי, בדיקת workflow והתאוששות.
- **Checkpoint סיום:** `6ad3e1774633d4a171a089aa`, commit `4904a5a828159212ed6106d895045b757904a703` (לפני הוספת מספר הצ'קפוינט למסמך). השלמת קוד + בדיקות + שני מסמכי תכנון. המשך לפי WA-P40b/WA-P42b ו־WA-P41 לאימות אמת.

### תבנית לסשן הבא
`מועד | App ID + HEAD + checkpoint | WA-P IDs | קבצים ששונו | בדיקות מדויקות | נתוני אמת לפני/אחרי | פרסום/לא פורסם | סיכון | ID הבא`

---

## 9. היסטוריה טכנית — תוכנית C המקורית כפי שתועדה במסמך Pulse הכללי
הפרק הזה שומר תוכן היסטורי ורציונל, אבל **סימון ביצוע עדכני מנוהל בסעיף 3 בלבד** כדי לא ליצור פנקסים מתחרים.

## C — תור WhatsApp ורציפות עובד (P0)

**מפת קוד:** `base44/shared/whatsappOutbox.ts`, `whatsappQueueWorker.ts`, `whatsappSend.ts`, `whatsappProviderConfig.ts`, `base44/functions/processWhatsAppOutbox/entry.ts`, `WhatsAppQueueAdmin/entry.ts`, שלושת `base44/workflows/WhatsApp Outbox*.jsonc`, `src/components/admin/notifications/WhatsAppQueueSettings.jsx` ו־`WhatsAppQueueMessages.jsx`.

- [x] **C01 — תשתית קיימת:** ישות Outbox, ישות Control, בחירת Green/Wasender, עובד מרכזי, תצוגת מצב וממשק ניהול. **CODE** קודם; לא נוצרו מחדש.
- [x] **C02 — קצב לספק:** שדות `green_interval_ms` / `wasender_interval_ms`; הראשון בתור פנוי אינו ממתין מלאכותית; תור משותף לטקסט/קבוצה/מסמך. **CODE+TEST** קודם.
- [x] **C03 — ספק בהכנסה:** `requested_provider` נלכד ביצירת הודעה ואינו משתנה אם ברירת המחדל משתנה. **CODE+TEST** קודם.
- [x] **C04 — idempotency ו־leases:** נעילה אטומית/מפתח עסקי; תוצאת HTTP לא ידועה מקבלת `unknown` ולא retry עיוור. **CODE+TEST** קודם.
- [x] **C05 — תיקון continuation wake:** worker שחרר lease ורק לאחר מכן משתמש ב־`control.update({wake_requested_at})` להפעלת entity UPDATE; קודם השתמש ב־`updateMany` שלעיתים לא מעורר workflow. **CODE+TEST**, `whatsappQueueWorker.ts`.
- [x] **C06 — בדיקת המשך אצוות:** נוספה בדיקה עם שלוש הודעות וביצוע `max_messages_per_run=1`; בדיוק שתי הפעלות המשך ואין קריאת ספק כפולה. **TEST**, `tests/whatsapp-central-outbox.test.mjs`.
- [x] **C07 — mirror של תוקף:** הודעה שפג תוקפה/בוטלה ב־Outbox מסנכרנת `ClientMessageDelivery`, בלי לשלוח לספק. **CODE+TEST**.
- [ ] **C08 — PROD: אימות התעוררות:** הודעת בדיקה חדשה בתור פנוי מתחילה ניסיון תוך שניות, גם אם הדפדפן סגור; להקליט זמני enqueue/lease/provider.
- [ ] **C09 — PROD: המשכיות אמיתית:** כמות הודעות גדולה ממכסת worker עוברת לריצה הבאה בלי המתנה עד ל־watchdog. למדוד כל trigger וכל wake.
- [ ] **C10 — אבחון וטלמטריה:** להוסיף מזהה ריצת worker, סיבה ל־wake, זמני התחלה/סיום, processed/accepted/unknown/failed ומשך חזרה; בלי רישום פרטים רגישים או heartbeat מיותר על תור ריק.
- [ ] **C11 — חיווי SLA:** זמן צפוי בהתאם למיקום FIFO ולספק, והתרעה רק על איחור מהותי/חוסר התקדמות. תנאי SLA מספרי מחכה להחלטה.
- [ ] **C12 — מבחני כשלים:** חוסר ספק, 429, timeout/5xx, קריסה לפני/אחרי פנייה לספק, lease שהתיישן, שתי קריאות worker במקביל, כפילות trigger, הקפאת תור.
- [ ] **C13 — סטטוס מסירה אמיתי:** שימוש רק ב־Webhook/receipt מאומת של ספק לציון delivered/read; אחרת נשאר "התקבל אצל ספק — מסירה לא אומתה".
- [ ] **C14 — ניהול תורים גדולים:** 10, 20, 100 הודעות; worker קצר־זמן שלא חוסם UI; העדפת המשכיות בטוחה ולא polling ללא צורך.
- [ ] **C15 — פיילוט ספק חלופי:** טקסט, קבוצה וקובץ ב־WasenderAPI וב־Green API לנמעני ניסוי בלבד; לוודא מיפוי מזהה ספק לאותו job.
- [ ] **C16 — דוח שגיאות:** עבור `failed/unknown` לציין error stage, קוד ספק, אפשרות פעולה והאם בוצעה פנייה לספק; אין כפתור resend חופשי ל־unknown.

**תנאי קבלה לשלב:** 0 כפילויות בבדיקות תחרות; 0 אובדן מסרים; המשך אצוות אוטומטי; רישום סטטוס אמת; יעד ניסיון ראשון תוך שניות (לא הבטחה לפני הוכחת הפלטפורמה).
