# Pulse / שירת הנבל — נוהל הפעלת ניסיון כפתורי WhatsApp לשיבוץ אחד

**תאריך:** 27.10.2026  
**מערכת יחידה:** Base44 app `687d1de6659eff83e9c034f7`, GitHub `natan-bakshi/pulse_system_shirathanevel`. לא לגעת במערכת האחרת הנושאת את השם Pulse.  
**יעד מדויק:** אישור / דחיית שיבוץ בלחיצה על כפתור עם התאמה להודעה המקורית, וכפתור ״פנייה למשרד״ שפותח WhatsApp למשרד עם אסמכתה. **לא להפעיל לכלל הספקים עד לאחר ניסוי חי מאומת.**

## מציאות בדוקה מול המערכת (לא הנחות)
- תור WhatsApp המרכזי פעיל ואינו מושהה, Green נבחר כברירת מחדל (לפי בדיקות קוד/Settings האחרונות).
- `interactive_outbound_live_enabled` כבוי. `assignment_intent_v1_enabled` כבוי (אומת בשאילתת AppSettings קודמת).
- Base44 Secrets מכילים `GREEN_API_TOKEN` ו־`GREEN_API_INSTANCE_ID`, אך לא `WHATSAPP_INTERACTIVE_SIGNING_SECRET` או `GREEN_API_WEBHOOK_TOKEN`, ואין עדיין סודות pilot scope.
- `greenAssignmentButtonQaWebhook` היא פונקציית Backend בקוד; אין הוכחת מסירה חיה ממופע Green אליה. לא משנים את WebhookUrl הקיים.
- אין מספר בדיקה, EventService וספק שאושרו לניסוי. **אין לאלתר מספר אמיתי או לשייך שיבוץ קיים.**
- אישור חשבון Green לתמיכת mixed reply+URL, והחזרת ה־callback בפורמט הצפוי, טרם בוצע בחשבון המשתמש. שיטות אלו ב־Beta לפי התיעוד הרשמי.

## מה הושלם בקוד
- [x] `greenButtonQaLaunch.ts`: שילוב בשרת ל־worker קיים בלבד, כאשר כל הגדרות האישור מאומתות, כולל V2 פעיל. לא מוסיף בקשות DB בנתיב רגיל ללא Pilot.
- [x] `greenInteractiveOutbound.ts` ו־`whatsappInteractiveWorkerBridge.ts`: שומרים מפתחות, HMAC, קישור להודעת מקור וגרסת שיבוץ בתור לפני HTTP; QA מצומצם למספר צ'אט, EventService וספק **שלושתם ביחד**. כל הודעה אחרת נשארת במסלול הרגיל.
- [x] `greenAssignmentButtonQaWebhook`: מקבל רק Green Bearer, חשבון Green וצ'אט תואמים. שיבוץ QA שלא הוגדר בשרת מסורב עוד לפני רישום Receipt. כל קבלה מאומתת מול Outbox `provider_message_id`, `stanzaId`, action ID חתום, גרסת שיבוץ, טביעת כפתורים ומצב עסקי. אין אישור לפי סדר הודעות.
- [x] **הפרדת עצירת שליחה מקליטה:** `GREEN_BUTTONS_QA_SEND_ENABLED` אחראי לשליחת כפתורים חדשים בלבד. כשהוא כבוי, קליטת לחיצות קודמות אפשרית דרך `GREEN_BUTTONS_QA_INBOUND_ENABLED` הפעיל (ובתנאי יתר ההרשאות, דגל התור ו־V2). הודעת כפתורים שכבר ״קפאה״ ב־Outbox לא תישלח בטעות מחדש כטקסט רגיל במקרה של rollback.
- [x] `greenButtonQaAssignmentPreflight.ts`: בדיקה יזומה של שירות/ספק/מספר, שיבוץ ממתין, יומן V2 והודעת Outbox יחידה וטרם נשלחה; 2–3 קריאות מסד ממוקדות, בלי שמות או מספרים בתשובת המנהל.
- [x] `greenButtonQaEnrollment.ts`: יוצר שיבוץ QA חדש **רק בלחיצה מפורשת של מנהל־העל**, ורק בסביבה עם כל הדגלים, אירוע ושירות שסומנו מראש בשרת. מונע שיבוץ חוזר גם אם יש היסטוריית intent אבל אין Outbox, או אם היו בעבר ניסיונות שליחה. פעולת CAS אחת לעדכון שיבוץ + יומן, ואחריה פקודת wake בהתאם ל־V2. אין HTTP ישיר לספק; ההודעה יכולה להישלח אוטומטית בהמשך דרך התור, ולכן זו פעולה LIVE בפועל לאחר הפעלת הדגלים.
- [x] `greenButtonQaReadiness`: קריאה יזומה אחת למנהל־על — Control + AppSettings + עד שתי רשומות EventService ש־`assignment_intents_pending=true` (בלי תוכן אישי). לא ניתן לטעון מוכנות אם יש עבודת V2 גלובלית אחרת. `greenButtonQaEnrollment` מבצע בדיקה נוספת כזו בטרם CAS, כי הדגל הגלובלי עלול לשחרר אינטנטים שלא היו חלק מהניסוי.
- [x] `WhatsAppQueueAdmin` וממשק ההגדרות: שתי בדיקות readiness, בדיקת שיבוץ, בירור HMAC והפעלה ידנית עם אישור נפרד. ללא קריאת Green/שליחה בזמן בדיקות. סטטוס מוכנות מלא אינו משמש כרישיון לשליחת Pilot.
- [x] בדיקות Mock מקיפות לרמות סוד, טווח QA, שיבוץ היסטורי, גלובל V2, duplicate provider, ACK, receipt CAS, הקפאת snapshot, עצירת שליחה וקליטה לאחר rollback. פירוט תוצאות ברישום `WA-I05q` במסמך הראשי.

