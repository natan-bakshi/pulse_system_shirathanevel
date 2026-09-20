import { createClientFromRequest } from "npm:@base44/sdk@0.8.48";
import { readAll } from "../../shared/eventReadiness.ts";
import { CardError, money, cardSettings, requireCards, claimCustomer, releaseCustomer, safeCard, eventBalance, removeCard, customerEligibility, applyCleanup } from "../../shared/storedCards.ts";
import { cardAppUrl, providerAccess, providerCall, hasErrors, providerFailure, sha256, isTrue, verifyLog } from "../../shared/storedCardProvider.ts";
import { calculateProcessingFee, buildDocumentItems, itemsToPipedFields } from "../../shared/eventBilling.ts";

const safeCustomer = c => c ? { id: c.id, name: c.name, email: c.email || "", phone: c.phone || "", active_card_id: c.active_card_id || "", busy: !!c.busy_operation_id } : null;
const safeOperation = o => ({ id: o.id, state: o.state, amount: o.amount, total: o.total, currency: o.currency, paymentId: o.payment_id, message: o.state === "unknown" ? "תוצאת החיוב בבירור. אין לבצע חיוב נוסף." : undefined });
const text = (v, max = 200) => typeof v === "string" ? v.trim().slice(0, max) : "";
async function activeCard(client, customer, config, expectedId) {
  if (!customer.active_card_id || (expectedId && expectedId !== customer.active_card_id)) throw new CardError("אין כרטיס פעיל או שהכרטיס הוחלף", 409);
  const card = await client.entities.StoredCard.get(customer.active_card_id);
  if (card.customer_id !== customer.id || card.state !== "active" || !card.provider_customer_id || card.environment !== (config.stored_cards_env === "production" ? "production" : "qa"))
    throw new CardError("הכרטיס אינו זמין בסביבת הסליקה הנוכחית", 409);
  return card;
}
async function finishCharge(client, operation, customer, config) {
  const access = providerAccess(config, operation.environment);
  await verifyLog(access, { paymentId: operation.provider_payment_id, traceId: operation.provider_trace_id,
    type: 3, amount: operation.total, currency: operation.currency }, operation.created_date);
  let payment = await client.entities.Payment.get(operation.payment_id);
  // Operation stays locked until ALL local writes finish; retry only completes local accounting.
  if (operation.provider_document_id && !payment.financial_document_id) {
    const found = await client.entities.FinancialDocument.filter({ linked_payment_id: payment.id }, "id", 2);
    if (found.length > 1) throw new CardError("נדרש בירור מסמכים לעסקה", 409);
    const chargedCard = await client.entities.StoredCard.get(operation.card_id);
    const doc = found[0] || await client.entities.FinancialDocument.create({
      document_type: "invoice_receipt", document_number: operation.provider_document_number || "",
      invoice4u_id: operation.provider_document_id, status: "open", total: operation.total,
      currency: operation.currency, issue_date: new Date().toISOString(), linked_event_id: operation.event_id,
      linked_payment_id: payment.id, customer_name: customer.name,
      customer_identifier: String(chargedCard.provider_customer_id || ""),
      cipher_text: operation.provider_cipher || "",
      pdf_original_url: operation.provider_cipher_original ? "https://newview.invoice4u.co.il/Views/PDF.aspx?cipher=" + encodeURIComponent(operation.provider_cipher_original) : ""
    });
    payment = await client.entities.Payment.update(payment.id, { financial_document_id: doc.id });
  }
  await client.entities.Payment.update(payment.id, { payment_status: "completed", invoice4u_clearing_status: "approved",
    invoice4u_payment_id: operation.provider_payment_id, invoice4u_document_number: operation.provider_document_number || "",
    auth_number: operation.provider_auth_number || "" });
  await client.entities.StoredCardOperation.update(operation.id, { state: "completed" });
  await releaseCustomer(client, customer.id, operation.id);
  try { await applyCleanup(client, customer.id, config); } catch { console.warn("[stored-cards] cleanup pending"); }
  return safeOperation({ ...operation, state: "completed" });
}
// Idempotent local completion: no capture/charge is retried by this routine.
async function completeSetup(client, setup, card, suffix, brand = "", expires = "") {
  const customer = await client.entities.BillingCustomer.get(setup.customer_id);
  const owner = "setup:" + setup.id;
  if (customer.active_card_id !== card.id) {
    if (customer.busy_operation_id !== owner) throw new CardError("בקשת השמירה אינה פעילה עוד", 409);
    await client.entities.StoredCard.update(card.id, { state: "active", card_suffix: suffix, brand, expires });
    const switched = await client.entities.BillingCustomer.updateMany(
      { id: customer.id, busy_operation_id: owner, active_card_id: customer.active_card_id || "" },
      { $set: { active_card_id: card.id, busy_operation_id: "" } }
    );
    if (switched.updated !== 1) {
      const latest = await client.entities.BillingCustomer.get(customer.id);
      if (latest.active_card_id !== card.id) throw new CardError("מצב הכרטיס השתנה", 409);
    }
  }
  await client.entities.CardSetupRequest.update(setup.id, { state: "verified", redirect_url: "" });
  // Only scrub the old generation after the authoritative pointer has switched successfully.
  if (customer.active_card_id && customer.active_card_id !== card.id) {
    await client.entities.StoredCard.update(customer.active_card_id, {
      state: "removed", provider_customer_id: "", card_suffix: "", brand: "", expires: "", cleanup_pending: false,
      removed_at: new Date().toISOString(), removed_by: "replacement", removal_reason: "replaced"
    });
  }
  return { received: true };
}

