// סוגי טריגרים עם תיאורים מפורטים
export const TRIGGER_TYPES = {
  entity_create: {
    label: 'יצירת רשומה חדשה',
    description: 'נשלחת כאשר נוצרת רשומה חדשה (למשל: שיבוץ ספק חדש לאירוע)',
    example: 'שיבוץ ספק לאירוע'
  },
  entity_update: {
    label: 'עדכון רשומה',
    description: 'נשלחת כאשר רשומה קיימת מתעדכנת (למשל: שינוי פרטי אירוע)',
    example: 'שינוי מיקום אירוע'
  },
  supplier_assignment_create: {
    label: 'שיבוץ חדש לספק',
    description: 'נשלחת כאשר ספק משובץ לשירות באירוע',
    example: 'שיבוץ צלם לאירוע'
  },
  supplier_assignment_delete: {
    label: 'ביטול שיבוץ ספק',
    description: 'נשלחת כאשר ספק מוסר משירות באירוע',
    example: 'ביטול שיבוץ צלם'
  },
  scheduled_check: {
    label: 'בדיקה מתוזמנת',
    description: 'נשלחת לפי תזמון שנקבע מראש (למשל: תזכורת 7 ימים לפני האירוע)',
    example: 'תזכורת לפני אירוע'
  },
  assignment_status_change: {
    label: 'שינוי סטטוס שיבוץ',
    description: 'נשלחת כאשר סטטוס של ספק משתנה (אושר, נדחה, נחתם)',
    example: 'ספק אישר הגעה'
  },
  event_critical_update: {
    label: 'עדכון קריטי באירוע',
    description: 'נשלחת כאשר משתנים פרטים קריטיים: תאריך, שעה, מיקום או קונספט',
    example: 'שינוי שעת האירוע'
  },
  custom_trigger: {
    label: 'טריגר מותאם אישית',
    description: 'טריגר המופעל ידנית או ע"י קוד חיצוני',
    example: 'אירוע חיצוני'
  }
};

export const TIMING_UNITS = {
  minutes: 'דקות',
  hours: 'שעות',
  days: 'ימים',
  weeks: 'שבועות',
  months: 'חודשים'
};

export const CATEGORIES = {
  assignment: 'שיבוצים',
  event_reminder: 'תזכורות אירועים',
  payment: 'תשלומים',
  quote: 'הצעות מחיר',
  system: 'מערכת'
};

// קהלי יעד עם תיאורים
export const AUDIENCES = {
  supplier: {
    label: 'ספקים',
    description: 'ספקים המשובצים לאירוע הרלוונטי'
  },
  client: {
    label: 'לקוחות', 
    description: 'הלקוח שהאירוע שייך לו'
  },
  admin: {
    label: 'מנהלים',
    description: 'כל המשתמשים עם הרשאת מנהל'
  },
  system_creator: {
    label: 'יוצר המערכת',
    description: 'המנהל הראשי של המערכת בלבד'
  }
};

