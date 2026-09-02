import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { invoice4uErrors, invoice4uRequest, invoice4uToken } from "../../shared/invoice4uClient.ts";
import { buildDocumentItems, calculateAdvanceAmount, calculateEventBalance, calculateProcessingFee, itemsToPipedFields } from "../../shared/eventBilling.ts";

const appUrl = "https://pulse-system.base44.app";

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const { eventId, amount, chargeType, payer } = await req.json();
    const settings = await base44.asServiceRole.entities.AppSettings.list();
    const config = Object.fromEntries(settings.map((item) => [item.setting_key, item.setting_value]));
    if (config.billing_enabled !== "true") return Response.json({ error: "מודול החיוב אינו פעיל" }, { status: 403 });
    const isAdmin = user.role === "admin";
    if (!isAdmin && !(user.user_type === "client" && config.client_clearing_allowed === "true")) return Response.json({ error: "אין הרשאה לפתוח בקשת תשלום" }, { status: 403 });
    const requestedAmount = Math.round(Number(amount) * 100) / 100;
    if (!eventId || !Number.isFinite(requestedAmount) || requestedAmount <= 0) return Response.json({ error: "חסרים פרטי תשלום תקינים" }, { status: 400 });
    if (!payer?.fullName || !payer?.phone) return Response.json({ error: "נדרשים שם מלא ומספר טלפון עבור הסליקה" }, { status: 400 });
    if (!config.invoice4u_clearing_company_type) return Response.json({ error: "יש להגדיר חברת סליקה בהגדרות התשלומים" }, { status: 400 });

    const event = await base44.entities.Event.get(eventId);
    if (!event) return Response.json({ error: "האירוע לא נמצא" }, { status: 404 });
    const [services, payments] = await Promise.all([
      base44.asServiceRole.entities.EventService.filter({ event_id: eventId }),
      base44.asServiceRole.entities.Payment.filter({ event_id: eventId })
    ]);
    const vatRate = (Number(config.vat_rate) || 18) / 100;
    const usdIlsRate = Number(config.usd_ils_exchange_rate) || 3.6;
    const financials = calculateEventBalance(event, services, payments, vatRate, usdIlsRate);

    // אימות סכום בשרת: לא ניתן לסלוק יותר מהיתרה לתשלום.
    if (financials.balance <= 0) return Response.json({ error: "אין יתרה לתשלום באירוע זה" }, { status: 400 });
    if (requestedAmount > financials.balance + 0.01) return Response.json({ error: `לא ניתן לסלוק יותר מהיתרה לתשלום (${financials.balance.toLocaleString()})` }, { status: 400 });
    const isAdvance = chargeType === "advance";
    if (isAdvance && financials.totalPaid > 0) return Response.json({ error: "מקדמה זמינה רק כאשר טרם התקבל תשלום באירוע" }, { status: 400 });

    const fee = calculateProcessingFee(config, requestedAmount);
    const chargeTotal = Math.round((requestedAmount + fee.amount) * 100) / 100;
    const isInterested = payer.isInterestedInInvoice !== false;
    const items = isAdvance
      ? [{ name: `מקדמה - ${event.event_name}`, quantity: 1, price: Math.round((requestedAmount / (1 + vatRate)) * 100) / 100 }, ...(fee.amount > 0 ? [{ name: fee.label, quantity: 1, price: Math.round((fee.amount / (1 + vatRate)) * 100) / 100 }] : [])]
      : buildDocumentItems({ event, services, amount: requestedAmount, fee, itemized: isAdmin && payer.itemized === true, financials, vatRate, usdIlsRate });

    const callbackToken = crypto.randomUUID();
    const payment = await base44.asServiceRole.entities.Payment.create({
      event_id: eventId,
      amount: requestedAmount,
      currency: financials.currency,
      payment_date: new Date().toISOString().slice(0, 10),
      payment_method: "credit_card",
      payment_status: "pending",
      clearing_method: "hosted_page",
      is_interested_in_invoice: isInterested,
      invoice4u_callback_token: callbackToken,
      notes: [isAdvance ? "מקדמה" : "", fee.amount > 0 ? `${fee.label}: ${fee.amount}` : ""].filter(Boolean).join(" | ")
    });

    const environment = config.invoice4u_env === "production" ? "production" : "qa";
    const request = {
      Invoice4UUserApiKey: invoice4uToken(environment),
      Sum: chargeTotal,
      Currency: financials.currency === "ILS" ? "NIS" : financials.currency,
      Type: 1,
      CreditCardCompanyType: Number(config.invoice4u_clearing_company_type),
      FullName: payer.fullName,
      Phone: payer.phone,
      // כשהסולק אינו מעוניין בחשבונית - המסמך עדיין מופק, אך נשלח לבעל החשבון בלבד.
      Email: isInterested ? (payer.email || "") : (config.owner_copy_email || ""),
      Description: isAdvance ? `מקדמה עבור ${event.event_name}` : `תשלום עבור ${event.event_name}`,
      OrderIdClientUsage: payment.id,
      IsDocCreate: true,
      IsManualDocCreationsWithParams: true,
      ...itemsToPipedFields(items, Number(config.vat_rate) || 18),
      DocHeadline: config.default_subject || `תשלום עבור ${event.event_name}`,
      DocComments: config.default_email_comment || "",
      DocBranchId: config.invoice4u_branch_id || undefined,
      Language: config.default_language || "he",
      ReturnUrl: `${appUrl}/EventDetails?id=${eventId}&payment=${payment.id}`,
      CallBackUrl: `${appUrl}/functions/invoice4uClearingCallback?token=${callbackToken}`,
      IsQaMode: environment === "qa",
      Platform: "Pulse"
    };
    const response = await invoice4uRequest(environment, "ProcessApiRequestV2", { request });
    const result = response.ProcessApiRequestV2Result || response;
    const errorMessage = invoice4uErrors(result);
    if (errorMessage || !result.ClearingRedirectUrl) {
      await base44.asServiceRole.entities.Payment.update(payment.id, { payment_status: "failed", invoice4u_clearing_status: errorMessage || "לא התקבל קישור לתשלום" });
      return Response.json({ error: errorMessage || "לא התקבל קישור לתשלום" }, { status: 400 });
    }
    return Response.json({ paymentId: payment.id, redirectUrl: result.ClearingRedirectUrl, chargedTotal: chargeTotal, fee: fee.amount });
  } catch (error) { return Response.json({ error: error.message }, { status: 500 }); }
}