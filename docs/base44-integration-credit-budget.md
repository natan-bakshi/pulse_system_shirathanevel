# Pulse – שירת הנבל | מדיניות חיסכון בקרדיטי אינטגרציות של Base44
**עודכן:** 26.10.2026  
**מערכת:** שירת הנבל בלבד; Base44 `687d1de6659eff83e9c034f7`; GitHub `natan-bakshi/pulse_system_shirathanevel`.  
**תחולה:** כל סשן הפיתוח והבדיקות, והמלצות לאופטימיזציה של המערכת החיה. המסמך משלים את תוכנית WhatsApp ולא מחליף אותה.

## כלל-על מחייב
**מזער קרדיטי אינטגרציות ככל האפשר, בלי לפגוע בזמינות, במהירות שליחת WhatsApp, במניעת כפילויות, בגיבויים, באבטחה, בחיובים או בהתראות חשובות.** חיסכון אינו מצדיק עצירת פעולה חיונית או בדיקה חסרה לפני הפעלה. אל תטען שהפיתוח בוצע ב־0 קרדיטים ללא מדידה מתועדת של Base44. הבחנה הכרחית: *Message credits* (שיחות עם בונה Base44) אינם *Integration credits* (שירותי runtime, פעולות built-in, חלק מריצות functions/workflows). חשבון Green/Wasender/OneSignal/Google עשוי לחייב בנפרד.

## נוהל פיתוח חסכוני – ברירת מחדל לכל סשן
1. **Code-first, no-live-call:** קריאת קוד, דיפ, חיפוש, רישום תוכנית וסקירת התנהגות דרך GitHub ובסביבת הקוד. להימנע משימוש בצ'אט הבונה של Base44 כשאפשר לערוך קוד ישירות. בדיקת קוד סטטית אינה מצריכה שליחת WhatsApp, תשלום, מייל, Push, מסמך חתום או OAuth מחודש.
2. **Mock first:** לכתוב ולהריץ Unit/Integration tests עם mock/stub ל־Base44 SDK, Green API, Wasender, OneSignal, Calendar, Drive, חשבוניות ואשראי. להריץ Node test/Vite/lint בסביבת הפיתוח; לא להפעיל endpoints או workflows חיוניים לצורך בדיקות מדומות. קבוצת בדיקות אחת מרוכזת אחרי שינוי במקום אינספור קריאות לבדיקה חיה.
3. **Data inspection only when necessary:** לבדוק מידע חי רק כשאי אפשר להוכיח תקינות מהקוד; קריאה ממוקדת, שדות נדרשים בלבד, limit נמוך, ללא polling ובלא הורדה גורפת. עדיפות לנתוני תצורה ולהיסטוריית לוגים קיימת; אין שינוי רשומות אמיתיות עבור בדיקות.
4. **Live QA gated:** בדיקות provider/live/SendEmail/UploadFile/Push/CreateFileSignedUrl או פעולות תשלום רק בשלב שאי אפשר להחליפן בסימולציה, ובמינימום מקרים מאושרים המוכיחים יכולת מסירה, הרשאות, idempotency והתאוששות. קודם unit tests → dry-run → provider sandbox/test account (אם זמין) → QA חי בודד לנקודת קצה ומספר מורשים. **אין ליזום שליחה/חיוב/העלאה אמיתיים ללא צורך והסכמה מתאימה.** אין להשתמש במספרי ספקים/לקוחות אמיתיים לצורך בדיקות סתם.
5. **No implicit expensive operations:** אין להפעיל functions אוטומטית רק כי מסך מנהל נפתח, אין retry מהיר או סריקות כפולות, אין בדיקות חשבון ספק מתמשכות בכל רינדור. להעדיף on-demand panel, caching קצר ובטוח למידע לקריאה בלבד, batching ו־bounded queries, תוך רענון מיידי אחרי שינוי והרשאות. פונקציות חיות עסקיות נשארות יציבות.
6. **End-of-session credit ledger:** לדווח `live integration calls intentionally triggered by developer: N`, `external provider sends N`, `mock test count N`, אם נוצרה פעולה העלולה לחייב; לא להמציא סכום קרדיטים. כאשר לא נקרא מד Base44, לרשום `actual billed credits not verified`. להשוות בפועל ב־Workspace → Settings → Credit Usage לפי האפליקציה, כשאפשר.
7. **Checkpoint sparingly:** נקודת שחזור לפני שינוי מסוכן ואחרי מקטע שהושלם; אין צורך ב־checkpoint לכל עריכה זעירה. לעדכן מסמך ו־git לאחר השלמה, לא תוך לולאת שליחת הודעות. אל תפרסם/תפעיל ללא בדיקות.