async function callback(req, base44) {
  const client = base44.asServiceRole;
  const url = new URL(req.url);
  const id = url.searchParams.get("setup");
  const secret = url.searchParams.get("token");
  if (!id || !secret || secret.length > 100) throw new CardError("Invalid callback", 403);
  const setup = await client.entities.CardSetupRequest.get(id);
  if (!setup || !setup.callback_hash || await sha256(secret) !== setup.callback_hash) throw new CardError("Invalid callback", 403);
  if (setup.state === "verified" || setup.state === "cancelled") return { received: true };
  if (setup.state !== "pending" || new Date(setup.expires_at).getTime() <= Date.now()) throw new CardError("Setup expired", 409);
  if (Number(req.headers.get("content-length")) > 24000) throw new CardError("Invalid callback", 413);
  let outer;
  if (req.headers.get("content-type")?.includes("multipart/form-data")) outer = Object.fromEntries(await req.formData());
  else {
    const raw = await req.text();
    if (raw.length > 24000) throw new CardError("Invalid callback", 413);
    outer = req.headers.get("content-type")?.includes("json") ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
  }
  const data = typeof outer.Data === "string" ? JSON.parse(outer.Data) : (outer.Data || outer);
  if (String(data.OrderIdClientUsage) !== id || String(data.CustomerId) !== setup.provider_customer_id ||
      !isTrue(data.Success) || !isTrue(data.TokenCaptureOnly) || isTrue(data.TokenCaptureAndCharge))
    throw new CardError("Callback does not match card setup", 409);
  const config = await cardSettings(client);
  requireCards(config);
  const card = await client.entities.StoredCard.get(setup.card_id);
  const access = providerAccess(config, card.environment);
  const log = await verifyLog(access, { paymentId: data.PaymentId, traceId: data.ClearingTraceId, type: 1, amount: 0 }, setup.created_date);
  const suffix = String(data.CardSuffix || "");
  if (!/^\d{4}$/.test(suffix) || (log.CreditNumber && String(log.CreditNumber).slice(-4) !== suffix)) throw new CardError("Card identity not verified", 409);
  const customer = await client.entities.BillingCustomer.get(setup.customer_id);
  if (customer.active_card_id === card.id && !customer.busy_operation_id) {
    await client.entities.CardSetupRequest.update(setup.id, { state: "verified", redirect_url: "" });
    return { received: true };
  }
  if (customer.busy_operation_id !== "setup:" + setup.id) return { received: true };
  const accepted = await client.entities.CardSetupRequest.updateMany({ id, state: "pending" }, { $set: { state: "verifying",
    provider_payment_id: String(data.PaymentId || ""), provider_trace_id: String(data.ClearingTraceId || "") } });
  if (accepted.updated !== 1) throw new CardError("Setup confirmation in progress", 409);
  try {
    await completeSetup(client, setup, card, suffix, text(data.CardBrandName, 30), text(data.CardExpirationDate, 4));
  } catch (e) {
    await client.entities.CardSetupRequest.updateMany({ id, state: "verifying" }, { $set: { state: "pending" } });
    throw e;
  }
  return { received: true };
}
export default Deno.serve(async req => {
  try {
    if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
    const base44 = createClientFromRequest(req);
    if (new URL(req.url).searchParams.has("setup")) return Response.json(await callback(req, base44));
    let user;
    try { user = await base44.auth.me(); } catch { return Response.json({ error: "נדרשת התחברות" }, { status: 401 }); }
    if (user?.role !== "admin") return Response.json({ error: "נדרשת הרשאת מנהל" }, { status: 403 });
    const body = await req.json();
    const client = base44.asServiceRole;
    const config = await cardSettings(client);
    requireCards(config);
    const action = body.action;
    if (action === "list") {
      const skip = Math.max(0, Math.floor(Number(body.skip) || 0));
      const customers = await client.entities.BillingCustomer.filter({}, "name", 20, skip);
      const rows = [];
      for (const c of customers) {
        const card = c.active_card_id ? await client.entities.StoredCard.get(c.active_card_id) : null;
        const eligibility = card ? await customerEligibility(client, c.id, config) : { eligible: false, reason: "אין כרטיס שמור" };
        rows.push({ customer: safeCustomer(c), card: safeCard(card), eligible: !c.busy_operation_id && eligibility.eligible, reason: c.busy_operation_id ? "פעולה בטיפול" : eligibility.reason });
      }
      return Response.json({ rows, hasMore: customers.length === 20 });
    }
    if (action === "customers") {
      const skip = Math.max(0, Math.floor(Number(body.skip) || 0));
      const rows = await client.entities.BillingCustomer.filter({}, "name", 50, skip);
      return Response.json({ customers: rows.map(safeCustomer), hasMore: rows.length === 50 });
    }
    if (action === "create_customer") {
      const name = text(body.name), phone = text(body.phone, 30), email = text(body.email, 254);
      if (!name || !phone || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new CardError("נדרשים שם, טלפון ואימייל תקין אם הוזן");
      const c = await client.entities.BillingCustomer.create({ name, phone, email, identifier: text(body.identifier, 30), revision: 0, busy_operation_id: "", active_card_id: "" });
      return Response.json({ customer: safeCustomer(c) });
    }
    if (action === "bulk_remove") {
      if (!Array.isArray(body.items) || body.items.length > 20) throw new CardError("ניתן להסיר עד 20 כרטיסים בכל מנה");
      const results = [];
      for (const item of body.items) {
        try { await removeCard(client, item.customerId, item.cardId, user.id, config, true); results.push({ customerId: item.customerId, status: "removed" }); }
        catch (e) { results.push({ customerId: item.customerId, status: e.status === 409 ? "skipped" : "error", reason: e instanceof CardError ? e.message : "הפעולה לא הושלמה" }); }
      }
      return Response.json({ results });
    }
    const event = body.eventId ? await client.entities.Event.get(body.eventId) : null;
    const customerId = body.customerId || event?.billing_customer_id;
    if (action === "status" && !customerId) return Response.json({ customer: null, card: null });
    if (!customerId) throw new CardError("יש לבחור לקוח משלם");
    const customer = await client.entities.BillingCustomer.get(customerId);
    if (!customer) throw new CardError("הלקוח לא נמצא", 404);
    if (event && action !== "bind" && event.billing_customer_id !== customer.id) throw new CardError("שיוך הלקוח באירוע השתנה", 409);
    if (action === "bind") {
      if (!event) throw new CardError("חסר אירוע");
      const owner = "bind:" + crypto.randomUUID();
      // Lock both parties in a fixed order; reassignment cannot race a charge for the old payer.
      const ids = [...new Set([customer.id, event.billing_customer_id].filter(Boolean))].sort();
      const locked = [];
      try {
        for (const id of ids) {
          const current = await client.entities.BillingCustomer.get(id);
          await claimCustomer(client, current, owner); locked.push(id);
        }
        const saved = await client.entities.Event.updateMany(
          { id: event.id, updated_date: event.updated_date },
          { $set: { billing_customer_id: customer.id } }
        );
        if (saved.updated !== 1) throw new CardError("פרטי האירוע השתנו; יש לרענן", 409);
      } finally {
        for (const id of locked.reverse()) await releaseCustomer(client, id, owner);
      }
      if (event.billing_customer_id && event.billing_customer_id !== customer.id) await applyCleanup(client, event.billing_customer_id, config);
      await applyCleanup(client, customer.id, config);
      return Response.json({ success: true });
    }
    if (action === "status") {
      const card = customer.active_card_id ? await client.entities.StoredCard.get(customer.active_card_id) : null;
      let pending = null;
      if (customer.busy_operation_id?.startsWith("setup:")) {
        const s = await client.entities.CardSetupRequest.get(customer.busy_operation_id.slice(6));
        pending = { kind: "setup", id: s.id, state: s.state, canRecover: !!s.provider_payment_id, expiresAt: s.expires_at, url: s.state === "pending" ? s.redirect_url : "" };
      } else if (customer.busy_operation_id && !customer.busy_operation_id.includes(":")) {
        const operation = await client.entities.StoredCardOperation.get(customer.busy_operation_id);
        pending = { kind: "charge", ...safeOperation(operation) };
      }
      return Response.json({ customer: safeCustomer(customer), card: safeCard(card), pending });
    }
    if (action === "evaluate") { await applyCleanup(client, customer.id, config); return Response.json({ success: true }); }
    if (action === "remove") return Response.json(await removeCard(client, customer.id, body.cardId, user.id, config, body.eligibleOnly === true));
    if (action === "recover_setup") {
      if (!customer.busy_operation_id?.startsWith("setup:")) throw new CardError("אין בקשת שמירה בטיפול");
      const setup = await client.entities.CardSetupRequest.get(customer.busy_operation_id.slice(6));
      if (!["pending", "verifying"].includes(setup.state) || !setup.provider_payment_id) throw new CardError("טרם התקבל אישור ספק שניתן לאמת", 409);
      const card = await client.entities.StoredCard.get(setup.card_id);
      if (card.customer_id !== customer.id) throw new CardError("שיוך כרטיס לא תקין", 409);
      const log = await verifyLog(providerAccess(config, card.environment), {
        paymentId: setup.provider_payment_id, traceId: setup.provider_trace_id, type: 1, amount: 0
      }, setup.created_date);
      const suffix = String(log.CreditNumber || "").slice(-4);
      if (!/^\d{4}$/.test(suffix)) throw new CardError("לא ניתן לאמת את הכרטיס מול הספק", 409);
      const claim = await client.entities.CardSetupRequest.updateMany(
        { id: setup.id, state: setup.state }, { $set: { state: "verifying" } }
      );
      if (claim.updated !== 1) throw new CardError("מצב הבקשה השתנה; יש לרענן", 409);
      return Response.json(await completeSetup(client, setup, card, suffix, card.brand || "", card.expires || ""));
    }
    if (action === "cancel_setup") {
      if (!customer.busy_operation_id?.startsWith("setup:")) throw new CardError("אין בקשת שמירה פתוחה");
      const id = customer.busy_operation_id.slice(6);
      const setup = await client.entities.CardSetupRequest.get(id);
      if (customer.active_card_id === setup.card_id || ["verified", "verifying"].includes(setup.state)) throw new CardError("השמירה אומתה או בטיפול; יש לרענן", 409);
      const cancelled = await client.entities.CardSetupRequest.updateMany({ id, state: setup.state }, { $set: { state: "cancelled", callback_hash: "", redirect_url: "" } });
      if (cancelled.updated !== 1) throw new CardError("מצב השמירה השתנה", 409);
      await client.entities.StoredCard.update(setup.card_id, { state: "cancelled", provider_customer_id: "" });
      await releaseCustomer(client, customer.id, customer.busy_operation_id);
      return Response.json({ success: true });
    }
    if (action === "setup") {
      if (body.consentConfirmed !== true || !text(body.consentReference, 500)) throw new CardError("נדרש תיעוד הסכמת הלקוח לשמירה ולחיוב עתידי");
      const access = providerAccess(config);
      if (customer.busy_operation_id) throw new CardError("קיימת פעולה בטיפול", 409);
      if (customer.active_card_id) {
        const previous = await client.entities.StoredCard.get(customer.active_card_id);
        if (previous.environment !== access.environment) throw new CardError("יש להסיר את הכרטיס מהסביבה הקודמת לפני שמירת כרטיס בסביבה אחרת");
      }
      const card = await client.entities.StoredCard.create({ customer_id: customer.id, environment: access.environment, state: "pending",
        consent_reference: text(body.consentReference, 500), consent_recorded_by: user.id, consent_recorded_at: new Date().toISOString(), cleanup_pending: false, cleanup_notified: false });
      const secret = crypto.randomUUID() + crypto.randomUUID();
      const setup = await client.entities.CardSetupRequest.create({ customer_id: customer.id, card_id: card.id, state: "creating", environment: access.environment,
        callback_hash: await sha256(secret), expires_at: new Date(Date.now() + 86400000).toISOString(), created_by_user_id: user.id });
      await claimCustomer(client, customer, "setup:" + setup.id);
      try {
        // A fresh provider customer per generation isolates old hosted links from the active card.
        const created = await providerCall(access, "CreateCustomer", { token: access.key,
          cu: { Name: customer.name, Active: true, Email: customer.email || "", Mobile: customer.phone || "", Identifier: customer.identifier || "" } });
        if (hasErrors(created) || !created.ID) throw new CardError("לא ניתן ליצור שיוך כרטיס אצל הספק");
        const providerId = String(created.ID);
        const reused = await client.entities.CardSetupRequest.filter({ provider_customer_id: providerId, environment: access.environment }, "id", 1);
        if (reused.length) throw new CardError("הספק החזיר שיוך קיים; יצירת קישור נעצרה כדי להגן על הכרטיס");
        await client.entities.StoredCard.update(card.id, { provider_customer_id: providerId });
        await client.entities.CardSetupRequest.update(setup.id, { provider_customer_id: providerId });
        const result = await providerCall(access, "ProcessApiRequestV2", { request: {
          Invoice4UUserApiKey: access.key, CreditCardCompanyType: access.company, AddToken: true,
          CustomerId: Number(providerId), FullName: customer.name, Phone: customer.phone, Email: customer.email || "",
          IsDocCreate: false, IsQaMode: access.environment === "qa", Platform: "Pulse",
          OrderIdClientUsage: setup.id, ReturnUrl: cardAppUrl,
          CallBackUrl: cardAppUrl + "/functions/invoice4uStoredCards?setup=" + setup.id + "&token=" + secret
        } });
        if (hasErrors(result) || !result.ClearingRedirectUrl) throw new CardError(providerFailure(result).message);
        const redirect = new URL(result.ClearingRedirectUrl);
        if (redirect.protocol !== "https:") throw new CardError("התקבל קישור סליקה לא תקין");
        await client.entities.CardSetupRequest.update(setup.id, { state: "pending", redirect_url: redirect.href });
        return Response.json({ setupId: setup.id, redirectUrl: redirect.href });
      } catch (e) {
        await client.entities.CardSetupRequest.update(setup.id, { state: "failed", callback_hash: "", redirect_url: "" });
        await client.entities.StoredCard.update(card.id, { state: "cancelled", provider_customer_id: "" });
        await releaseCustomer(client, customer.id, "setup:" + setup.id);
        throw e;
      }
    }
    if (action === "reconcile") {
      const op = await client.entities.StoredCardOperation.get(body.operationId);
      if (!op || op.customer_id !== customer.id || customer.busy_operation_id !== op.id) throw new CardError("הפעולה אינה שייכת ללקוח", 409);
      if (op.state === "completed") {
        await releaseCustomer(client, customer.id, op.id);
        return Response.json(safeOperation(op));
      }
      if (!["unknown", "dispatched"].includes(op.state)) throw new CardError("הפעולה בטיפול. אין לבצע חיוב נוסף.", 409);
      if (!op.provider_payment_id || !op.payment_id) throw new CardError("אין מזהה עסקה מאומת. נדרש בירור מול הספק; אין לשלוח חיוב חוזר.", 409);
      // Serialize reconciliation independently; approved -> unknown on failure makes a later retry possible.
      const locked = await client.entities.StoredCardOperation.updateMany({ id: op.id, state: op.state },
        { $set: { state: "approved" } });
      if (locked.updated !== 1) throw new CardError("הפעולה כבר בטיפול", 409);
      try { return Response.json(await finishCharge(client, op, customer, config)); }
      catch (e) { await client.entities.StoredCardOperation.update(op.id, { state: "unknown" }); throw e; }
    }
    if (action === "quote" || action === "charge") {
      if (action === "charge" && text(body.requestKey)) {
        const previous = await client.entities.StoredCardOperation.filter({ customer_id: customer.id, request_key: text(body.requestKey, 80) }, "id", 10);
        const existing = previous.find(o => o.failure_code !== "concurrent_operation");
        if (existing) {
          if (existing.event_id !== body.eventId || existing.card_id !== body.cardId ||
              existing.amount !== money(body.amount) || existing.total !== money(body.confirmedTotal) ||
              existing.currency !== body.currency || existing.description !== text(body.description, 300))
            throw new CardError("מזהה הפעולה כבר שימש לחיוב אחר", 409);
          return Response.json(safeOperation(existing));
        }
      }
      if (!event) throw new CardError("חסר אירוע לחיוב");
      const card = await activeCard(client, customer, config, body.cardId);
      if (card.environment === "qa" && event.stored_card_qa_only !== true)
        throw new CardError("חיוב QA מותר רק באירוע בדיקה ייעודי; לא ניתן לרשום תשלום בדיקה באירוע אמיתי", 409);
      const amount = money(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new CardError("סכום לא תקין");
      const financials = await eventBalance(client, event, config);
      if (amount > financials.balance) throw new CardError("הסכום גבוה מהיתרה העדכנית");
      if (financials.payments.some(p => p.payment_status === "pending")) throw new CardError("קיים תשלום ממתין באירוע. יש לברר אותו לפני חיוב נוסף.", 409);
      const fee = calculateProcessingFee(config, amount);
      const total = money(amount + fee.amount);
      if (action === "quote") return Response.json({ amount, fee: fee.amount, total, currency: financials.currency, card: safeCard(card) });
      if (money(body.confirmedTotal) !== total || body.currency !== financials.currency) throw new CardError("סכום החיוב השתנה; נדרש אישור מחדש", 409);
      const requestKey = text(body.requestKey, 80);
      if (!/^[a-zA-Z0-9-]{20,80}$/.test(requestKey) || !text(body.description, 300)) throw new CardError("חסר מזהה פעולה או תיאור חיוב");
      const access = providerAccess(config, card.environment);
      const op = await client.entities.StoredCardOperation.create({ customer_id: customer.id, card_id: card.id,
        event_id: event.id, environment: access.environment, kind: "charge", state: "prepared", request_key: requestKey, amount, fee: fee.amount, total,
        currency: financials.currency, description: text(body.description, 300), performed_by: user.id });
      try { await claimCustomer(client, customer, op.id); }
      catch (e) { await client.entities.StoredCardOperation.update(op.id, { state: "failed", failure_code: "concurrent_operation" }); throw e; }
      let dispatched = false;
      let payment;
      try {
        // Re-read after acquiring the lock; a stale browser cannot authorize an obsolete balance/card.
        const freshEvent = await client.entities.Event.get(event.id);
        const freshCustomer = await client.entities.BillingCustomer.get(customer.id);
        await activeCard(client, freshCustomer, config, card.id);
        const latest = await eventBalance(client, freshEvent, config);
        if (freshEvent.billing_customer_id !== customer.id || latest.currency !== financials.currency || amount > latest.balance ||
          latest.payments.some(p => p.payment_status === "pending")) throw new CardError("היתרה או שיוך האירוע השתנו", 409);
        payment = await client.entities.Payment.create({ event_id: event.id, billing_customer_id: customer.id,
          stored_card_operation_id: op.id, amount, currency: financials.currency, payment_date: new Date().toISOString().slice(0, 10),
          payment_method: "credit_card", payment_status: "pending", clearing_method: "stored_card", charge_type: "regular",
          processing_fee_amount: fee.amount, payer_name: customer.name, card_suffix: card.card_suffix, notes: op.description });
        await client.entities.StoredCardOperation.update(op.id, { payment_id: payment.id, state: "dispatched" });
        dispatched = true;
        const items = buildDocumentItems({ event: freshEvent, services: latest.services, amount, fee, itemized: false, financials: latest,
          vatRate: (Number(config.vat_rate) || 18) / 100, usdIlsRate: Number(config.usd_ils_exchange_rate) || 3.6 });
        const result = await providerCall(access, "ProcessApiRequestV2", { request: {
          Invoice4UUserApiKey: access.key, CreditCardCompanyType: access.company, ChargeWithToken: true,
          CustomerId: Number(card.provider_customer_id), Sum: total, Currency: financials.currency === "ILS" ? "NIS" : financials.currency,
          Type: 1, FullName: customer.name, Phone: customer.phone, Email: customer.email || "", Description: op.description,
          OrderIdClientUsage: op.id, IsDocCreate: true, IsManualDocCreationsWithParams: true,
          ...itemsToPipedFields(items, Number(config.vat_rate) || 18, total), DocHeadline: op.description,
          DocBranchId: config.invoice4u_branch_id || undefined, Language: "he", IsQaMode: access.environment === "qa", Platform: "Pulse"
        } });
        if (hasErrors(result) && !result.PaymentId) {
          await client.entities.Payment.update(payment.id, { payment_status: "failed", invoice4u_clearing_status: "declined" });
          await client.entities.StoredCardOperation.update(op.id, { state: "failed", failure_code: providerFailure(result).code });
          await releaseCustomer(client, customer.id, op.id);
          return Response.json({ ...safeOperation({ ...op, state: "failed" }), message: providerFailure(result).message });
        }
        if (!result.PaymentId || result.ClearingRedirectUrl) throw new CardError("תוצאת החיוב מחייבת בירור", 409);
        const saved = await client.entities.StoredCardOperation.update(op.id, { state: "approved",
          provider_payment_id: String(result.PaymentId), provider_trace_id: String(result.ClearingTraceId || ""),
          provider_document_id: String(result.DocumentId || ""), provider_document_number: String(result.DocumentNumber || ""),
          provider_auth_number: String(result.AuthNumber || ""), provider_cipher: String(result.CipherText || ""),
          provider_cipher_original: String(result.CipherTextOriginal || "") });
        return Response.json(await finishCharge(client, { ...op, ...saved, payment_id: payment.id }, customer, config));
      } catch (e) {
        await client.entities.StoredCardOperation.update(op.id, { state: dispatched ? "unknown" : "failed", failure_code: dispatched ? "result_requires_review" : "validation_failed" });
        if (!dispatched) {
          if (payment) await client.entities.Payment.update(payment.id, { payment_status: "failed" });
          await releaseCustomer(client, customer.id, op.id);
          throw e;
        }
        return Response.json({ ...safeOperation({ ...op, state: "unknown", payment_id: payment?.id }), message: "התוצאה בבירור. אין לבצע חיוב נוסף." });
      }
    }
    throw new CardError("פעולה לא נתמכת");
  } catch (e) {
    return Response.json({ error: e instanceof CardError ? e.message : "הפעולה לא הושלמה. יש לרענן ולבדוק את מצבה לפני ניסיון נוסף." },
      { status: e instanceof CardError ? e.status : 500 });
  }
});
