// התראות מנהל על סליקות אשראי - עובד מול תבנית ההתראות של המערכת
// (NotificationTemplate) ויוצר InAppNotification לכל מנהל רלוונטי.

const appUrl = "https://pulse-system.base44.app";

function replacePlaceholders(template, data) {
  if (!template) return "";
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = data[key];
    return value !== undefined && value !== null ? String(value) : match;
  });
}

function formatAmount(amount, currency) {
  const symbol = currency === "USD" ? "$" : "₪";
  return `${symbol}${new Intl.NumberFormat("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(amount) || 0)}`;
}

// שולח התראה לכל המנהלים (או לנמענים שהוגדרו בתבנית) על תוצאת סליקה.
export async function notifyAdminsClearingResult(base44, { templateType, event, payment, extra = {} }) {
  const templates = await base44.asServiceRole.entities.NotificationTemplate.filter({ type: templateType, is_active: true });
  const template = templates[0];
  if (!template) return { sent: 0, reason: "template_inactive" };

  const admins = await base44.asServiceRole.entities.User.filter({ role: "admin" });
  const allowedIds = Array.isArray(template.admin_recipient_ids) ? template.admin_recipient_ids.filter(Boolean) : [];
  const recipients = allowedIds.length ? admins.filter((admin) => allowedIds.includes(admin.id)) : admins;
  if (!recipients.length) return { sent: 0, reason: "no_recipients" };

  const context = {
    event_name: event?.event_name || "",
    family_name: event?.family_name || "",
    event_date: event?.event_date ? new Date(event.event_date).toLocaleDateString("he-IL") : "",
    amount: formatAmount(payment?.amount, payment?.currency),
    payer_name: payment?.customer_name_on_card || "",
    document_number: payment?.invoice4u_document_number || "",
    event_id: event?.id || "",
    ...extra
  };

  const title = replacePlaceholders(template.title_template, context);
  const message = replacePlaceholders(template.body_template, context);
  const link = event?.id ? `${appUrl}/EventDetails?id=${event.id}` : appUrl;

  let sent = 0;
  for (const admin of recipients) {
    try {
      await base44.asServiceRole.entities.InAppNotification.create({
        user_id: admin.id,
        user_email: admin.email,
        title,
        message,
        link,
        is_read: false,
        template_type: templateType,
        related_event_id: event?.id || "",
        push_sent: false,
        reminder_count: 0,
        is_resolved: true
      });
      sent += 1;
    } catch (error) {
      console.warn(`[ClearingNotify] failed for ${admin.email}: ${error.message}`);
    }
  }
  return { sent };
}