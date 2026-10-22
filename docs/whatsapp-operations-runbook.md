# Pulse WhatsApp — runbook תפעולי בטוח

## מצבים שאסור לבלבל
- `queued` / `retry_wait`: בקשה נשמרה בתור, אך לא בהכרח נשלחה.
- `sending`: ניסיון ספק התחיל; אין לשגר מחדש בלי בירור.
- `accepted`: ספק אישר קבלה ו־provider_message_id נשמר; **לא** הוכחת מסירה לטלפון.
- `unknown`: ייתכן שנשלחה. אסור retry אוטומטי, ספק חלופי או יצירת הודעה חדשה לאותו מפתח.
- `failed`: בדוק קוד, שלב והאם הכשל ודאי לפני retry מבוקר; כשל DB לאחר HTTP אינו כשל ספק ודאי.
- `paused=true`: עצירה. `enabled=false`: בקוד הנוכחי מאפשר מסלול Legacy ישיר; **אינו מתג עצירה**.

## בדיקה ללא שליחה
1. במסך מנהל התור בדוק enabled, paused, ספק, מרווחי ms, last watchdog, last worker run, last wake reason ו־last error.
2. סנן Outbox לפי source_type, סטטוס ותאריך. השווה מקור עסקי, idempotency_key, job_id ו־provider_message_id. אל תעתיק טלפונים/תוכן/קישורים סודיים ללוגים.
3. עבור הסכם: השווה ClientMessageDelivery.queue_job_id ל־WhatsAppOutbox.id; אם המקור `dispatching` או `unknown`, השתמש באבחון read-only וב־watchdog. אין ליצור לינק חדש כדי לבדוק.
4. עבור כפילות שיבוץ: השווה שתי רשומות `assignment_new` לפי service, transition/revision, key, created_date ו־provider_message_id. הבחֵן בין שתי פעולות עסקיות אמיתיות לבין כפילות לאותו מעבר.
5. אם CREATE הצליח ו־worker לא התחיל: בדוק workflow CREATE, `wake_requested_at` של CONTINUE, נעילת worker, זמני rate-limit ו־watchdog. דגימה היסטורית אינה הוכחה לתקלה נוכחית.
6. אם הספק לא זמין: בדוק ספק פעיל ופרטי התחברות בלי לחשוף secrets. אל תעביר הודעת `unknown` לספק שני.

## הסלמה והתאוששות
- `unknown` או receipt חסר: בדיקת provider dashboard לפי מזהה הודעה, רישום תוצאת הבירור ואישור מנהל לפני כל שליחה ידנית. היעדר Receipt אינו הוכחת אי-שליחה.
- `failed` ודאי לפני HTTP: ניתן לשקול retry מבוקר לפי הרשאות והיסטוריה. אין לבצע bulk replay.
- הודעה `accepted` אך מקור עסקי לא עודכן: mirror-only reconciliation; אין קריאת ספק חדשה.
- watchdog מאחר מעל 15 דקות: בדוק את אוטומציית `WhatsApp Outbox Watchdog 5min` ואת הרשאות הפונקציה. אין להוסיף cron או להגדיל תדירות ללא החלטה על עלות.
- rollback: קודם לעצור שליחות חדשות בצורה בטוחה, לסווג `sending/unknown`, לשמור Outbox והיסטוריה, ולשחזר קוד מנקודת שחזור. אין למחוק הודעות או לפתוח מסלול ישיר מקביל.

## תנאי סגירת P0
- פרסום גרסה מאומת; QA מורשה לטקסט, מסמך, הסכם, קישור ושיבוץ; תור ריק ו־16+ הודעות ללא דפדפן פתוח; wake CREATE/CONTINUE/watchdog מדוד; ללא כפילות; receipt ספק בנפרד ממסירה; יומיים תפעול ללא הודעות אבודות. אין להבטיח 100% מסירה דרך ספק חיצוני.
