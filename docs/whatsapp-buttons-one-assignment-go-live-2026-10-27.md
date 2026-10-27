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

**השלב המעשי הבא:** GetSettings לקריאה אחת; מיפוי צרכני Webhook; אישור חשבון Green בניסוי חי על מספר בדיקה; הגדרת סודות ו־V2 באופן מדורג. בלי השלבים האלו מצב המערכת `NO_GO`. שאר שדרוגי WhatsApp אינם תנאי להפעלת Pilot המאומת.
