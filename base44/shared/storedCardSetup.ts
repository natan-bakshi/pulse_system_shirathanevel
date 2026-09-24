import { CardError, claimCustomer, releaseCustomer } from "./storedCards.ts";
import { resolveProviderCustomer, providerCustomerFields } from "./resolveProviderCustomer.ts";
import { cardAppUrl, providerAccess, providerCall, hasErrors, providerFailure, sha256 } from "./storedCardProvider.ts";
const text = (v, max = 200) => typeof v === "string" ? v.trim().slice(0, max) : "";
async function discardProvisionalCustomer(client, customerId) {
  const customer = await client.entities.BillingCustomer.get(customerId);
  if (!customer?.provisional || customer.active_card_id) return;
  await client.entities.Event.updateMany({ billing_customer_id: customerId }, { $set: { billing_customer_id: "" } });
  await client.entities.BillingCustomer.delete(customerId);
}
export async function beginSetup(client, user, config, customer, consentReference, eventId = "", provisionalCustomer = false, agreement = null, evidence = null) {
  const reference = text(consentReference, 500) || (evidence?.uri ? "צילום הסכמת לקוח" : "");
  if (!reference) throw new CardError("נדרש תיעוד הסכמת הלקוח לשמירה ולחיוב עתידי");
  const access = providerAccess(config, undefined, "capture");
  if (customer.busy_operation_id) throw new CardError("קיימת פעולה בטיפול", 409);
  if (customer.active_card_id) {
    const previous = await client.entities.StoredCard.get(customer.active_card_id);
    if (previous.environment !== access.environment) throw new CardError("יש להסיר את הכרטיס מהסביבה הקודמת לפני שמירת כרטיס בסביבה אחרת");
  }
  let card: any;
  let setup: any;
  let claimed = false;
  try {
    card = await client.entities.StoredCard.create({
      customer_id: customer.id, environment: access.environment, state: "pending",
      consent_image_uri:evidence?.uri||"", consent_image_hash:evidence?.hash||"", consent_reference: reference, consent_recorded_by: user.id, consent_recorded_at: new Date().toISOString(),
      cleanup_pending: false, cleanup_notified: false, agreement_id: agreement?.id || ""
    });
    const secret = crypto.randomUUID() + crypto.randomUUID();
    setup = await client.entities.CardSetupRequest.create({
      customer_id: customer.id, card_id: card.id, state: "creating", environment: access.environment,
      callback_hash: await sha256(secret), expires_at: new Date(Date.now() + 86400000).toISOString(),
      created_by_user_id: user.id, event_id: eventId, provisional_customer: provisionalCustomer, agreement_id: agreement?.id || ""
    });
    await claimCustomer(client, customer, "setup:" + setup.id);
    claimed = true;
    const created = await providerCall(access, "CreateCustomer", {
      token: access.key,
      cu: { Name: text(customer.name), Active: true,
        ...(text(customer.email, 254) ? { Email: text(customer.email, 254) } : {}),
        ...(text(customer.phone, 30) ? { Cell: text(customer.phone, 30) } : {}) }
    });
    if (hasErrors(created) || !Number.isSafeInteger(Number(created?.ID)) || Number(created.ID) <= 0) throw new CardError("לא ניתן ליצור שיוך כרטיס אצל הספק");
    const providerId = String(created.ID);
    const reused = await client.entities.CardSetupRequest.filter({ provider_customer_id: providerId, environment: access.environment }, "id", 1);
    if (reused.length) throw new CardError("הספק החזיר שיוך קיים; יצירת קישור נעצרה כדי להגן על הכרטיס");
    await client.entities.StoredCard.update(card.id, { provider_customer_id: providerId });
    await client.entities.CardSetupRequest.update(setup.id, { provider_customer_id: providerId });
    const providerCustomer = await resolveProviderCustomer(access, providerId);
    // In token-only mode Invoice4U resolves the clearing provider from the terminal tied to the API key.
    // Do not force CreditCardCompanyType here; a stale UI setting can otherwise target the wrong terminal.
    const result = await providerCall(access, "ProcessApiRequestV2", { request: {
      Invoice4UUserApiKey: access.key, AddToken: true,
      CustomerId: Number(providerId), ...providerCustomerFields(providerCustomer),
      IsDocCreate: false, IsQaMode: access.environment === "qa", Platform: "Pulse",
      OrderIdClientUsage: setup.id,
      ReturnUrl: agreement ? cardAppUrl + "/EventClosing?id=" + agreement.id : eventId ? cardAppUrl + "/EventDetails?id=" + encodeURIComponent(eventId) : cardAppUrl,
      CallBackUrl: cardAppUrl + "/functions/invoice4uStoredCards?setup=" + setup.id + "&token=" + secret
    } });
    if (hasErrors(result) || !result.ClearingRedirectUrl) {
      const failure = providerFailure(result);
      console.warn("[stored-cards] setup rejected", JSON.stringify({
        code: failure.code, providerMessage: failure.providerMessage, environment: access.environment,
        providerSelectedByTerminal: true
      }));
      await client.entities.CardSetupRequest.update(setup.id, { failure_code: failure.code });
      throw new CardError(failure.message);
    }
    const redirect = new URL(result.ClearingRedirectUrl);
    if (redirect.protocol !== "https:") throw new CardError("התקבל קישור סליקה לא תקין");
    await client.entities.CardSetupRequest.update(setup.id, { state: "pending", redirect_url: redirect.href });
    return { setupId: setup.id, redirectUrl: redirect.href };
  } catch (e) {
    try {
      if (setup) await client.entities.CardSetupRequest.update(setup.id, { state: "failed", callback_hash: "", redirect_url: "" });
      if (card) await client.entities.StoredCard.update(card.id, { state: "cancelled", provider_customer_id: "" });
      if (claimed && setup) await releaseCustomer(client, customer.id, "setup:" + setup.id);
      if (provisionalCustomer) await discardProvisionalCustomer(client, customer.id);
    } catch { console.warn("[stored-cards] setup cleanup pending"); }
    throw e;
  }
}