## רשימת GO / NO-GO — מחייבת לפני שליחה אמיתית אחת
1. [ ] בצע **GetSettings לקריאה אחת בלבד** באמצעות כפתור מנהל־על הקיים. בדוק האם יש `webhookUrl`, איזה שירותים צורכים אותו והאם Green שולח `Authorization: Bearer`. **אין SetSettings** בשלב הזה.
2. [ ] אם מוגדר Webhook קיים: הכן/אמת ניתוב fan-out שממשיך למסור לכל הצרכנים הקיימים, כולל התראות מצב ותכנים ששייכים למשרד. ללא fan-out מאומת, **אסור להחליף WebhookURL** ל־QA endpoint שמטפל רק בצ'אט אחד. ב־Green קיים URL יחיד למופע.
3. [ ] אמת באמצעות המספר של חשבון הבדיקה שהספק תומך `SendInteractiveButtons` (2 `reply` + 1 `url`) **בחשבון/פלטפורמה בפועל**; בדוק callback ל־`templateButtonsReplyMessage` או `interactiveButtonsResponse` ומזהי `selectedId/stanzaId`. אין להסיק מתיעוד Green בלבד שהחשבון שלך תומך בכל פורמט.
4. [ ] בצע בדיקת read-only שה־AppSettings הגלובלי `assignment_intent_v1_enabled` לא ישחרר שיבוצים אחרים שעדיין ממתינים ב־V2. עצור אם נמצא backlog שאינו שייך לניסוי.
5. [ ] בחר **אירוע בדיקה ייעודי** ללא לקוחות פעילים, שירות חדש וספק בדיקה עם מספר WhatsApp אישי מאושר. זהות היעד: `GREEN_BUTTONS_QA_EVENT_ID`, `GREEN_BUTTONS_QA_EVENT_SERVICE_ID`, `GREEN_BUTTONS_QA_SUPPLIER_ID`, `GREEN_BUTTONS_QA_ALLOWED_CHAT` בפורמט `972...@c.us` — כל אלה מוגדרים בצד שרת בלבד. אין מידע אישי ב־HTML או ב־URL.
6. [ ] הגדר מפתחות Backend ייעודיים נפרדים: `WHATSAPP_INTERACTIVE_SIGNING_SECRET` (לפחות 32 תווים אקראיים), `GREEN_API_WEBHOOK_TOKEN` (לפחות 24 תווים אקראיים ותואם ל־webhookUrlToken לאחר fan-out מאושר). לעולם לא באותו ערך ולא בקוד/דפדפן. סודות קיימים לא מוחלפים.
7. [ ] שמור טיוטת Green בת שלושה כפתורים ומספר משרד. בדוק שהקישור פותח טיוטת WhatsApp עם אסמכתא ולא משנה סטטוס בעצמו. קבע דגל V2 גלובלי רק לאחר בדיקה 4 ואישור נפרד. קבע `interactive_outbound_live_enabled=true` רק לאחר שכל שאר החסמים סגורים.
8. [ ] דגלי שרת נפרדים: `GREEN_BUTTONS_QA_ACCOUNT_VERIFIED=verified` רק לאחר בדיקה 3, `GREEN_BUTTONS_QA_OWNER_APPROVED=approved` רק לאחר החלטה מתועדת, `GREEN_BUTTONS_QA_SEND_ENABLED=enabled`, `GREEN_BUTTONS_QA_INBOUND_ENABLED=enabled`. להפעלת לחיצת יצירה יחידה: `GREEN_BUTTONS_QA_CREATE_ENABLED=enabled` בלבד עד היצירה, ואז לבטל מיד. **אין להשאיר פתח יצירה קבוע לאחר הניסוי.**
9. [ ] לחץ על `greenButtonQaReadiness`, ודא שכל החסמים עברו. לחץ על שיבוץ בדיקה (ולא על ספק אמיתי). בדוק הודעת אחת ב־Outbox וקוד שיבוץ נכון; הפעל את יצירת שיבוץ הניסוי רק עם אישור.
10. [ ] בספק הבדיקה, אמת הופעת הכפתורים. בלחיצה על ״מאשר״, בדוק שינוי `pending→confirmed` פעם אחת בלבד; מסירת callback זהה פעמיים אינה יוצרת שינוי נוסף. לניסוי ״דוחה״ דרושה **הודעת בדיקה חדשה** בגלל לחיצה חד־פעמית. כפתור המשרד פותח טיוטה ולא מעדכן סטטוס. בוחנים גם תמיכה ב־Android/iOS וחוסמים טפסי Web שאינם נתמכים.
11. [ ] רק לאחר סבב אמיתי מוצלח נרשם Go/No-Go לפריסה מצומצמת. אין להכליל אוטומטית לספקים אחרים, לא לתשלומים ולא להודעות לקוח.