export const AVAILABLE_VARIABLES = {
  // אירוע
  event_name: { description: 'שם האירוע', example: 'חתונה של משפחת כהן' },
  event_date: { description: 'תאריך האירוע', example: '15/03/2024' },
  event_time: { description: 'שעת האירוע', example: '19:00' },
  event_location: { description: 'מיקום האירוע', example: 'אולמי הגן' },
  event_type: { description: 'סוג אירוע', example: 'חתונה' },
  guest_count: { description: 'מספר אורחים', example: '300' },
  city: { description: 'עיר', example: 'תל אביב' },
  event_id: { description: 'מזהה האירוע', example: 'evt_123' },
  
  // משפחה / לקוח
  family_name: { description: 'שם משפחה', example: 'כהן' },
  child_name: { description: 'שם הילד/ה', example: 'נועה' },
  client_name: { description: 'שם הלקוח (הורה ראשי)', example: 'משה כהן' },
  client_phone: { description: 'טלפון הלקוח', example: '050-1234567' },
  client_email: { description: 'אימייל הלקוח', example: 'moshe@example.com' },
  
  // ספק ושיבוץ
  supplier_name: { description: 'שם הספק', example: 'דיג׳יי אלי' },
  supplier_phone: { description: 'טלפון הספק', example: '052-9876543' },
  supplier_email: { description: 'אימייל הספק', example: 'eli@dj.com' },
  service_name: { description: 'שם השירות', example: 'תקליטן' },
  assignment_status: { description: 'סטטוס שיבוץ', example: 'אושר' },
  
  // פיננסי
  balance: { description: 'יתרה לתשלום (מחושב)', example: '5,000' },
  total_price: { description: 'מחיר כולל לאירוע', example: '15,000' },
  total_paid: { description: 'סה״כ שולם', example: '10,000' },
  discount_amount: { description: 'גובה הנחה', example: '500' },
  quote_total: { description: 'סה״כ הצעת מחיר', example: '15,500' },
  
  // מערכת
  user_name: { description: 'שם המשתמש המקבל', example: 'ישראל ישראלי' },
  admin_name: { description: 'שם המנהל', example: 'מנהל ראשי' },
  days_open: { description: 'ימים מאז פתיחת האירוע', example: '14' },
  min_suppliers: { description: 'מינימום ספקים נדרש', example: '5' },
  current_suppliers: { description: 'מספר ספקים נוכחי', example: '3' },
  
  // קישורים
  event_link: { description: 'קישור לאירוע', example: 'https://...' },
  payment_link: { description: 'קישור לתשלום', example: 'https://...' },
  supplier_link: { description: 'קישור לפורטל ספקים', example: 'https://...' }
};

