// הודעות אוטומטיות ללקוח בעקבות תשלום: אישור תשלום עם קישור לקבלה,
// ותזכורת לפני תפוגת דרישת תשלום שנשלחה בקישור. תומך בעברית ובאנגלית.
import { sendWhatsAppText } from "./whatsappSend.ts";
import {whatsappEnqueueReceiptState,isWhatsAppEnqueueConfirmed} from "./whatsappReceipt.ts";
import {customerMessageTemplate,formatCustomerMessage} from './customerMessageTone.ts';

const settingKeys = {
  receipt: { he: "payment_receipt_message_template", en: "payment_receipt_message_template_en" },
  reminder: { he: "payment_link_reminder_template", en: "payment_link_reminder_template_en" }
};

export function renderClientMessage(config, kind: "receipt" | "reminder", language: string, values: Record<string, string>) {
  const lang = language === "en" ? "en" : "he";
  const configured = String(config[settingKeys[kind][lang]] || "").trim();
  return formatCustomerMessage(customerMessageTemplate(kind,lang,configured),values);
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
      // An Outbox write/lookup/control failure may have committed even when
      // its SDK response was lost. Do not send a second notification by email
      // until a human verifies whether the WhatsApp request exists.
      if(error?.deliveryUncertain===true)throw error;
      if(['outbox_create','dedupe_lookup','control_read','lock_acquire'].includes(String(error?.queuePhase||''))){
        throw Object.assign(new Error('WhatsApp enqueue outcome needs manual review'),{
          deliveryUncertain:true,queuePhase:String(error?.queuePhase||'unverified')
        });
      }
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