## מיפוי ראשוני של נקודות צריכה בקוד – סטטי בלבד, לא מדידת חיוב
- Base44 workflow: `WhatsApp Outbox Watchdog 5min`, interval=5 דקות. אם פעיל ברציפות: **288 ריצות ביום / 8,640 בחודש בן 30 יום**. זה *לא* בהכרח 8,640 קרדיטים; מודל החיוב בפועל עשוי להיות לפי שלבים/פונקציות ועשוי להשתנות.
- `ריקון תור התראות מתוזמנות (כל שעה)`: שעה אחת; כ־720 ריצות בחודש בן 30 יום אם פעיל תמיד. לוודא שאין חפיפה לעבודה מונעת־אירועים; **לא** לקצץ בלי לבדוק פגיעה בהתראות.
- נמצאו בקוד כמה workflows לגיבוי Google Drive/Sheets ו־`scheduledFullBackup`/ `scheduledBackup` עם `SendEmail` ו/או `CreateFileSignedUrl`; לוודא ביצועים, כפילויות וקרדיטים בפועל **בלי להשבית גיבויים**.
- חיפוש קוד סטטי: `SendEmail` הופיע ב־8 קבצים, `UploadFile` ב־3, `CreateFileSignedUrl` ב־8, ו־`functions.invoke(` ב־29 קבצי frontend; זו **ספירת קבצים** בלבד, לא כמות ריצות ולא הוכחה לחיוב.
- ממשק WhatsApp Admin: `WhatsAppQueueSettings`, `WhatsAppQueueMessages`, `WhatsAppProviderStatus` מבצעים קריאות בזמן טעינה; `WhatsAppInteractiveDraftSettings` נטען רק לאחר הרחבה (כבר חסכוני). לבחון האם אפשר להפחית קריאות כפולות וטעינות של לשוניות סגורות, תוך שמירה על חיווי תור אמין.
- חלק מהקריאות לספקי Green/Wasender/OneSignal הן APIs חיצוניים עם מפתחות המשתמש; לא להחליף שירות עובד בבנוי־Base44 החייב בקרדיטים בלי השוואת מחיר/אמינות. שימוש ב־backend function עשוי בכל זאת לצרוך תקציב execution, גם כש־HTTP חיצוני עצמו אינו built-in.
- ההגדרות המפורטות לעיל נמצאו **בקוד**, לא בסטטיסטיקת חיובים או אימות activation לכל workflow. אין מסקנת עלות, או הוראה לכבות workflow, ללא בדיקה.

## תוכנית מימוש חסכונית, לפי סדר
**P0 – ללא שינוי runtime:** להשיג baseline מדידת Credit Usage לפי אפליקציה ולזהות top consumers וגרסאות workflow. להשוות ימים בעלי פעילות דומה; לא להסתמך על סכומי קרדיטים משוערים ממדריכי צד שלישי.

**P0 – אופטימיזציה שקופה:** לערוך סקר סטטי של כפל קריאות backend, workflows חופפים, polling דפים, סריקות ללא limit וקריאות built-ins. להוסיף חסימת בדיקות חיות כברירת מחדל, ולצמצם עלויות QA באמצעות mocks.

**P1 – מהלך בעל חיסכון פוטנציאלי גבוה:** לבדוק את תדירות Watchdog 5min מול הערך הביטוחי שלו. לשמור wake-on-create, continue-batch ו־recovery גם בתקלות. לא לשנות מרווחי תור, לא להשעות watchdog ולא להחליף אותו ב־cron חיצוני בלי אימות אבטחה, SLA, מחיר, זמינות, rate limits והשוואת שימוש אמיתית; חובה ניתוח P0 של אובדן הודעות ו־unknown.

**P1 – הפחתה מאושרת:** אם נמדד חיסכון משמעותי, להציע מדיניות לאימוץ: coalescing של triggers, filters על שינוי שדות, batching, cache קצר, lazy panels, אי־שליחת דוא״ל הצלחה יומי אם אינו נדרש, ללא שינויים עסקיים לא מאושרים. כל שינוי בגיבויים, הודעות, גישה, זמינות או התראות מחייב החלטת בעל מערכת ובדיקות.

**מדדי הצלחה:** קרדיטי integration/יום לפני/אחרי (לפי חיוב אמיתי), כמות workflow steps/function invocations, ספקי WhatsApp accepted/unknown/duplicate, זמן הודעה ראשונה, זמן פינוי התור, שיעור כשלי notifications וגיבויים. חיסכון ייחשב הצלחה רק אם מדדי האמינות והזמן לא הורעו.

## מקורות אימות – ללא התחייבות לתעריף קבוע
- Base44: `https://base44.com/pricing`, `https://base44.com/features/workflows`, `https://base44.com/guides/cost-to-create-a-game-with-ai`.
- Base44 SDK: `https://doc-sdk.base44.app/FunctionsDocs`, `https://doc-sdk.base44.app/AutomationDocs`.
- תעריפי execution מסוימים (למשל כ־1 credit לכל 100 backend calls או חישוב workflow steps) מופיעים במקורות משניים ועלולים להשתנות: **הסמכות לחיוב בפועל היא מסך Credit Usage של סביבת העבודה**.

## מצב יישום 26.10.2026
- [x] מדיניות חסכונית נוסחה ונשמרה בקוד של **שירת הנבל** בלבד.
- [x] אותרו סטטית workflow חמש דקות, workflow שעתי, מסלולי built-in והפעלות frontend פוטנציאליות.
- [x] לא בוצעו בדיקות WhatsApp/Email/Upload/Push חיות במסגרת יצירת המדיניות.
- [ ] צילום baseline של Credit Usage; לא ניתן לחשב קרדיטים בפועל מסריקת קוד.
- [ ] מיפוי מדויק של workflows פעילים והעלות שלהם, ואז הצעת שינוי נקודתי לאישור.
- [ ] מדידת savings ובדיקות רגרסיה אחרי שינוי מאושר.
