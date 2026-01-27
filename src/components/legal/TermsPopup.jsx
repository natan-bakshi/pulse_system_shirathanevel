import React, { useState, useEffect } from 'react';
import { FileText, Shield, AlertCircle, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { signAgreement } from '@/functions/signAgreement';

export default function TermsPopup({ user }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('terms');
  const [hasScrolled, setHasScrolled] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSigning, setIsSigning] = useState(false);

  // Check agreement status when user changes
  useEffect(() => {
    const checkAgreementStatus = async () => {
      // Don't show popup for admin or supplier users (check both role and user_type)
      if (!user || user.role === 'admin' || user.user_type === 'admin' || user.user_type === 'supplier') {
        setIsLoading(false);
        return;
      }

      // Check localStorage first for quick response
      const localStorageKey = `terms_accepted_${user.email}`;
      const localAccepted = localStorage.getItem(localStorageKey);
      if (localAccepted === 'true') {
        console.log('TermsPopup: Agreement found in localStorage');
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        console.log('TermsPopup: Checking agreement for user:', user.email, 'id:', user.id);
        
        // Try to find agreement by user_email
        const existingAgreements = await base44.entities.SignedAgreement.filter({ 
          user_email: user.email 
        });
        console.log('TermsPopup: Existing agreements found:', existingAgreements.length);

        if (existingAgreements.length === 0) {
          console.log('TermsPopup: No agreements found, showing popup');
          setIsOpen(true);
        } else {
          console.log('TermsPopup: Agreement exists, saving to localStorage');
          // Save to localStorage to avoid future checks
          localStorage.setItem(localStorageKey, 'true');
        }
      } catch (error) {
        console.error('TermsPopup: Error checking agreement status:', error);
        // On error, don't show popup to avoid blocking the user
      } finally {
        setIsLoading(false);
      }
    };

    checkAgreementStatus();
  }, [user]);

  const handleScroll = (e) => {
    const element = e.target;
    const isScrolledToBottom = element.scrollHeight - element.scrollTop <= element.clientHeight + 50;
    if (isScrolledToBottom) {
      setHasScrolled(true);
    }
  };

  const createAgreementHtml = () => {
    const termsContent = document.getElementById('terms-content')?.innerHTML || '';
    const privacyContent = document.getElementById('privacy-content')?.innerHTML || '';
    const disclaimerContent = document.getElementById('disclaimer-content')?.innerHTML || '';

    return `
      <!DOCTYPE html>
      <html dir="rtl" lang="he">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>הסכם התקשרות - חברת שירת הנבל</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; line-height: 1.6; }
          h1 { color: #820C24; }
          h2 { color: #820C24; margin-top: 30px; }
          h3 { color: #333; margin-top: 20px; }
          .signature-block { margin-top: 40px; padding: 20px; background: #f5f5f5; border: 2px solid #820C24; }
        </style>
      </head>
      <body>
        <h1>הסכם התקשרות - חברת שירת הנבל</h1>
        <div class="signature-block">
          <p><strong>חתם דיגיטלית על-ידי:</strong> ${user?.full_name || 'לא זמין'}</p>
          <p><strong>אימייל:</strong> ${user?.email || 'לא זמין'}</p>
          <p><strong>תאריך וזמן:</strong> ${new Date().toLocaleString('he-IL')}</p>
        </div>
        <h2>הסכם התקשרות</h2>
        ${termsContent}
        <h2>מדיניות פרטיות</h2>
        ${privacyContent}
        <h2>כתב ויתור</h2>
        ${disclaimerContent}
      </body>
      </html>
    `;
  };

  const calculateHash = async (content) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const handleAccept = async () => {
    if (!hasScrolled || !accepted || !user) return;

    setIsSigning(true);
    try {
      const agreementHtml = createAgreementHtml();
      const contentHash = await calculateHash(agreementHtml);
      const userAgent = navigator.userAgent;

      const response = await signAgreement({
        agreementHtmlContent: agreementHtml,
        userAgent: userAgent,
        contentHash: contentHash
      });

      if (response.data.success) {
        // Save to localStorage immediately after successful signing
        const localStorageKey = `terms_accepted_${user.email}`;
        localStorage.setItem(localStorageKey, 'true');
        setIsOpen(false);
      } else {
        alert('שגיאה בשמירת החתימה. אנא נסה שוב.');
      }
    } catch (error) {
      console.error('Error signing agreement:', error);
      alert('שגיאה בשמירת החתימה. אנא נסה שוב.');
    } finally {
      setIsSigning(false);
    }
  };

  if (isLoading) return null;
  if (!isOpen) return null;

  const tabs = [
    { id: 'terms', label: 'הסכם התקשרות', icon: FileText },
    { id: 'privacy', label: 'מדיניות פרטיות', icon: Shield },
    { id: 'disclaimer', label: 'כתב ויתור', icon: AlertCircle }
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-2 sm:p-4" style={{fontFamily: 'system-ui, -apple-system, sans-serif'}}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[95vh] sm:h-[90vh] flex flex-col overflow-hidden" dir="rtl">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#820C24] to-[#FFE6B1] text-white p-3 sm:p-4 md:p-6 rounded-t-2xl flex-shrink-0">
          <h2 className="text-lg sm:text-xl md:text-2xl font-bold text-center">ברוכים הבאים לשירת הנבל</h2>
          <p className="text-center mt-1 sm:mt-2 opacity-90 text-xs sm:text-sm md:text-base">נא לקרוא ולאשר את ההסכם המלא</p>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 px-2 sm:px-4 md:px-6 pt-2 sm:pt-3 md:pt-4 overflow-x-auto flex-shrink-0" style={{scrollbarWidth: 'thin'}}>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1 sm:gap-2 px-3 sm:px-4 md:px-6 py-2 sm:py-3 font-semibold transition-all whitespace-nowrap text-xs sm:text-sm md:text-base ${
                  activeTab === tab.id
                    ? 'border-b-2 border-[#820C24] text-[#820C24]'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Icon size={16} className="sm:w-[18px] sm:h-[18px]" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div 
          className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 text-right"
          onScroll={handleScroll}
        >
          {activeTab === 'terms' && (
            <div id="terms-content" className="space-y-6">
              <div className="bg-[#FFE6B1] border-r-4 border-[#820C24] p-4 rounded">
                <p className="text-sm text-[#820C24] font-semibold">
                  הסכם זה מסדיר את תנאי ההתקשרות המלאים בין חברת שירת הנבל הפקת אירועים לבין הלקוח. אישור הסכם זה מהווה הסכמה משפטית מחייבת.
                </p>
              </div>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">1. הגדרת השירותים</h3>
                <p className="text-gray-700 leading-relaxed">החברה עוסקת בארגון, הפקה ותיאום של אירועים, ובפרט בר מצוות, באמצעות צוות פנימי ו/או ספקים חיצוניים.</p>
              </section>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">2. אישור ההסכם</h3>
                <p className="text-gray-700 leading-relaxed">כל ביצוע תשלום, חתימה על הצעת מחיר, העברת מקדמה או אישור בכתב או בעל-פה -- מהווים הסכמה מלאה לאמור בהסכם זה, גם ללא חתימה פיזית. <strong>אישור תנאים אלו באתר מהווה הסכמה מלאה ומחייבת להסכם זה.</strong></p>
              </section>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">3. אחריות וביטוח</h3>
                <ul className="space-y-3 text-gray-700">
                  <li><strong>3.1</strong> החברה תפעל במיטב יכולתה להצלחת האירוע לשביעות רצון הלקוח.</li>
                  <li><strong>3.2</strong> הלקוח מוותר על כל טענה, דרישה או תביעה כלפי החברה, עובדיה, מי מטעמה או ספקיה בגין נזקים, תקלות, לוחות זמנים, ליקויים או אכזבות מכל סוג, לרבות עקב טעות אנוש, מחדל, רשלנות, כשל ספק או כוח עליון.</li>
                  <li><strong>3.3</strong> החברה לא תהיה אחראית לנזקים או כשלים עקב נסיבות שאינן בשליטתה (כגון מזג אוויר, מגפה, מלחמה, שביתות, מעשי טרור).</li>
                  <li><strong>3.4</strong> בכל מקרה, אחריות החברה לא תעלה על סכום העסקה שנגבה מהלקוח בפועל.</li>
                  <li><strong>3.5</strong> החברה אינה מספקת כיסוי ביטוחי למשתתפי האירוע. כל נזק שייגרם -- באחריות הלקוח והמשתתף בלבד.</li>
                  <li><strong>3.6</strong> הלקוח מתחייב לוודא שאורחיו אינם גורמים נזק לרכוש המקום או לציוד. כל נזק שייגרם -- יושת במלואו על הלקוח.</li>
                  <li><strong>3.7</strong> הלקוח מתחייב להחזיק בביטוח צד שלישי תקף בזמן האירוע.</li>
                  <li><strong>3.8</strong> החברה רשאית לדרוש מהלקוח ערבות בנקאית או פיקדון כנגד נזקים אפשריים.</li>
                </ul>
              </section>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">4. ספקים חיצוניים</h3>
                <p className="text-gray-700 leading-relaxed">השירותים עשויים להינתן על-ידי החברה ו/או ספקים חיצוניים (צלמים, DJ, קייטרינג, אולמות וכו'). החברה פועלת כמתאמת בלבד ואינה אחראית על איכות, בטיחות או תפקוד הספקים החיצוניים. כל מחלוקת עם ספק תתברר ישירות בין הלקוח לספק.</p>
              </section>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">5. הזמנות ציוד ושירות נוסף</h3>
                <p className="text-gray-700 leading-relaxed">כל בקשה לציוד נוסף, שינוי בהזמנה או שירות נוסף שלא נכלל בהצעת המחיר המקורית -- טעונה אישור בכתב מהחברה ועשויה לחייב תוספת תשלום. החברה לא תהיה מחויבת לספק שירותים או ציוד שלא אושרו מראש בכתב.</p>
              </section>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">6. ביטול או שינוי האירוע</h3>
                <ul className="space-y-2 text-gray-700">
                  <li>• <strong>ביטול בתוך שבוע מהאירוע:</strong> חיוב 10% מהעלות + כל ההוצאות ששולמו בפועל</li>
                  <li>• <strong>ביטול בין 45 יום לשבוע לפני האירוע:</strong> חיוב 5% מהעלות + כל ההוצאות ששולמו בפועל</li>
                  <li>• <strong>ביטול מעבר ל-45 יום לפני האירוע:</strong> החזר מלא בניכוי הוצאות ששולמו בפועל</li>
                  <li>• <strong>שינוי תאריך או מיקום:</strong> בכפוף לזמינות ולאישור החברה, ועשוי לחייב תשלום נוסף</li>
                  <li>• בכל מקרה של ביטול, כל הוצאה שבוצעה בפועל (הזמנות, מקדמות לספקים וכו') תחויב במלואה</li>
                </ul>
              </section>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">7. זמני הגעה ותחילת האירוע</h3>
                <p className="text-gray-700 leading-relaxed">הלקוח מתחייב להגיע למקום האירוע בזמן המוסכם. איחור של הלקוח עשוי לגרום לקיצור משך האירוע או לביטול חלקי של שירותים, ללא זכות להחזר כספי. החברה לא תהיה אחראית לכל נזק או אי-נוחות הנובעים מאיחור הלקוח.</p>
              </section>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">8. נוכחות קטינים</h3>
                <p className="text-gray-700 leading-relaxed">באירועים בהם צפויה נוכחות של קטינים, הלקוח מתחייב לוודא פיקוח הולם על ידי מבוגרים. החברה אינה אחראית על בטיחות או התנהגות קטינים במהלך האירוע. כל נזק שייגרם על-ידי קטינים יחויב במלואו על הלקוח.</p>
              </section>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">9. שמירה על סודיות</h3>
                <p className="text-gray-700 leading-relaxed">החברה מתחייבת לשמור על סודיות המידע האישי של הלקוח ולא למוסרו לצדדים שלישיים, למעט לספקים הנדרשים להפקת האירוע או במקרים בהם החוק מחייב זאת. הלקוח מאשר כי מידע זה ישותף עם ספקי השירות הרלוונטיים לצורך הפקת האירוע.</p>
              </section>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">10. זכויות יוצרים וקניין רוחני</h3>
                <p className="text-gray-700 leading-relaxed">כל זכויות היוצרים והקניין הרוחני בתכנים, עיצובים, רעיונות ותוכניות שנוצרו על-ידי החברה במסגרת הפקת האירוע שייכים לחברה בלבד. הלקוח לא רשאי לעשות שימוש מסחרי או לשכפל חומרים אלו ללא אישור בכתב מהחברה.</p>
              </section>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">11. שימוש בצילומים ותיעוד</h3>
                <div className="bg-[#FFE6B1] p-4 rounded border-r-4 border-[#820C24]">
                  <p className="text-gray-700 leading-relaxed">
                    <strong>חשוב:</strong> החברה רשאית להשתמש בכל תיעוד שיצולם באירוע, לרבות תצלומי אורחים ומשתתפים, לצרכים פרסומיים, שיווקיים ומסחריים (לרבות פרסום ברשתות חברתיות, אתרים, חומרי שיווק וכו'), ללא צורך באישור נוסף ללא תמורה. על הלקוח לעדכן את אורחיו כי השתתפות באירוע מהווה הסכמה לכך.
                  </p>
                </div>
              </section>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">12. שיפוי</h3>
                <p className="text-gray-700 leading-relaxed">הלקוח מתחייב לשפות ולפצות את החברה, עובדיה ומי מטעמה בגין כל נזק, הוצאה, אובדן, תביעה או דרישה שייגרמו להם כתוצאה מהפרת ההסכם על-ידי הלקוח, מהתנהגות הלקוח או אורחיו, או מכל מעשה או מחדל של הלקוח הקשור לאירוע.</p>
              </section>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">13. מיסוי ותשלום</h3>
                <p className="text-gray-700 leading-relaxed mb-3">תנאי התשלום:</p>
                <ul className="space-y-2 text-gray-700">
                  <li>• התשלום יבוצע כמוסכם בהצעת המחיר ובלוח הזמנים שנקבע</li>
                  <li>• אי-עמידה במועד התשלום תיחשב כהפרת הסכם ותזכה את החברה בזכות לבטל את האירוע ללא החזר כספי</li>
                  <li>• החברה רשאית לעכב או לבטל את ביצוע האירוע עד להסדרת מלוא התשלום</li>
                  <li>• כל המחירים כולל מע"ם אלא אם צוין אחרת</li>
                  <li>• בתשלום באשראי או בצ'קים - הלקוח נושא בעמלות ובדמי ניהול</li>
                  <li>• איחור בתשלום יגרור ריבית פיגורים והוצאות גביה</li>
                </ul>
              </section>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">14. רישוי והיתרים</h3>
                <p className="text-gray-700 leading-relaxed">הלקוח אחראי להשגת כל הרישיונות וההיתרים הנדרשים לקיום האירוע (למשל: היתר משטרה, היתר רעש, אישור כיבוי אש וכו'). החברה תסייע ככל שניתן, אך האחריות הסופית היא על הלקוח. אי-קבלת היתרים עלולה להוביל לביטול האירוע ללא החזר כספי.</p>
              </section>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">15. תקשורת מחייבת</h3>
                <p className="text-gray-700 leading-relaxed">כל תקשורת רשמית בין הצדדים תתבצע בכתב (אימייל, הודעת WhatsApp, מכתב רשום). תקשורת בעל-פה או טלפונית לא תחשב כמחייבת אלא אם אושרה בכתב. כתובת האימייל של הלקוח שנמסרה בעת ההרשמה תיחשב ככתובת הרשמית לצורך תקשורת.</p>
              </section>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">16. פרסום שלילי ומוניטין</h3>
                <p className="text-gray-700 leading-relaxed">הלקוח מתחייב שלא לפרסם תוכן שלילי, מעליב או משמיץ על החברה ברשתות חברתיות, באתרי ביקורת או בכל פלטפורמה אחרת, אלא לאחר שניתנה לחברה הזדמנות סבירה לטפל בבעיה ולפתור אותה בתום לב. הפרת סעיף זה תזכה את החברה בזכות לתבוע פיצויים.</p>
              </section>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">17. העברת זכויות</h3>
                <p className="text-gray-700 leading-relaxed">הלקוח אינו רשאי להעביר את זכויותיו או חובותיו לפי הסכם זה לצד שלישי ללא הסכמת החברה בכתב. החברה רשאית להעביר את זכויותיה וחובותיה לצד שלישי ללא צורך בהסכמת הלקוח, בכפוף להודעה מוקדמת.</p>
              </section>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">18. תוקף ההסכם</h3>
                <p className="text-gray-700 leading-relaxed">הסכם זה נכנס לתוקף מרגע אישורו על-ידי הלקוח (באתר, בחתימה, בתשלום או בכל דרך אחרת) ויישאר בתוקף עד להשלמת כל ההתחייבויות ההדדיות, לרבות תשלום מלא ומסירת כל החומרים והשירותים.</p>
              </section>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">19. שינויים בהסכם</h3>
                <p className="text-gray-700 leading-relaxed">החברה שומרת לעצמה את הזכות לעדכן ולשנות הסכם זה מעת לעת. שינויים יפורסמו באתר ויכנסו לתוקף מיידית. המשך שימוש באתר לאחר פרסום השינויים מהווה הסכמה לשינויים. לקוחות קיימים יקבלו הודעה על שינויים מהותיים.</p>
              </section>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">20. סמכות שיפוט ודין חל</h3>
                <p className="text-gray-700 leading-relaxed">על הסכם זה יחול הדין הישראלי בלבד. סמכות השיפוט הייחודית והבלעדית בכל מחלוקת הנוגעת להסכם זה תהיה לבתי המשפט המוסמכים <strong>בירושלים בלבד</strong>.</p>
              </section>

              <div className="bg-gray-100 p-4 rounded mt-6">
                <p className="text-sm text-gray-600">
                  <strong>פרטי התקשרות:</strong><br/>
                  חברת שירת הנבל - הפקת אירועים<br/>
                  דוא"ל: shirathanevel@gmail.com<br/><br/>
                  <strong>תאריך עדכון אחרון:</strong> נובמבר 2025
                </p>
              </div>
            </div>
          )}

          {activeTab === 'privacy' && (
            <div id="privacy-content" className="space-y-6">
              <div className="bg-[#FFE6B1] border-r-4 border-[#820C24] p-4 rounded">
                <p className="text-sm text-[#820C24] font-semibold">
                  מדיניות זו מתארת כיצד אנו אוספים, משתמשים ומגנים על המידע האישי שלך בהתאם לחוק הגנת הפרטיות בישראל
                </p>
              </div>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">1. בעל מאגר המידע</h3>
                <p className="text-gray-700 leading-relaxed mb-3">
                  <strong>שם החברה:</strong> חברת שירת הנבל - הפקת אירועים<br/>
                  <strong>דוא"ל ליצירת קשר:</strong> shirathanevel@gmail.com<br/>
                  החברה היא בעלת ומפעילת מאגר המידע, ואחראית על טיפול בכל פניות הנוגעות לפרטיות ולמידע אישי.
                </p>
              </section>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">2. איסוף מידע</h3>
                <p className="text-gray-700 leading-relaxed mb-3">אנו אוספים רק את המידע הדרוש לצורך הפקת האירוע:</p>
                <ul className="space-y-2 text-gray-700">
                  <li>• <strong>מידע אישי של הלקוח:</strong> שם משפחה, שמות הורים, טלפון, דוא"ל, עיר מגורים</li>
                  <li>• <strong>מידע על בר/בת המצווה:</strong> שם (ניתן למחוק על ידי הלקוח בכל עת)</li>
                  <li>• <strong>מידע על האירוע:</strong> תאריך, שעה, מיקום האירוע</li>
                  <li>• <strong>מידע טכני:</strong> מטמון (Cache) לשיפור מהירות האתר בלבד - ללא מעקב אישי</li>
                </ul>
                <div className="bg-blue-50 p-3 rounded mt-3">
                  <p className="text-sm text-gray-700">
                    <strong>חשוב:</strong> כל המידע שנאסף מופיע בכרטיסיית האירוע הגלויה ללקוח. אין מידע נסתר או מידע נוסף שנשמר מחוץ למה שמוצג ללקוח.
                  </p>
                </div>
              </section>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">3. שימוש במידע</h3>
                <p className="text-gray-700 leading-relaxed mb-3">אנו משתמשים במידע אך ורק למטרות הבאות:</p>
                <ul className="space-y-2 text-gray-700">
                  <li>• תיאום, ארגון והפקת האירוע</li>
                  <li>• תקשורת עם הלקוח לצורך הפקת האירוע</li>
                  <li>• שיתוף מידע עם ספקי שירות (צלמים, DJ, קייטרינג וכו') הנדרשים להפקת האירוע</li>
                  <li>• עמידה בדרישות חוק ורשויות במידת הצורך</li>
                </ul>
                <p className="text-gray-700 leading-relaxed mt-3">
                  <strong>אנו לא משתמשים במידע למטרות שיווק, מכירה לצדדים שלישיים או מעקב.</strong>
                </p>
              </section>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">4. עוגיות ומטמון (Cookies & Cache)</h3>
                <p className="text-gray-700 leading-relaxed">
                  האתר <strong>אינו משתמש בעוגיות (Cookies) למעקב או לאיסוף מידע אישי</strong>. האתר עושה שימוש במטמון (Cache) טכני לצורך שיפור מהירות טעינת העמודים בלבד. מידע זה הוא מקומי ואינו מועבר לשרתים חיצוניים או משמש למעקב אחר המשתמש.
                </p>
              </section>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">5. שיתוף מידע עם צדדים שלישיים</h3>
                <p className="text-gray-700 leading-relaxed">אנו לא נמכור או נשכיר את המידע שלך. אנו עשויים לשתף מידע רק עם:</p>
                <ul className="space-y-2 text-gray-700 mt-3">
                  <li>• ספקי שירות העובדים עבורנו להפקת האירוע (צלמים, DJ, קייטרינג, אולמות וכו')</li>
                  <li>• רשויות חוק במקרה של דרישה משפטית</li>
                </ul>
              </section>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">6. זכויותיך לפי חוק הגנת הפרטיות</h3>
                <p className="text-gray-700 leading-relaxed mb-3">בהתאם לחוק הגנת הפרטיות בישראל (כולל תיקון 13), יש לך את הזכויות הבאות:</p>
                <ul className="space-y-2 text-gray-700">
                  <li>• <strong>זכות עיון:</strong> לראות את כל המידע האישי שלך המאוחסן אצלנו</li>
                  <li>• <strong>זכות תיקון:</strong> לתקן מידע שגוי או לא מדויק (ניתן לערוך דרך כרטיסיית האירוע)</li>
                  <li>• <strong>זכות מחיקה:</strong> למחוק חלק מהמידע (כגון שם בר/בת המצווה, שם משפחה, פרטי הורים) בכל עת דרך עריכת הכרטיסייה</li>
                  <li>• <strong>זכות להסרת מידע:</strong> לבקש מחיקת כל המידע האישי (בכפוף להתחייבויות חוזיות ודרישות חוק)</li>
                </ul>
                <div className="bg-[#FFE6B1] p-3 rounded mt-3 border-r-4 border-[#820C24]">
                  <p className="text-sm text-gray-700">
                    לממש זכויות אלו, ניתן ליצור קשר בכתובת: <strong>shirathanevel@gmail.com</strong>
                  </p>
                </div>
              </section>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">7. אבטחת מידע</h3>
                <p className="text-gray-700 leading-relaxed">אנו נוקטים באמצעי אבטחה סבירים להגנת המידע שלך, אך לא ניתן להבטיח אבטחה מוחלטת. השימוש באתר הוא על אחריותך.</p>
              </section>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">8. תקופת שמירת מידע</h3>
                <p className="text-gray-700 leading-relaxed">אנו שומרים את המידע שלך עד 7 שנים לאחר סיום האירוע, בהתאם לדרישות החוק הישראלי (לצורך דיווח מס, תיעוד חשבונאי וכו'). לאחר מכן המידע יימחק, אלא אם החוק מחייב אחרת.</p>
              </section>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">9. יצירת קשר</h3>
                <p className="text-gray-700 leading-relaxed">
                  לשאלות, בקשות או תלונות בנוגע למדיניות פרטיות זו או לזכויותיך, ניתן ליצור קשר:<br/>
                  <strong>דוא"ל:</strong> shirathanevel@gmail.com<br/>
                  <strong>שם החברה:</strong> חברת שירת הנבל - הפקת אירועים
                </p>
              </section>

              <div className="bg-gray-100 p-4 rounded mt-6">
                <p className="text-sm text-gray-600">
                  <strong>עדכון אחרון:</strong> נובמבר 2025<br/>
                  מדיניות זו עודכנה בהתאם לתיקון 13 לחוק הגנת הפרטיות בישראל.
                </p>
              </div>
            </div>
          )}

          {activeTab === 'disclaimer' && (
            <div id="disclaimer-content" className="space-y-6">
              <div className="bg-red-50 border-r-4 border-red-600 p-4 rounded">
                <p className="text-sm text-red-900 font-semibold">
                  כתב ויתור זה מגביל את אחריות החברה והאתר כלפי המשתמשים ומהווה ויתור על תביעות מכל סוג
                </p>
              </div>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">1. כתב ויתור כללי</h3>
                <p className="text-gray-700 leading-relaxed">
                  השימוש באתר ובשירותי החברה הינו על אחריותך הבלעדית. האתר והשירותים מסופקים "כמות שהם" (AS-IS) וללא כל אחריות מכל סוג, מפורשת או משתמעת, לרבות אחריות לתפקוד, דיוק, שלמות או התאמה למטרה מסוימת.
                </p>
              </section>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">2. אין אחריות לתוכן האתר</h3>
                <p className="text-gray-700 leading-relaxed mb-3">החברה אינה מתחייבת כי:</p>
                <ul className="space-y-2 text-gray-700">
                  <li>• המידע באתר יהיה מדויק, עדכני, שלם או ללא טעויות</li>
                  <li>• האתר יפעל ללא הפרעות, באופן בטוח, רציף או ללא שגיאות טכניות</li>
                  <li>• התוצאות המתקבלות משימוש באתר יהיו אמינות, מדויקות או מלאות</li>
                  <li>• כל שגיאה, באג או תקלה באתר תתוקן</li>
                  <li>• האתר יהיה זמין בכל עת ללא הפסקות</li>
                </ul>
              </section>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">3. הגבלת אחריות</h3>
                <div className="bg-[#FFE6B1] p-4 rounded border-r-4 border-[#820C24] mb-3">
                  <p className="text-gray-700 leading-relaxed font-semibold">
                    החברה, עובדיה, מנהליה, בעליה וספקיה לא יהיו אחראים בכל מקרה לכל נזק ישיר, עקיף, מיוחד, תוצאתי, עונשי או נזקים אחרים מכל סוג, לרבות:
                  </p>
                </div>
                <ul className="space-y-2 text-gray-700">
                  <li>• אובדן רווחים, הכנסות או הזדמנויות עסקיות</li>
                  <li>• אובדן מידע, נתונים או קבצים</li>
                  <li>• הפסקת עסקים או פעילות</li>
                  <li>• עוגמת נפש, אכזבה או נזק רגשי</li>
                  <li>• נזקים נלווים, תוצאתיים או עקיפים</li>
                  <li>• נזק לרכוש או לגוף</li>
                </ul>
                <p className="text-gray-700 leading-relaxed mt-3 font-semibold">
                  בכל מקרה, האחריות המצטברת המקסימלית של החברה לא תעלה על הסכום ששולם בפועל על-ידי הלקוח עבור השירות.
                </p>
              </section>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">4. נגישות האתר</h3>
                <div className="bg-yellow-50 p-4 rounded border-r-4 border-yellow-500 mb-3">
                  <p className="text-gray-700 leading-relaxed">
                    <strong>ויתור על תביעות בנושא נגישות:</strong> החברה פועלת להנגיש את האתר בהתאם לחוק, אך אינה מתחייבת לנגישות מלאה או מושלמת. המשתמש מוותר בזאת על כל תביעה, דרישה או טענה כלפי החברה בגין:
                  </p>
                </div>
                <ul className="space-y-2 text-gray-700">
                  <li>• ליקויי נגישות באתר או בשירותים</li>
                  <li>• אי-התאמה מלאה לתקן הנגישות הישראלי (ת"י 5568) או בינלאומי (WCAG)</li>
                  <li>• קושי או אי-יכולת לגשת לתכנים או לשירותים באתר</li>
                  <li>• נזקים כתוצאה מליקויי נגישות</li>
                </ul>
                <p className="text-gray-700 leading-relaxed mt-3">
                  במקרה של בעיית נגישות, המשתמש מתחייב לפנות תחילה לחברה בכתובת shirathanevel@gmail.com ולאפשר זמן סביר לתיקון הבעיה, לפני נקיטת כל הליך משפטי.
                </p>
              </section>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">5. קישורים לאתרים חיצוניים</h3>
                <p className="text-gray-700 leading-relaxed">
                  האתר עשוי לכלול קישורים לאתרים של צדדים שלישיים. החברה אינה אחראית לתוכן, מדיניות הפרטיות, נגישות או פעילות של אתרים חיצוניים אלה. השימוש באתרים חיצוניים הוא על אחריותך הבלעדית.
                </p>
              </section>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">6. שינויים באתר ובשירותים</h3>
                <p className="text-gray-700 leading-relaxed">
                  החברה רשאית לשנות, להשעות, להפסיק או לעדכן כל היבט של האתר או השירותים בכל עת, ללא הודעה מוקדמת וללא אחריות כלפי המשתמשים. החברה אינה מתחייבת לשמור על זמינות רציפה של האתר.
                </p>
              </section>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">7. ויתור על תביעות</h3>
                <p className="text-gray-700 leading-relaxed mb-3">
                  השימוש באתר מהווה ויתור מפורש, מלא וסופי על כל תביעה, דרישה, טענה או הליך משפטי כלפי החברה, עובדיה, מנהליה, בעליה וספקיה בגין:
                </p>
                <ul className="space-y-2 text-gray-700">
                  <li>• שגיאות, אי-דיוקים, טעויות או השמטות באתר או בתכנים</li>
                  <li>• נזק אישי, רכושי, כספי או רגשי כתוצאה משימוש באתר או בשירותים</li>
                  <li>• גישה או שימוש לא מורשים לשרתי האתר או למידע</li>
                  <li>• הפרעה, הפסקה או תקלה בשידור לאתר או ממנו</li>
                  <li>• תוכן זדוני, וירוסים או קוד מזיק שעלול להיות מועבר דרך האתר</li>
                  <li>• אובדן או נזק למידע, קבצים או נתונים</li>
                  <li>• ליקויי נגישות או אי-עמידה בתקנים</li>
                  <li>• כל נזק או תקלה אחרת הקשורה לאתר או לשירותים</li>
                </ul>
              </section>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">8. אחריות המשתמש ושיפוי</h3>
                <p className="text-gray-700 leading-relaxed">
                  אתה מסכים לשפות, לפצות ולהגן על החברה, עובדיה, מנהליה ומי מטעמה מפני כל נזק, הוצאה, הפסד, תביעה, דרישה, קנס או הליך משפטי הנובעים משימושך באתר, מהפרת תנאי שימוש אלה, או מהפרה של זכויות צד שלישי כלשהו.
                </p>
              </section>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">9. שיפוט ודין החל</h3>
                <p className="text-gray-700 leading-relaxed">
                  על כתב ויתור זה ועל כל סכסוך הנובע ממנו יחול הדין הישראלי בלבד. סמכות השיפוט הבלעדית והייחודית תהיה לבתי המשפט המוסמכים בירושלים בלבד.
                </p>
              </section>

              <section>
                <h3 className="text-xl font-bold text-gray-800 mb-3">10. פנייה מוקדמת</h3>
                <p className="text-gray-700 leading-relaxed">
                  בהתאם לפסיקה העדכנית בישראל, משתמש המעוניין להגיש תביעה או תלונה כנגד החברה מתחייב לפנות תחילה בכתב לכתובת shirathanevel@gmail.com ולאפשר לחברה תקופה של 30 יום לתקן את הבעיה או להגיב, לפני נקיטת כל הליך משפטי.
                </p>
              </section>

              <div className="bg-gray-100 p-4 rounded mt-6">
                <p className="text-sm text-gray-600 leading-relaxed">
                  <strong>עדכון אחרון:</strong> נובמבר 2025<br/>
                  כתב ויתור זה עודכן בהתאם לחוק הישראלי ולפסיקה העדכנית.<br/><br/>
                  <strong>יצירת קשר:</strong><br/>
                  חברת שירת הנבל - הפקת אירועים<br/>
                  דוא"ל: shirathanevel@gmail.com
                </p>
              </div>
            </div>
          )}

          {/* Scroll indicator */}
          {!hasScrolled && (
            <div className="sticky bottom-0 left-0 right-0 bg-gradient-to-t from-white via-white to-transparent pt-8 pb-4 text-center">
              <p className="text-sm text-gray-500 animate-bounce">⬇ גלול למטה כדי לקרוא את כל התנאים ⬇</p>
            </div>
          )}
        </div>

        {/* Footer with acceptance */}
        <div className="border-t border-gray-200 p-3 sm:p-4 md:p-6 bg-gray-50 flex-shrink-0">
          <div className="flex items-start gap-2 sm:gap-3 mb-3 sm:mb-4">
            <input
              type="checkbox"
              id="accept"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              className="mt-1 w-4 h-4 sm:w-5 sm:h-5 border-gray-300 rounded focus:ring-[#820C24] flex-shrink-0"
              style={{accentColor: '#820C24'}}
              disabled={!hasScrolled}
            />
            <label htmlFor="accept" className="text-xs sm:text-sm text-gray-700 leading-relaxed">
              קראתי והבנתי את <strong>הסכם ההתקשרות המלא</strong>, <strong>מדיניות הפרטיות</strong> ו<strong>כתב הויתור</strong>, ואני מסכים/ה לכל האמור בהם. אני מאשר/ת כי הסכמה זו מהווה חתימה משפטית מחייבת על ההסכם בין הצדדים, ואין לי כל טענה או תביעה כלפי החברה בגין השימוש באתר, השירותים, הפקת האירוע, נגישות האתר או כל נושא אחר הקשור לפעילות החברה.
            </label>
          </div>

          <div className="flex gap-2 sm:gap-3">
            <button
              onClick={handleAccept}
              disabled={!hasScrolled || !accepted || isSigning}
              className={`flex-1 py-2 sm:py-3 px-4 sm:px-6 rounded-lg font-bold transition-all text-xs sm:text-sm md:text-base ${
                hasScrolled && accepted && !isSigning
                  ? 'bg-gradient-to-r from-[#820C24] to-[#FFE6B1] text-white hover:shadow-lg hover:scale-[1.02]'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              {isSigning ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  שומר חתימה...
                </span>
              ) : !hasScrolled ? (
                'נא לקרוא את כל ההסכם'
              ) : !accepted ? (
                'נא לאשר את ההסכם'
              ) : (
                'אני מסכים/ה וחותם/ת דיגיטלית'
              )}
            </button>
          </div>

          <p className="text-[10px] sm:text-xs text-gray-500 text-center mt-2 sm:mt-3">
            אישור זה מהווה חתימה דיגיטלית משפטית מחייבת • עדכון: נובמבר 2025
          </p>
        </div>
      </div>
    </div>
  );
}