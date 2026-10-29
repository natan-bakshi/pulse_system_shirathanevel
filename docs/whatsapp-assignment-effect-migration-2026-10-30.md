# Pulse — מסלול תופעות־לוואי עמיד לשמירת שיבוצים (P0)

**30.10.2026 — שלב הבנייה הגיע לתכנון/כתיבה אטומית מגודרת, אך ללא הפעלת עיבוד עסקי חדש.**

## הבעיה שאומתה
`saveSupplierAssignmentsV2` מבצע `EventService.updateMany` אטומי של שיבוץ הספק ויומן כוונות WhatsApp. לאחריו מתבצעת `EventService.update` של `assignment_intent_wake_at`. אות ההפעלה הזה אינו מכיל את השינוי המקורי ב־`supplier_ids`/`supplier_statuses` ואינו משחזר `old_data` באוטומציות המערכת.

חלק מהפעולות הקיימות מופעלות דווקא בעקבות שינוי השדות עצמם: `onAssignmentChange` (Push, הודעה על דחייה ותזכורות ממתין), `handleEntityEvents` (תבניות מותאמות), `syncEventToGoogleCalendars` (מיפוי וסנכרון יומן) וכן חישוב סטטוס האירוע. לכן הפעלת V2 ללא גשר עמיד עלולה לשמור שיבוץ ולהחסיר תופעות־לוואי, גם אם WhatsApp נשלח.

## מה נבנה בסבב הזה
1. `assignmentEffectParity.ts` מחשב באופן טהור את פעולות ההתאמה לפי מצב קודם ו־patch מתוכנן. מבחין בשיבוץ חדש, פתיחה מחדש, הסרה, שינוי סטטוס, שינוי הערות ספק, שינוי הערות אירוע ושינוי מינימום. בודק תלויות ב־Push, תזכורת, Google Calendar, התראות תבניות ושיוך/סטטוס אירוע. אינו משגר דבר ואינו קורא למסד.
2. `assignmentEffectJournal.ts` מתכנן **משימות בעלות מפתח חד־משמעי** לפי `EventService ID`, מספר גרסה, סוג צרכן ונמען. עבור שני ספקים, יש משימות Push/תזכורת נפרדות. שירותים משותפים נרשמים פעם אחת. היומן כולל רק מזהים עסקיים, סוג פעולה, מצב `planned` וזמן — ללא טלפונים, הודעות, הערות או סודות. מוגבל בכמות/גודל, אינו מאפשר כפילות מזהים או גרסה עתידית פגומה.
3. ב־`EventService.jsonc` הוגדרו שדות אופציונליים `assignment_effects_revision`, `assignment_effects_journal`, `assignment_effects_pending` (ברירת מחדל `false`). לא שונה אף שיבוץ קיים ולא נוספה אוטומציה.
4. `saveSupplierAssignmentsV2` מכין את המשימות ומצרף אותן **לאותו CAS** של השיבוץ ויומן WhatsApp. חשוב: זהו מסלול הכנה בלבד. `assignmentSideEffectsLaunchGate.ts` מסמן `ASSIGNMENT_SIDE_EFFECT_BRIDGE_IMPLEMENTED=false`, ולכן **כל שינוי שדורש פעולה נלווית חסום ב־423 לפני CAS**, גם אם דגל `assignment_intent_v1_enabled` פעיל. שינוי הגדרה בלבד אינו מסיר את החסימה. בהיעדר מימוש גשר אין אפילו קריאת AppSettings נוספת.
5. בדיקת מנהל־על לפי לחיצה, `WhatsAppQueueAdmin.assignmentV2Readiness`, צורפה ל־`WhatsAppQueueSettings.jsx` תחת כלי האבחון המתקדמים. היא בודקת רק שתי הגדרות שרת עם projections, אינה פונה ל־Green, אינה סורקת ספקים או שיבוצים, אינה משנה DB ואינה מאפשרת הפעלה. מציגה את שבע התלויות ושערי GO/NO-GO.
6. בדיקות נוספו ל־`tests/assignment-effect-parity.test.mjs`, `tests/assignment-effect-journal.test.mjs`, `tests/assignment-v2-release-readiness.test.mjs`; ועודכנו בדיקות שמירת V2 ו־`WhatsAppQueueAdmin`. הן מדמות תור/טריגרים בלי לשלוח הודעות.

## לא בוצע — שער בטיחות
- לא חובר עדיין מעבד שמבצע `planned` משימות. לא נעשה claim או ניסיון שליחה. **אסור לשנות את הקבוע `ASSIGNMENT_SIDE_EFFECT_BRIDGE_IMPLEMENTED` ל־true** עד שהצרכנים הבאים ימומשו וייבדקו.
- גשר התראות חייב לפצל תבניות למקבלי הודעות עם מפתחות אידמפוטנטיות נפרדים ולשמור סטטוס `accepted/unknown` בלי replay עיוור. משימת `entity_update_notifications` כללית אינה הוכחה שכל התבניות הגיעו.
- Google Calendar צריך לבצע upsert לפי מזהה אירוע קיים ומיפוי ספקים, כולל הסרת ספק ותיקון מקור; הצלחה חלקית/אי־ודאות נשמרות לבירור, בלי ליצור עותקים כפולים.
- PendingPushNotification/Push זקוקים למזהה עסקי יציב, בדיקת תנאי pending לפני שליחה ומסלול בירור לכשל כתיבה אחרי commit.
- אירועי admin/ספק/WhatsApp צריכים אותו CAS עסקי, מבלי להפסיק פעולות אישור ודחייה מתוך Pulse. מסכי המנהל עדיין כותבים ב־`EventService.update` הישן עד שהעברת כל התלויות מאומתת.
- יש לכתוב worker/reconciler בודד עם claim CAS לכל משימת journal, `processing` לא ברור ל־manual review ולא ל־retry אוטומטי, ו־watchdog קיים ולא Cron חדש. לאחר מכן E2E של save→tasks→receipts→side effects כולל race כפול, איבוד ACK, rollback, ומהירות.
- רק אחרי השלמת כל אלה: הפעלת canary **באירוע אמיתי אחד** עם בקרה וחזרה בטוחה, חיבור Outbox ו־webhook הכללי של Green והודעות feedback ללקוח/ספק.

## תפעול בהווה
- ממשקי Pulse השוטפים, אישור/דחיית ספקים, אוטומציות ההתראות, סנכרון יומן ותור WhatsApp ממשיכים בנתיב הקיים.
- מסך האבחון הוא **קריאה בלבד**, ואינו מציע עריכת Secrets.
- ציון `businessSaveReady=false` באבחון הוא מצב נכון עד השלמת מעבד הפעולות, ואינו תקלה בתור ההודעות.
- אין הודעות WhatsApp חדשות, אין ניסוי חדש, אין ספק שהוסר ואין שיבוץ ששונה במקטע זה.

**המשך מדויק:** לממש per-recipient side-effect dispatcher בשכבה הפנימית עם claim CAS, idempotency ביעד, תוצאות אי־ודאות ושחזור, ולהעביר אחת־אחת את התלויות מתוך `onAssignmentChange`, `handleEntityEvents` ו־Google Calendar. אין לפתוח את הפעלת הכפתורים לפני השלמת ההעברה.
