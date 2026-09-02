// הודעות אוטומטיות ללקוח בעקבות תשלום: אישור תשלום עם קישור לקבלה,
// ותזכורת לפני תפוגת דרישת תשלום שנשלחה בקישור. תומך בעברית ובאנגלית.
import { sendWhatsAppText } from "./whatsappSend.ts";

const defaults = {
  receipt: {
    he: "שלום {{name}},\nהתשלום בסך {{amount}} התקבל בהצלחה. תודה!\n\nהמסמך שלך:\n{{document_url}}",
    en: "Hello {{name}},\nYour payment of {{amount}} was received successfully. Thank you!\n\nYour document:\n{{document_url}}"
  },
  reminder: {
    he: "שלום {{name}},\nדרישת התשלום בסך {{amount}} מ{{business_name}} עדיין ממתינה לתשלום ותפוג ב-{{expiry_date}}.\n\nלתשלום מאובטח:\n{{link}}",
    en: "Hello {{name}},\nYour payment request of {{amount}} from {{business_name}} is still pending and expires on {{expiry_date}}.\n\nPay securely:\n{{link}}"
  }
};

const settingKeys = {
  receipt: { he: "payment_receipt_message_template", en: "payment_receipt_message_template_en" },
  reminder: { he: "payment_link_reminder_template", en: "payment_link_reminder_template_en" }
};

export function renderClientMessage(config, kind: "receipt" | "reminder", language: string, values: Record<string, string>) {
  const lang = language === "en" ? "en" : "he";
  const configured = String(config[settingKeys[kind][lang]] || "").trim();
  const template = configured || defaults[kind][lang];
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value ?? "")), template);
}

// שולח בוואטסאפ, ואם אין טלפון או שהשליחה נכשלה - נסיגה לאימייל.
export async function sendClientMessage(base44, { phone, email, subject, body, businessName }) {
  const channels: string[] = [];
  if (phone) {
    try {
      await sendWhatsAppText(phone, body);
      channels.push("whatsapp");
    } catch (error) {
      console.warn(`[clientBillingMessages] whatsapp failed: ${error.message}`);
    }
  }
  if (!channels.length && email) {
    await base44.asServiceRole.integrations.Core.SendEmail({ to: email, subject, body: body.replaceAll("\n", "<br>"), from_name: businessName });
    channels.push("email");
  }
  return channels;
}