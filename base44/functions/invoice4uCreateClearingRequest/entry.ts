import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { secrets } from "base44:runtime";
import { invoice4uErrors, invoice4uRequest } from "../../shared/invoice4uClient.ts";

const appUrl = "https://pulse-system.base44.app";

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const { eventId, amount, payer } = await req.json();
    const settings = await base44.asServiceRole.entities.AppSettings.list();
    const config = Object.fromEntries(settings.map((item) => [item.setting_key, item.setting_value]));
    if (config.billing_enabled !== "true") return Response.json({ error: "מודול החיוב אינו פעיל" }, { status: 403 });
    if (user.role !== "admin" && !(user.user_type === "client" && config.client_clearing_allowed === "true")) return Response.json({ error: "אין הרשאה לפתוח בקשת תשלום" }, { status: 403 });
    const numericAmount = Number(amount);
    if (!eventId || !Number.isFinite(numericAmount) || numericAmount <= 0) return Response.json({ error: "חסרים פרטי תשלום תקינים" }, { status: 400 });
    if (!payer?.fullName || !payer?.phone) return Response.json({ error: "נדרשים שם מלא ומספר טלפון עבור הסליקה" }, { status: 400 });
    const event = await base44.entities.Event.get(eventId);
    if (!event) return Response.json({ error: "האירוע לא נמצא" }, { status: 404 });
    if (!config.invoice4u_clearing_company_type) return Response.json({ error: "יש להגדיר חברת סליקה בהגדרות התשלומים" }, { status: 400 });
    const callbackToken = crypto.randomUUID();
    const payment = await base44.asServiceRole.entities.Payment.create({ event_id: eventId, amount: numericAmount, currency: event.primary_currency || "ILS", payment_date: new Date().toISOString().slice(0, 10), payment_method: "credit_card", payment_status: "pending", clearing_method: "hosted_page", is_interested_in_invoice: payer.isInterestedInInvoice !== false, invoice4u_callback_token: callbackToken });
    const environment = config.invoice4u_env === "production" ? "production" : "qa";
    const request = { Invoice4UUserApiKey: secrets.get("INVOICE4U_API_TOKEN"), Sum: numericAmount, Currency: payment.currency === "ILS" ? "NIS" : payment.currency, Type: 1, CreditCardCompanyType: Number(config.invoice4u_clearing_company_type), FullName: payer.fullName, Phone: payer.phone, Email: payer.email || "", Description: `תשלום עבור ${event.event_name}`, OrderIdClientUsage: payment.id, IsDocCreate: payer.isInterestedInInvoice !== false, DocHeadline: config.default_subject || `תשלום עבור ${event.event_name}`, DocComments: config.default_email_comment || "", DocBranchId: config.invoice4u_branch_id || undefined, Language: config.default_language || "he", ReturnUrl: `${appUrl}/EventDetails?id=${eventId}&payment=${payment.id}`, CallBackUrl: `${appUrl}/functions/invoice4uClearingCallback?token=${callbackToken}`, IsQaMode: environment === "qa", Platform: "Pulse" };
    const response = await invoice4uRequest(environment, "ProcessApiRequestV2", { request });
    const result = response.ProcessApiRequestV2Result || response;
    const errorMessage = invoice4uErrors(result);
    if (errorMessage || !result.ClearingRedirectUrl) { await base44.asServiceRole.entities.Payment.update(payment.id, { payment_status: "failed", invoice4u_clearing_status: errorMessage || "לא התקבל קישור לתשלום" }); return Response.json({ error: errorMessage || "לא התקבל קישור לתשלום" }, { status: 400 }); }
    return Response.json({ paymentId: payment.id, redirectUrl: result.ClearingRedirectUrl });
  } catch (error) { return Response.json({ error: error.message }, { status: 500 }); }
}