## עצירת חירום ו־Rollback (מסלול בטוח)
- **עצירת הודעות כפתורים חדשות בלי לאבד לחיצות קיימות:** שנה **רק** `GREEN_BUTTONS_QA_SEND_ENABLED` מערך `enabled` לערך ריק/כבוי. **השאר** `GREEN_BUTTONS_QA_INBOUND_ENABLED=enabled`, `GREEN_BUTTONS_QA_OWNER_APPROVED=approved`, דגל Queue pilot וה־V2 פעילים עד טיפול בכל תשובות קיימות. שמירת קבלות חתומות ממשיכה. אל תמחק מפתח חתימה לפני סיום חלון התגובות.
- Outbox קפוא עם `interactive_button_bindings_json` לא אמור להפוך להודעת plain retry. הוא יוקפא לבדיקה במקום לשלוח. **אל תלחץ Retry ידני** על Unknown/גרסת שיבוץ מוקפאת.
- ניתוק `GREEN_BUTTONS_QA_INBOUND_ENABLED` הוא עצירת חירום של כל קליטת הכפתורים (מותר רק עם תהליך משרד ידני לקבלת תגובות שנותרו). אין לנתק ישירות את ה־Webhook הקיים או למחוק ספקי הודעות.
- לאחר ניסיון אחד, בקש QA מסוכם: provider acceptance, exact original message correlation, receipt CAS, response time, number of Base44 backend/entity calls. אל תבטיח 0 קרדיטים — אין מדידה אמיתית כרגע.

## מקורות Green API רשמיים
- https://green-api.com/en/docs/api/sending/SendInteractiveButtons/
- https://green-api.com/en/docs/api/sending/SendInteractiveButtonsReply/
- https://green-api.com/en/docs/api/receiving/notifications-format/incoming-message/InteractiveButtonsReply/
- https://green-api.com/en/docs/api/receiving/notifications-format/selected-buttons/ButtonsResponseMessage/
- https://green-api.com/en/docs/api/receiving/technology-webhook-endpoint/

