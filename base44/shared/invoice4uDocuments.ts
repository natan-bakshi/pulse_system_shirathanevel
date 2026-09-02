// תשתית משותפת לבניית מסמכי Invoice4U - משמשת גם הפקה ידנית על תשלום קיים
// וגם הפקה עצמאית מלשונית התשלומים. מונע כפילות לוגיקה בין הפונקציות.

// קודי סוגי המסמכים ב-Invoice4U (DocumentType) מול המזהים הפנימיים במערכת.
export const documentTypeCodes: Record<string, number> = {
  invoice: 1,
  receipt: 2,
  invoice_receipt: 3,
  invoice_credit: 4,
  proforma: 5,
  work_order: 6
};

export const documentTypeLabels: Record<string, string> = {
  invoice: "חשבונית מס",
  receipt: "קבלה",
  invoice_receipt: "חשבונית מס/קבלה",
  invoice_credit: "חשבונית זיכוי",
  proforma: "חשבון עסקה",
  work_order: "הזמנת עבודה"
};

// סוגי המסמכים שניתן להנפיק ידנית באופן עצמאי מתוך המערכת.
export const standaloneDocumentTypes = ["invoice", "receipt", "invoice_receipt", "proforma", "work_order"];

// סוגי תשלום ב-Invoice4U: מזומן, צ'ק, אשראי, העברה בנקאית.
export const paymentTypeCodes: Record<string, number> = { cash: 1, check: 2, credit_card: 3, bank_transfer: 4 };

export const round2 = (value: number) => Math.round(Number(value) * 100) / 100;

// Invoice4U מצפה לתאריכים בפורמט WCF: /Date(מילישניות)/
export const wcfDate = (value: string) => `/Date(${new Date(value || Date.now()).getTime()})/`;

// אילו רכיבים נדרשים לכל סוג מסמך לפי תיעוד Invoice4U.
export function documentRequirements(slug: string) {
  return {
    needsItems: ["invoice", "invoice_receipt", "proforma", "work_order"].includes(slug),
    needsPayments: ["receipt", "invoice_receipt"].includes(slug),
    // קבלה חייבת להיות מקושרת ללקוח קיים ולא ל"לקוח מזדמן".
    needsRegisteredCustomer: slug === "receipt"
  };
}

// בונה את גוף ה-doc עבור CreateDocument לפי סוג המסמך והנתונים שהוזנו.
export function buildDocumentBody({ slug, subject, currency = "ILS", items = [], payments = [], customer = {}, clientId = null, comments = "", associatedEmails = [], vatPercent = 18 }) {
  const requirements = documentRequirements(slug);
  const doc: Record<string, unknown> = {
    DocumentType: documentTypeCodes[slug],
    Subject: subject,
    Currency: currency
  };

  if (requirements.needsItems) {
    doc.Items = items.map((item) => ({
      Name: item.name,
      Quantity: Number(item.quantity) || 1,
      Price: round2(item.price),
      TaxRate: item.taxRate === undefined || item.taxRate === null || item.taxRate === "" ? vatPercent : Number(item.taxRate)
    }));
  }

  if (requirements.needsPayments) {
    doc.Payments = payments.map((payment) => ({
      Amount: round2(payment.amount),
      PaymentType: paymentTypeCodes[payment.type] ?? 1,
      Date: wcfDate(payment.date)
    }));
  }

  if (requirements.needsRegisteredCustomer) {
    doc.ClientID = clientId;
    doc.TaxIncluded = true;
  } else {
    doc.GeneralCustomer = {
      Name: customer.name || "לקוח",
      Email: customer.email || "",
      Phone: customer.phone || "",
      Identifier: customer.identifier || "",
      Address: customer.address || ""
    };
  }

  if (comments) doc.DocComments = comments;
  const emails = associatedEmails.filter(Boolean);
  if (emails.length) doc.AssociatedEmails = emails.map((email) => ({ Mail: email }));

  return doc;
}

// סיכומי המסמך לפי השורות שהוזנו - לשמירה מקומית כשה-API לא מחזיר סיכום.
export function summarizeItems(items = [], vatPercent = 18) {
  const withoutTax = items.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 1), 0);
  const rate = (Number(vatPercent) || 0) / 100;
  const tax = withoutTax * rate;
  return { totalWithoutTax: round2(withoutTax), totalTax: round2(tax), total: round2(withoutTax + tax) };
}