// הגדרת שדות זמינים לתנאים - מורחב משמעותית
export const CONDITION_FIELDS = {
  // --- שדות בסיסיים של אירוע ---
  status: { 
    label: 'סטטוס אירוע', 
    type: 'select', 
    options: [
      { value: 'quote', label: 'הצעת מחיר' },
      { value: 'confirmed', label: 'מאושר' },
      { value: 'in_progress', label: 'בביצוע' },
      { value: 'completed', label: 'הושלם' },
      { value: 'cancelled', label: 'בוטל' }
    ]
  },
  event_type: { 
    label: 'סוג אירוע', 
    type: 'select', 
    options: [
      { value: 'bar_mitzvah', label: 'בר מצווה' },
      { value: 'bat_mitzvah', label: 'בת מצווה' },
      { value: 'wedding', label: 'חתונה' },
      { value: 'other', label: 'אחר' }
    ]
  },
  location: { label: 'מיקום האירוע', type: 'text', description: 'שם האולם או המקום' },
  concept: { label: 'קונספט', type: 'text', description: 'קונספט האירוע' },
  city: { label: 'עיר', type: 'text' },
  guest_count: { label: 'מספר אורחים', type: 'number' },
  family_name: { label: 'שם משפחה', type: 'text' },
  child_name: { label: 'שם הילד/ה', type: 'text' },
  notes: { label: 'הערות לאירוע', type: 'text' },
  
  // --- שדות פיננסיים (מחושבים) ---
  total_price: { label: 'מחיר כולל', type: 'number' },
  total_paid: { label: 'סה"כ שולם', type: 'number' },
  balance: { label: 'יתרה לתשלום', type: 'number', description: 'חוב פתוח' },
  payment_percentage: { label: 'אחוז שולם', type: 'number', description: '0 עד 100' },
  is_fully_paid: { 
    label: 'האם שולם במלואו?', 
    type: 'select', 
    options: [
      { value: 'true', label: 'כן' },
      { value: 'false', label: 'לא' }
    ] 
  },
  discount_amount: { label: 'סכום הנחה', type: 'number' },
  is_all_inclusive: { 
    label: 'האם הכל כלול?', 
    type: 'select', 
    options: [
      { value: 'true', label: 'כן' },
      { value: 'false', label: 'לא' }
    ] 
  },

  // --- שדות ספקים ושיבוצים ---
  supplier_count: { label: 'מספר ספקים משובצים', type: 'number' },
  has_missing_suppliers: { 
    label: 'האם חסרים ספקים?', 
    type: 'select', 
    options: [
      { value: 'true', label: 'כן' },
      { value: 'false', label: 'לא' }
    ] 
  },
  assignment_status: {
    label: 'סטטוס שיבוץ (כלשהו)',
    type: 'select',
    options: [
      { value: 'pending', label: 'ממתין לאישור' },
      { value: 'approved', label: 'אושר ע״י ספק' },
      { value: 'rejected', label: 'נדחה ע״י ספק' },
      { value: 'signed', label: 'נחתם חוזה' }
    ]
  },

  // --- שדות תזמון ותאריכים ---
  days_until_event: { label: 'ימים עד האירוע', type: 'number', description: 'חיובי = עתיד, שלילי = עבר' },
  creation_date_age: { label: 'ימים מאז יצירת האירוע', type: 'number' },
  event_month: { 
    label: 'חודש האירוע', 
    type: 'select',
    options: [
      { value: '1', label: 'ינואר' }, { value: '2', label: 'פברואר' }, { value: '3', label: 'מרץ' },
      { value: '4', label: 'אפריל' }, { value: '5', label: 'מאי' }, { value: '6', label: 'יוני' },
      { value: '7', label: 'יולי' }, { value: '8', label: 'אוגוסט' }, { value: '9', label: 'ספטמבר' },
      { value: '10', label: 'אוקטובר' }, { value: '11', label: 'נובמבר' }, { value: '12', label: 'דצמבר' }
    ]
  },
  is_weekend: { 
    label: 'האם סופ"ש?', 
    type: 'select', 
    options: [
      { value: 'true', label: 'כן (שישי/שבת)' },
      { value: 'false', label: 'לא (אמצ"ש)' }
    ] 
  },

  // --- פרטי לקוח ---
  client_email: { label: 'אימייל לקוח', type: 'text' },
  client_phone: { label: 'טלפון לקוח', type: 'text' }
};

export const OPERATORS = {
  equals: 'שווה ל-',
  not_equals: 'שונה מ-',
  greater_than: 'גדול מ-',
  less_than: 'קטן מ-',
  contains: 'מכיל',
  is_empty: 'ריק',
  is_not_empty: 'לא ריק',
  changed: 'השתנה (Changed)'
};

// הגדרת דפים לפי הרשאות
export const PAGES_BY_ROLE = {
  admin: [
    { value: 'AdminDashboard', label: 'דשבורד מנהל' },
    { value: 'EventManagement', label: 'ניהול אירועים' },
    { value: 'EventManagement?tab=board', label: 'לוח אירועים' },
    { value: 'ClientManagement', label: 'ניהול לקוחות' },
    { value: 'SupplierManagement', label: 'ניהול ספקים' },
    { value: 'ServiceManagement', label: 'ניהול שירותים' },
    { value: 'QuoteTemplateManagement', label: 'תבניות הצעת מחיר' },
    { value: 'UserManagement', label: 'ניהול משתמשים' }
  ],
  client: [
    { value: 'ClientDashboard', label: 'האירועים שלי' },
    { value: 'EventDetails', label: 'פרטי אירוע' },
    { value: 'EventDetails?tab=payments', label: 'תשלומים' },
    { value: 'ClientGallery', label: 'גלריה' }
  ],
  supplier: [
    { value: 'SupplierDashboard', label: 'האירועים שלי' },
    { value: 'EventDetails', label: 'פרטי אירוע (מוגבל)' }
  ],
  system_creator: [
    { value: 'SettingsPage', label: 'הגדרות מערכת' }
  ]
};