## עדכון ביצוע 28.10.2026 — הושלמה בדיקת שרשרת E2E ב־Mock; ההפעלה החיה עדיין NO-GO
- **זיהוי וסנכרון התחלה:** רק Pulse שירת הנבל, App ID `687d1de6659eff83e9c034f7`, GitHub `natan-bakshi/pulse_system_shirathanevel`. בתחילת הסשן HEAD `b2958b71fe64`, עץ נקי, והאפליקציה במצב Ready.
- **תיקון בטיחות קריטי:** קודם לכן הודעת שיבוץ QA שעדיין לא נחתמה/הוקפאה יכלה לחזור למסלול טקסט רגיל אם מכבים את הניסוי לפני ה־Worker. כעת `greenButtonQaEnrollment` שומר את `qa_buttons_required=true` **באותה פעולת CAS** של השיבוץ ויומן V2; Reconciler ונתיב השמירה המפורש מעבירים אותו ל־Outbox בתור `interactive_qa_required=true`. ה־Worker וגם transport חוסמים שליחת טקסט עבור הודעה מסומנת, גם כשהמתגים, ההרשאות או Scope הניסוי השתנו. השהיה/כשל גורמים לטיפול ידני בשיבוץ הזה בלבד. אין שינוי בתור/ספק עבור שאר ההודעות.
- **מניעת מרוץ כפילות:** `assignmentWhatsAppContext` מאתר את אותו marker רק עבור מזהה השיבוץ וה־Revision המעודכנים, כך שגם `ensureAssignmentWhatsApp` וגם Reconciler משתמשים **באותו מפתח idempotency** ויכולים ליצור לכל היותר Outbox אחד. אין ניתוב הודעות לפי ״ההודעה האחרונה״.
- **חדש: `tests/green-button-qa-chain-e2e.test.mjs`** מדמה ברצף עם מודולי הייצור עצמם: owner enrollment → Intent V2 → wake ידני בסימולציה → Reconciler (כולל קריאות מקבילות) → Outbox אחד עם marker → Worker → תצוגת Green `sendInteractiveButtons` עם 2 כפתורי Reply ו־URL משרד → הודעה שהתקבלה בסימולציה → Webhook מאומת → Receipt עמיד → CAS ספק אחד → callback כפול אינו משנה דבר. תרחישים נוספים: `ensureAssignmentWhatsApp` מקדים את ה־Reconciler, Scope שגוי, rollback **לפני snapshot**, תור כבוי; הודעת Invoice רגילה נשלחת בסימולציה למרות שהניסוי הוקפא. אין אף קריאת ספק אמיתית בבדיקות.
- **אימות רגרסיה:** **737/737** בדיקות Node עברו, `npm run build` עבר, ESLint על קובצי הבדיקה שונו עבר, 7 קובצי TypeScript שונו ונבדקו גם ב־esbuild parsing (תצורת ESLint הקיימת מתעלמת מ־TS), `git diff --check` עבר. לא צומצמה אף בדיקה ישנה כדי לקבל ירוק.
- **קריאות מידע חי ממוקדות:** במערכת הנכונה: WhatsAppQueueControl יחיד עם `enabled=true`, `paused=false`, `interactive_outbound_live_enabled=false`; Green נבחר ב־AppSettings; `assignment_intent_v1_enabled` **אינו קיים** (כלומר אינו TRUE); בבדיקת `assignment_intents_pending=true` נמצאו **0**; Workflow V2 קיים ופעיל אך `total_runs=0`, ולכן מסירת טריגר ה־wake לא אומתה מול נתוני אמת; Watchdog הקיים פעיל. Secrets: מופיעים שמות `GREEN_API_INSTANCE_ID` ו־`GREEN_API_TOKEN`, אך חסרים שני סודות HMAC/Green Webhook וכל סודות Scope+enable של QA. לא נחשפו ערכים.
- **מה לא הופעל:** לא `greenButtonQaEnroll`, לא שליחת Green, לא `GetSettings`, לא `SetSettings`, לא עדכון Webhook, לא V2 גלובלי, לא סודות, לא שינוי ספק, לא שינוי ב־Watchdog, לא polling/cron, לא מערכת Pulse האחרת. המימוש החדש כשלעצמו **אינו אישור** להפעלה חיה.
- **חיובים:** קריאות פיתוח דרך Sandbox + קריאות metadata/read-only ל־Base44 בוצעו; **צריכת קרדיטים בפועל לא נמדדה**. קריאות Green יזומות בסשן: **0**, הודעות WhatsApp חיות שנשלחו: **0**. אומדן בזמן ניסוי חי: לכל היותר שליחה אחת ל־Green וקליטת אירוע לפי לחיצה; קריאות DB במסלול המיוחד יהיו תלויות ב־CAS, Receipt, reconciliation ו־workflow ומחייבות מדידה. אין טריגר רקע חדש.
- **החסם המיידי:** לחיצת **״בדיקת הגדרות Green Webhook״** בחשבון מנהל־על בפעולה `greenWebhookSettingsAudit` מבצעת **GetSettings יחיד לקריאה בלבד** ומחזירה דוח סיכום ללא URL/טוקן/מספר. לכלי הפיתוח אין כרגע קריאה מזוהה בהרשאת מנהל־העל לפונקציה זו, ולכן **לא נעשתה עקיפה של בדיקת הבעלות**. אחרי תוצאתה: לוודא fan-out לצרכנים קיימים, לקבל יעד WhatsApp/אירוע/שירות/ספק ניסיוניים מאושרים, לאמת תמיכה אמיתית של חשבון Green ושל ה־callback, ולבצע GO/NO-GO לפני שינוי דגלים או שליחה אחת.
- **נקודת שחזור שנוצרה ואומתה ב־28.10:** `6ae18c877fdc2fb753ee936d`, commit `33956b0222b13bcbe671feefa57e834e89bf179a` (סונכרן ל־GitHub, עץ נקי). לפני הסשן: `6ae0e495978518c4d96c5157`, commit `b2958b71fe64`. עיגון תיעוד נוסף, אם נוצר, מתועד בהיסטוריית Base44.

