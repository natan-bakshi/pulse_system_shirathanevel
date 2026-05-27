import { BLOCK_TYPES, createBlock } from './blockTypes';

/**
 * בונה רשימת בלוקים שתואמת למבנה של "הצעת מחיר רגילה",
 * כך שניתן לטעון אירוע קיים לתוך עורך ההצעה הידנית כנקודת התחלה
 * ולערוך/להוסיף קטעי טקסט חופשיים בין המקטעים.
 *
 * הסדר זהה ל-generateQuotePdf:
 * 1. פרטי האירוע
 * 2. פתיח (לפי קונספט)
 * 3. שירותים / חבילות
 * 4. סיכום כספי
 * 5. תנאי תשלום
 * 6. תנאי התקשרות
 */
export function buildBlocksFromEvent() {
  return [
    createBlock(BLOCK_TYPES.EVENT_DETAILS),
    createBlock(BLOCK_TYPES.INTRO_TEMPLATE),
    createBlock(BLOCK_TYPES.SERVICES),
    createBlock(BLOCK_TYPES.FINANCIAL_SUMMARY),
    createBlock(BLOCK_TYPES.SCHEDULE),
    createBlock(BLOCK_TYPES.PAYMENT_TERMS),
    createBlock(BLOCK_TYPES.AGREEMENT_DISCLAIMER),
  ];
}