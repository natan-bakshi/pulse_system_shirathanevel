# Pulse — תוכנית עצמאית: ביצועי שדרוג WhatsApp, תור שליחה ואמינות ספקים
**קובץ קבוע:** `docs/whatsapp-performance-and-reliability-plan-2026-10-15.md`  
**עודכן:** 15.10.2026 | **סטטוס:** תוכנית ביצוע עצמאית פעילה | **P0**  
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
- [ ] **WA-P02b | CODE** לפצל את הזמן הכללי גם ל־`wake_requested→worker_start`, `rate_wait` ו־`HTTP_start→provider_response` באמצעות חותמות זמן נפרדות, `runId` וניקוי נתונים. המדד הנוכחי “זמן טיפול לאחר תחילת ניסיון” עדיין כולל עבודה פנימית לאחר HTTP, ואינו מדידת רשת מדויקת של ספק.
- [ ] **WA-P02c | PROD** לאמת את כפתור המדדים בפרודקשן אחרי פרסום ואת המגבלות של המדגם; לבדוק השוואה בשני ספקים, כשקיימות מספיק הודעות מכל אחד.
- [ ] **WA-P03** להוסיף `worker_run_id`, `wake_reason`, `leased_at`, `batch_count` וכשל שלב מדויק לנתוני control/worker מבלי לרשום מספר טלפון, תוכן הודעה או מפתח.
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
- [ ] **WA-P13** לוודא שכל מסלול שולח דרך אותה שכבת Outbox: שיבוץ, תזכורת, חשבונית, הצעת מחיר, קישור תשלום/אשראי, הסכם, הודעה ידנית והודעה לקבוצה; לא לשנות לוגיקה עסקית בתהליך.
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
