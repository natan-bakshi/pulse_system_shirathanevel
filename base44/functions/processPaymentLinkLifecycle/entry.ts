import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { renderClientMessage, sendClientMessage } from "../../shared/clientBillingMessages.ts";

// מריצה יומית על דרישות תשלום בקישור שטרם שולמו:
// 1. שולחת תזכורת ללקוח כמה ימים לפני תפוגת הקישור.
// 2. מבטלת אוטומטית דרישות שפג תוקפן, כדי שלא יצטברו תשלומים "ממתינים" לנצח.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const settings = await base44.asServiceRole.entities.AppSettings.list();
    const config = Object.fromEntries(settings.map((item) => [item.setting_key, item.setting_value]));
    if (config.billing_enabled !== "true") return Response.json({ skipped: "billing disabled" });

    const pending = await base44.asServiceRole.entities.Payment.filter({ payment_status: "pending", is_payment_link: true });
    const businessName = config.business_name || config.company_name || "המערכת";
    const reminderDays = Number(config.payment_link_reminder_days) || 0;
    const now = Date.now();
    const result = { checked: pending.length, reminded: 0, expired: 0 };

    for (const payment of pending) {
      if (!payment.link_expires_at) continue;
      const expiresAt = new Date(payment.link_expires_at).getTime();
      const language = payment.document_language === "en" ? "en" : "he";
      const currencySymbol = payment.currency === "USD" ? "$" : "₪";
      const amountText = `${currencySymbol}${Number(payment.amount || 0).toLocaleString()}`;

      if (now >= expiresAt) {
        await base44.asServiceRole.entities.Payment.update(payment.id, {
          payment_status: "cancelled",
          invoice4u_clearing_status: language === "en" ? "Payment link expired" : "קישור התשלום פג תוקף"
        });
        result.expired += 1;
        continue;
      }

      const reminderDue = reminderDays > 0 && now >= expiresAt - reminderDays * 86400000;
      if (!reminderDue || payment.link_reminder_sent || !payment.payment_link_url) continue;

      const body = renderClientMessage(config, "reminder", language, {
        name: payment.payer_name || "",
        business_name: businessName,
        amount: amountText,
        expiry_date: new Date(payment.link_expires_at).toLocaleDateString(language === "en" ? "en-GB" : "he-IL"),
        link: payment.payment_link_url
      });
      try {
        await sendClientMessage(base44, {
          phone: payment.payer_phone,
          email: payment.payer_email,
          subject: language === "en" ? `Payment reminder - ${businessName}` : `תזכורת לתשלום - ${businessName}`,
          body,
          businessName
        });
        await base44.asServiceRole.entities.Payment.update(payment.id, { link_reminder_sent: true });
        result.reminded += 1;
      } catch (error) {
        console.warn(`[paymentLinkLifecycle] reminder failed for ${payment.id}: ${error.message}`);
      }
    }

    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}