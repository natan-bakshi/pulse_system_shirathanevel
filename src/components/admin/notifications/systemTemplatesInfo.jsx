// תיעוד תבניות מערכת - תבניות שמטופלות בקוד קשיח (לא רק לפי trigger_type בתבנית).
// המטרה היא שקיפות מלאה: לדעת איפה הלוגיקה של כל תבנית רצה, ומה ההגדרות בתבנית שולטות בהן.
//
// מבנה כל ערך:
//  - handler:     שם פונקציית הבקאנד שמטפלת בתבנית
//  - phase:       תיאור הפאזה / נקודת ההפעלה
//  - frequency:   תדירות הריצה
//  - description: הסבר מפורט בעברית
//  - controls:    אילו שדות בתבנית באמת בשימוש (allowed_channels, is_active, וכו')

export const SYSTEM_TEMPLATE_TYPES = {
  SUPPLIER_EVENT_REMINDER: {
    handler: 'dailyScheduledNotifications',
    phase: 'Phase 3',
    frequency: 'פעם ביום (07:00 UTC)',
    description: 'תזכורת לספקים יום לפני האירוע (או לפי timing). מטופלת בקוד קשיח - מחפשת את התבנית לפי קוד הזיהוי SUPPLIER_EVENT_REMINDER.',
    controls: ['is_active', 'timing_value', 'timing_unit', 'title_template', 'body_template', 'whatsapp_body_template', 'allowed_channels', 'deep_link_base', 'deep_link_params_map']
  },
  ADMIN_EVENT_REMINDER: {
    handler: 'dailyScheduledNotifications',
    phase: 'Phase 3',
    frequency: 'פעם ביום (07:00 UTC)',
    description: 'תזכורת למנהלים יום לפני האירוע. מטופלת בקוד קשיח - מחפשת את התבנית לפי קוד הזיהוי ADMIN_EVENT_REMINDER.',
    controls: ['is_active', 'timing_value', 'timing_unit', 'title_template', 'body_template', 'whatsapp_body_template', 'allowed_channels', 'deep_link_base', 'deep_link_params_map']
  },
  SUPPLIER_PENDING_REMINDER: {
    handler: 'dailyScheduledNotifications',
    phase: 'Phase 4',
    frequency: 'פעם ביום (07:00 UTC)',
    description: 'תזכורת חוזרת לספקים שעדיין לא ענו לשיבוץ. תומכת ב-reminder_interval_value/unit ו-max_reminders.',
    controls: ['is_active', 'timing_value', 'timing_unit', 'reminder_interval_value', 'reminder_interval_unit', 'max_reminders', 'title_template', 'body_template', 'whatsapp_body_template', 'allowed_channels']
  },
  ADMIN_MISSING_ASSIGNMENT: {
    handler: 'dailyScheduledNotifications',
    phase: 'Phase 5',
    frequency: 'יום ראשון בלבד',
    description: 'התראה למנהלים על אירועים בשבוע הקרוב שחסרים בהם ספקים (לפי min_suppliers בשירות).',
    controls: ['is_active', 'title_template', 'body_template', 'whatsapp_body_template', 'allowed_channels']
  },
  CLIENT_PAYMENT_REMINDER: {
    handler: 'dailyScheduledNotifications',
    phase: 'Phase 6',
    frequency: 'פעם ביום (07:00 UTC)',
    description: 'תזכורת ללקוחות על יתרות פתוחות באירועים שכבר הסתיימו. תומכת בתזכורות חוזרות.',
    controls: ['is_active', 'reminder_interval_value', 'reminder_interval_unit', 'max_reminders', 'title_template', 'body_template', 'whatsapp_body_template', 'allowed_channels']
  },
  TASK_DUE_REMINDER: {
    handler: 'dailyScheduledNotifications',
    phase: 'Phase 6.5',
    frequency: 'פעם ביום (07:00 UTC)',
    description: 'התראה על משימות שהגיע מועד הביצוע שלהן. נשלחת רק למנהלים המשובצים למשימה (assignee_ids), או לכולם אם לא משובץ. דורשת שמערכת המשימות תהיה מופעלת בהגדרות.',
    controls: ['is_active', 'title_template', 'body_template', 'whatsapp_body_template', 'allowed_channels']
  }
};

// בדיקה האם תבנית היא "מערכתית" (יש לה טיפול קשיח בקוד)
export function isSystemTemplate(templateType) {
  return !!SYSTEM_TEMPLATE_TYPES[templateType];
}

// קבלת מידע מערכתי לתבנית (או null אם רגילה)
export function getSystemTemplateInfo(templateType) {
  return SYSTEM_TEMPLATE_TYPES[templateType] || null;
}