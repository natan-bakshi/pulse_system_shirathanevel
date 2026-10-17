// הודעות אוטומטיות ללקוח בעקבות תשלום: אישור תשלום עם קישור לקבלה,
// ותזכורת לפני תפוגת דרישת תשלום שנשלחה בקישור. תומך בעברית ובאנגלית.
import { sendWhatsAppText } from "./whatsappSend.ts";
import {whatsappEnqueueReceiptState,isWhatsAppEnqueueConfirmed} from "./whatsappReceipt.ts";

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
export async function sendClientMessage(base44, { phone, email, subject, body, businessName, idempotencyKey='' }) {
  const channels: string[] = [];
  if (phone) {
    try {
      const receipt=await sendWhatsAppText(phone, body, base44, {
        sourceType:'client_billing',sourceId:idempotencyKey,idempotencyKey
      });
      const state=whatsappEnqueueReceiptState(receipt);
      // An old deduplicated job can be UNKNOWN/FAILED rather than queued.
      // Never suppress email because of a false WhatsApp success; also never
      // automatically email when the prior WhatsApp outcome is uncertain.
      if(['unknown','resolved','cancelled','expired'].includes(state)){
        throw Object.assign(new Error('WhatsApp outcome needs manual review'),{
          deliveryUncertain:true,queueStatus:state,jobId:receipt?.jobId||''
        });
      }
      const accepted=isWhatsAppEnqueueConfirmed(receipt);
      if(!accepted)throw new Error('WhatsApp outbox has no confirmed queue receipt');
      channels.push('whatsapp'); // Queued, not necessarily delivered.
    } catch (error) {
      if(error?.deliveryUncertain===true)throw error;
      console.warn('[clientBillingMessages] WhatsApp was not queued; evaluating email fallback');
    }
  }
  if (!channels.length && email) {
    await base44.asServiceRole.integrations.Core.SendEmail({ to: email, subject, body: body.replaceAll("\n", "<br>"), from_name: businessName });
    channels.push("email");
  }
  if(!channels.length)throw new Error('Neither WhatsApp nor email accepted the billing notification');
  return channels;
}