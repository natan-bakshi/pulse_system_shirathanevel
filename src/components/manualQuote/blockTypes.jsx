/**
 * הגדרות סוגי הבלוקים בהצעת מחיר ידנית.
 * כל בלוק שומר על מבנה אחיד: { id, type, content, options }
 */
export const BLOCK_TYPES = {
  FREE_TEXT: 'free_text',
  HEADING: 'heading',
  EVENT_DETAILS: 'event_details',
  INTRO_TEMPLATE: 'intro_template',
  SERVICES: 'services',
  FINANCIAL_SUMMARY: 'financial_summary',
  PAYMENT_TERMS: 'payment_terms',
  AGREEMENT_DISCLAIMER: 'agreement_disclaimer',
  SPACER: 'spacer'
};

export const BLOCK_LABELS = {
  [BLOCK_TYPES.FREE_TEXT]: 'טקסט חופשי',
  [BLOCK_TYPES.HEADING]: 'כותרת',
  [BLOCK_TYPES.EVENT_DETAILS]: 'פרטי האירוע',
  [BLOCK_TYPES.INTRO_TEMPLATE]: 'פתיח / קונספט',
  [BLOCK_TYPES.SERVICES]: 'שירותים / חבילות',
  [BLOCK_TYPES.FINANCIAL_SUMMARY]: 'סיכום כספי',
  [BLOCK_TYPES.PAYMENT_TERMS]: 'תנאי תשלום',
  [BLOCK_TYPES.AGREEMENT_DISCLAIMER]: 'תנאי התקשרות',
  [BLOCK_TYPES.SPACER]: 'רווח / מפריד'
};

export const BLOCK_DESCRIPTIONS = {
  [BLOCK_TYPES.FREE_TEXT]: 'תוכן חופשי בעורך עשיר',
  [BLOCK_TYPES.HEADING]: 'כותרת מובלטת',
  [BLOCK_TYPES.EVENT_DETAILS]: 'פרטי המשפחה והאירוע (מהאירוע המשויך)',
  [BLOCK_TYPES.INTRO_TEMPLATE]: 'בחירת פתיח לפי קונספט',
  [BLOCK_TYPES.SERVICES]: 'רשימת שירותים וחבילות (מהאירוע המשויך)',
  [BLOCK_TYPES.FINANCIAL_SUMMARY]: 'טבלת סיכום מחירים, מע"מ, הנחה ותשלומים',
  [BLOCK_TYPES.PAYMENT_TERMS]: 'תנאי תשלום (מתוך התבנית הקיימת)',
  [BLOCK_TYPES.AGREEMENT_DISCLAIMER]: 'תנאי התקשרות (מתוך התבנית הקיימת)',
  [BLOCK_TYPES.SPACER]: 'מרווח / קו מפריד'
};

export function createBlock(type) {
  const id = `block_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const base = { id, type };
  switch (type) {
    case BLOCK_TYPES.FREE_TEXT:
      return { ...base, content: '<p></p>' };
    case BLOCK_TYPES.HEADING:
      return { ...base, content: 'כותרת חדשה', options: { level: 2, align: 'center' } };
    case BLOCK_TYPES.EVENT_DETAILS:
      return { ...base, options: { showFamilyName: true, showChildName: true, showDate: true, showLocation: true, showCity: true, showGuestCount: true, showParents: true } };
    case BLOCK_TYPES.INTRO_TEMPLATE:
      return { ...base, options: { templateId: '', useEventConcept: true } };
    case BLOCK_TYPES.SERVICES:
      return { ...base, options: { showPrices: true, showDescriptions: true, showQuantities: true } };
    case BLOCK_TYPES.FINANCIAL_SUMMARY:
      return { ...base, options: { showVat: true, showPaid: true, showBalance: true, showDiscount: true } };
    case BLOCK_TYPES.PAYMENT_TERMS:
      return { ...base, options: { templateId: '' } };
    case BLOCK_TYPES.AGREEMENT_DISCLAIMER:
      return { ...base, options: { templateId: '' } };
    case BLOCK_TYPES.SPACER:
      return { ...base, options: { height: 20, showLine: false } };
    default:
      return { ...base, content: '' };
  }
}