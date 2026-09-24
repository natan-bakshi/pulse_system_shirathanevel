import { calculateEventBalance } from "./eventBilling.ts";
import { readAll } from "./eventReadiness.ts";

export class CardError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
export const money = (n) => Math.round(Number(n) * 100) / 100;
export async function cardSettings(client) {
  return Object.fromEntries((await readAll(client.entities.AppSettings)).map(r => [r.setting_key, r.setting_value]));
}
export function requireCards(config) {
  if (config.billing_enabled !== "true" || config.stored_cards_enabled !== "true") throw new CardError("ניהול כרטיסים שמורים אינו פעיל", 403);
}
export async function claimCustomer(client, customer, owner) {
  if (customer.busy_operation_id) throw new CardError("ללקוח יש פעולה בטיפול. יש להשלים אותה לפני פעולה נוספת.", 409);
  const result = await client.entities.BillingCustomer.updateMany(
    { id: customer.id, revision: customer.revision, busy_operation_id: "" },
    { $set: { busy_operation_id: owner, revision: customer.revision + 1 } }
  );
  if (result.updated !== 1) throw new CardError("פרטי הלקוח השתנו. יש לרענן ולנסות שוב.", 409);
}
export async function releaseCustomer(client, id, owner, changes = {}) {
  const result = await client.entities.BillingCustomer.updateMany(
    { id, busy_operation_id: owner }, { $set: { ...changes, busy_operation_id: "" } }
  );
  if (result.updated !== 1) throw new CardError("הפעולה נשמרה אך נדרש בירור מצב הלקוח.", 409);
}
export async function eventBalance(client, event, config) {
  const [services, payments] = await Promise.all([
    readAll(client.entities.EventService, { event_id: event.id }),
    readAll(client.entities.Payment, { event_id: event.id })
  ]);
  return { services, payments, ...calculateEventBalance(event, services, payments,
    (Number(config.vat_rate) || 18) / 100, Number(config.usd_ils_exchange_rate) || 3.6) };
}

// Serialize hosted-payment reservation with stored-card operations only for opted-in linked customers.
export async function reserveHostedPayment(client, event, config, amount, currency, createPayment) {
  if (config.stored_cards_enabled !== "true" || !event?.billing_customer_id) return createPayment();
  const customer = await client.entities.BillingCustomer.get(event.billing_customer_id);
  if (!customer) throw new CardError("לקוח החיוב לא נמצא", 409);
  const owner = "hosted:" + crypto.randomUUID();
  await claimCustomer(client, customer, owner);
  try {
    const current = await client.entities.Event.get(event.id);
    if (current?.billing_customer_id !== customer.id) throw new CardError("לקוח האירוע השתנה. יש לרענן.", 409);
    const financials = await eventBalance(client, current, config);
    if (financials.payments.some(p => p.payment_status === "pending")) throw new CardError("קיים תשלום ממתין באירוע. יש לברר את מצבו לפני חיוב נוסף.", 409);
    if (financials.currency !== currency || !Number.isFinite(financials.balance) || amount > financials.balance + 0.01)
      throw new CardError("יתרת האירוע השתנתה. יש לרענן לפני חיוב.", 409);
    return await createPayment();
  } finally { await releaseCustomer(client, customer.id, owner); }
}