## עדכון תקלה 28.10.2026 — אבחון Green GetSettings מחזיר HTTP 503
- **דיווח המשתמש:** בלחיצה על בדוק הגדרות Green API (קריאה אחת, ללא שינוי) התקבלה הודעה כללית שהבדיקה אינה זמינה.
- **עדות מלוגי PROD:** פונקציית WhatsAppQueueAdmin הראתה שתי בקשות POST שהסתיימו ב־503 בשעות 06:14:29Z ו־06:14:55Z (28.10.2026). גרסת הקוד הקודמת מסתירה את הסיבה הפנימית, ולכן אין עדיין ראיה אם Green החזיר 5xx, אם היה Timeout, כתובת שגויה או דחיית זיהוי. בדיקת GetSettings משתמשת נכון ב־GET לפי https://green-api.com/en/docs/api/account/GetSettings/ .
- **תיקון:** מודול greenWebhookSettingsAudit.ts מסווג כעת אך ורק קודי כשל מוכרים: חוסר/אי־תקינות תצורת חיבור, HTTP 401/403, 404, 429, 5xx, Timeout, שגיאת רשת, תגובה פגומה וגודל חריג. לבעל המערכת מוצגים הסבר בעברית וקוד אבחון; לעולם לא כתובת Webhook, מפתח, מספר, גוף תגובה או שגיאה גולמית. נשמרת בקרת מנהל־על וללא נסיונות חוזרים אוטומטיים.
- **אפשרות apiUrl:** מדריך Green מציין שה־apiUrl נמסר לכל מופע. פונקציית הקריאה תומכת ב־Secret אופציונלי בצד שרת GREEN_API_URL, שמקבל רק HTTPS Origin של Green (ולא נתיבים, פורטים, Query או דומיין חיצוני). ללא ההגדרה החדשה ה־GET שומר את כתובת Green ההיסטורית. מסלול שליחת ההודעות הקיים **לא שונה**. זמן המתנה לקריאת אבחון בודדת: עד 10 שניות.
- **ממשק:** תוצאת בדיקה מוצלחת קודמת נמחקת לפני בדיקה חדשה כדי שלא תוצג בטעות אחרי כישלון.
- **אימות Offline:** 5 מבחנים חדשים. סהכ 742/742 בדיקות Node תקינות, Vite build, ESLint עבור JSX והמבחנים, esbuild parse לשני קובצי TypeScript ו־git diff --check נקיים. לא הוכח עדיין שחיבור Green החי תוקן; לא נשלחו הודעות, לא הופעלו כפתורים ולא הוחלף Webhook.
- **פרסום אומת:** checkpoint `6ae1948d44f68343708828e4`, commit `0ddbdb7738d52ef0228696b3221ce604ec97e23e`, שדה last_deployed_at של checkpoint מציג `2026-10-28T06:22:52.181000Z`. Base44 פרסם את גרסת האבחון, אך בדיקת GetSettings החיה לאחר הפרסום טרם הופעלה דרך חשבון מנהל־על. **המשך:** בעל המערכת יבצע לחיצה אחת בלבד וישלח את קוד האבחון אם יופיע. אחר כך ייקבע אם נדרש URL חשבון, אימות סודות או המתנה להתאוששות ספק. אין SetSettings.

**השלב המעשי הבא:** GetSettings לקריאה אחת אחרי פרסום תיקון האבחון, בצירוף קוד אבחון במקרה כישלון; מיפוי צרכני Webhook; אישור חשבון Green בניסוי חי על מספר בדיקה; הגדרת סודות ו־V2 באופן מדורג. בלי השלבים האלו מצב המערכת `NO_GO`. שאר שדרוגי WhatsApp אינם תנאי להפעלת Pilot המאומת.
