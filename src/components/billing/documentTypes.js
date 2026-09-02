// סוגי המסמכים הנתמכים בהנפקה ידנית עצמאית + התוויות המלאות לכל סוגי המסמכים.
// תעודת משלוח והזמנת רכש אינן נתמכות - אינן רלוונטיות לחברת הפקת אירועים.
export const STANDALONE_DOCUMENT_TYPES = [
  { value: 'invoice', label: 'חשבונית מס', needsItems: true, needsPayments: false },
  { value: 'invoice_receipt', label: 'חשבונית מס/קבלה', needsItems: true, needsPayments: true },
  { value: 'receipt', label: 'קבלה', needsItems: false, needsPayments: true },
  { value: 'proforma', label: 'חשבון עסקה', needsItems: true, needsPayments: false },
  { value: 'work_order', label: 'הזמנת עבודה', needsItems: true, needsPayments: false }
];

export const DOCUMENT_TYPE_LABELS = {
  invoice: 'חשבונית מס',
  receipt: 'קבלה',
  invoice_receipt: 'חשבונית מס/קבלה',
  invoice_credit: 'חשבונית זיכוי',
  proforma: 'חשבון עסקה',
  work_order: 'הזמנת עבודה',
  quote: 'הצעת מחיר',
  delivery_note: 'תעודת משלוח'
};

export const DOCUMENT_STATUS_LABELS = {
  open: 'פתוח',
  fully_credited: 'זוכה במלואו',
  partially_credited: 'זוכה חלקית',
  cancelled: 'מבוטל'
};

export const PAYMENT_METHOD_LABELS = {
  cash: 'מזומן',
  bank_transfer: 'העברה בנקאית',
  check: "צ'ק",
  credit_card: 'כרטיס אשראי'
};

export function getStandaloneType(value) {
  return STANDALONE_DOCUMENT_TYPES.find((type) => type.value === value) || STANDALONE_DOCUMENT_TYPES[0];
}