// Pure rule; no provider calls, polling, scheduled scan or cross-event offsetting.
export function cleanupDecision(rows, busy = false) {
  if (busy) return { eligible: false, reason: "פעולה כספית בטיפול" };
  if (!rows.some(r => r.status === "completed")) return { eligible: false, reason: "אין אירוע שהסתיים" };
  if (rows.some(r => !["completed", "cancelled", "quote"].includes(r.status))) return { eligible: false, reason: "קיים אירוע פעיל או עתידי" };
  if (rows.some(r => r.status !== "quote" && (!Number.isFinite(r.balance) || money(r.balance) > 0))) return { eligible: false, reason: "קיימת יתרת חוב" };
  if (rows.some(r => r.pending)) return { eligible: false, reason: "קיים תשלום ממתין" };
  return { eligible: true, reason: "האירועים הסתיימו והחובות סולקו" };
}
export async function customerEligibility(client, customerId, config) {
  const events = await readAll(client.entities.Event, { billing_customer_id: customerId });
  const rows = [];
  for (const event of events) {
    if (event.status === "quote") {
      const payments = await readAll(client.entities.Payment, { event_id: event.id });
      rows.push({ ...event, balance: 0, pending: payments.some(p => p.payment_status === "pending") }); continue;
    }
    if (!["completed", "cancelled"].includes(event.status)) return { eligible: false, reason: "קיים אירוע פעיל או עתידי", events };
    const balance = await eventBalance(client, event, config);
    rows.push({ ...event, balance: balance.balance, pending: balance.payments.some(p => p.payment_status === "pending") });
  }
  return { ...cleanupDecision(rows), events };
}
export function safeCard(card) {
  return card ? { id: card.id, state: card.state, environment: card.environment, card_suffix: card.card_suffix || "",
    brand: card.brand || "", has_consent_image:!!card.consent_image_uri, cleanup_pending: !!card.cleanup_pending } : null;
}
export async function removeCard(client, customerId, cardId, actor, config, eligibleOnly = false) {
  const customer = await client.entities.BillingCustomer.get(customerId);
  if (!cardId || customer.active_card_id !== cardId) throw new CardError("הכרטיס השתנה או כבר הוסר", 409);
  const owner = "remove:" + crypto.randomUUID();
  await claimCustomer(client, customer, owner);
  try {
    if (eligibleOnly) {
      const eligibility = await customerEligibility(client, customerId, config);
      if (!eligibility.eligible) throw new CardError(eligibility.reason, 409);
    }
    // Clear the authoritative pointer first. Even a partial failure cannot leave a removed card chargeable.
    const result = await client.entities.BillingCustomer.updateMany(
      { id: customerId, active_card_id: cardId, busy_operation_id: owner },
      { $set: { active_card_id: "" } }
    );
    if (result.updated !== 1) throw new CardError("הכרטיס השתנה", 409);
    await client.entities.StoredCard.update(cardId, {
      state: "removed", provider_customer_id: "", card_suffix: "", brand: "", expires: "",
      cleanup_pending: false, removed_at: new Date().toISOString(), removed_by: actor,
      removal_reason: eligibleOnly ? "settled_customer" : "manual"
    });
    await client.entities.StoredCardOperation.create({ customer_id: customerId, card_id: cardId,
      kind: "remove", state: "completed", performed_by: actor });
    return { removed: true };
  } finally { await releaseCustomer(client, customerId, owner); }
}
export async function applyCleanup(client, customerId, config) {
  if (config.stored_cards_enabled !== "true" || !["approval", "automatic"].includes(config.stored_cards_cleanup)) return;
  const customer = await client.entities.BillingCustomer.get(customerId);
  if (!customer?.active_card_id || customer.busy_operation_id) return;
  const card = await client.entities.StoredCard.get(customer.active_card_id);
  if (card?.state !== "active") return;
  const decision = await customerEligibility(client, customerId, config);
  if (!decision.eligible) {
    if (card.cleanup_pending) await client.entities.StoredCard.update(card.id, { cleanup_pending: false });
    return;
  }
  if (config.stored_cards_cleanup === "automatic") {
    await removeCard(client, customerId, card.id, "system", config, true);
    return;
  }
  if (!card.cleanup_pending) await client.entities.StoredCard.update(card.id, { cleanup_pending: true });
  // One notification batch per card generation; repeated status refreshes do not create more.
  const claimed = await client.entities.StoredCard.updateMany(
    { id: card.id, state: "active", cleanup_notified: false }, { $set: { cleanup_notified: true } }
  );
  if (claimed.updated !== 1) return;
  try {
    const admins = await readAll(client.entities.User, { role: "admin" });
    const link = "/BillingDashboard?tab=cards&card=" + card.id;
    for (const admin of admins) {
      const existing = await client.entities.InAppNotification.filter({
        user_id: admin.id, template_type: "STORED_CARD_CLEANUP", link
      }, "id", 1);
      if (existing.length) continue;
      await client.entities.InAppNotification.create({
        user_id: admin.id, user_email: admin.email, title: "אפשר להסיר כרטיס שמור",
        message: "האירועים של " + customer.name + " הסתיימו והחובות סולקו. ניתן לאשר הסרת הכרטיס.",
        template_type: "STORED_CARD_CLEANUP", is_read: false, is_resolved: false,
        link, related_event_id: decision.events.find(e => e.status === "completed")?.id || ""
      });
    }
  } catch (error) {
    // A later relevant change can retry only the missing notifications.
    await client.entities.StoredCard.updateMany({ id: card.id, state: "active" }, { $set: { cleanup_notified: false } });
    throw error;
  }
}
// Called within existing mutations. Errors never turn a successful payment/status save into a failure.
export async function afterCardRelevantChange(base44, eventIds, suppliedConfig = null) {
  try {
    const client = base44.asServiceRole || base44;
    const customers = new Set();
    for (const id of new Set(eventIds.filter(Boolean))) {
      const event = typeof id === "object" ? id : await client.entities.Event.get(id);
      if (event?.billing_customer_id) customers.add(event.billing_customer_id);
    }
    if (!customers.size) return;
    const config = suppliedConfig || await cardSettings(client);
    for (const id of customers) await applyCleanup(client, id, config);
  } catch { console.warn("[stored-cards] cleanup needs retry; financial mutation preserved"); }
}
