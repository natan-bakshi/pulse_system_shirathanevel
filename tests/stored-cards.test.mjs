// Offline regression tests: all entities and Invoice4U calls are in-memory fakes.
// Run: node --test tests/stored-cards.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { webcrypto } from "node:crypto";
globalThis.crypto ||= webcrypto;
globalThis.Deno = { serve: handler => handler };
const plugin = { name: "offline-adapters", setup(b) {
  b.onResolve({ filter: /^npm:@base44\/sdk/ }, () => ({ path: "sdk", namespace: "fake" }));
  b.onResolve({ filter: /^base44:runtime$/ }, () => ({ path: "runtime", namespace: "fake" }));
  b.onLoad({ filter: /.*/, namespace: "fake" }, args => ({ contents: args.path === "sdk"
    ? "export const createClientFromRequest = () => globalThis.__client;"
    : "export const secrets = { get: key => globalThis.__secrets[key] };" }));
}};
async function load(path) {
  const result = await build({ entryPoints: [path], bundle: true, platform: "node", format: "esm", write: false, plugins: [plugin] });
  return import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64"));
}
const { default: handler } = await load("base44/functions/invoice4uStoredCards/entry.ts");
const core = await load("base44/shared/storedCards.ts");
const provider = await load("base44/shared/storedCardProvider.ts");
function fixture() {
  const db = {}, calls = [], logs = [];
  let serial = 0, providerSerial = 9000;
  const entities = new Proxy({}, { get(_, name) {
    db[name] ||= [];
    const match = (row, query) => Object.entries(query).every(([key, value]) => row[key] === value);
    return {
      async get(id) { return structuredClone(db[name].find(r => r.id === id) || null); },
      async filter(query = {}, sort = "id", limit = 500, skip = 0) {
        return structuredClone(db[name].filter(r => match(r, query)).sort((a,b) => String(a[sort] || a.id).localeCompare(String(b[sort] || b.id))).slice(skip, skip + limit));
      },
      async list() { return structuredClone(db[name]); },
      async create(data) {
        if (globalThis.__failWrite?.(name, data)) throw new Error("simulated storage failure");
        const row = { id: name + "-" + (++serial), created_date: new Date().toISOString(), updated_date: new Date().toISOString(), ...structuredClone(data) };
        db[name].push(row); return structuredClone(row);
      },
      async update(id, data) {
        if (globalThis.__failWrite?.(name, data)) throw new Error("simulated storage failure");
        const row = db[name].find(r => r.id === id);
        assert.ok(row, name + " record exists");
        Object.assign(row, structuredClone(data), { updated_date: new Date().toISOString() });
        return structuredClone(row);
      },
      async updateMany(query, update) {
        let updated = 0;
        for (const row of db[name]) if (match(row, query)) { Object.assign(row, structuredClone(update.$set), { updated_date: new Date().toISOString() }); updated++; }
        return { success: true, updated };
      },
      async delete(id) { db[name] = db[name].filter(r => r.id !== id); }
    };
  } });
  const client = { entities, auth: { me: async () => ({ id: "admin", email: "admin@example.test", role: "admin" }) } };
  client.asServiceRole = client;
  globalThis.__client = client;
  globalThis.__secrets = { INVOICE4U_API_TOKEN_QA: "fake-qa-key" };
  globalThis.__failWrite = null;
  globalThis.fetch = async (url, options) => {
    const endpoint = String(url).split("/").pop(), payload = JSON.parse(options.body);
    calls.push({ endpoint, payload });
    if (endpoint === "CreateCustomer") return Response.json({ ID: ++providerSerial });
    if (endpoint === "GetClearingLogByParams") return Response.json(logs);
    if (endpoint === "ProcessApiRequestV2") {
      const r = payload.request;
      if (r.AddToken) return Response.json({ ProcessApiRequestV2Result: { ClearingRedirectUrl: "https://pay.example.test/" + r.CustomerId, Errors: [] } });
      const id = "provider-payment-" + calls.length;
      logs.push({ PaymentId: id, ClearingTraceId: "trace-" + id, IsSuccess: true, LogType: 2, TransactionType: 3,
        Amount: r.Sum, Currency: r.Currency === "NIS" ? 1 : 2, CreditNumber: "1111" });
      return Response.json({ ProcessApiRequestV2Result: { PaymentId: id, ClearingTraceId: "trace-" + id, DocumentId: "doc-" + id, DocumentNumber: "101", Errors: [] } });
    }
    throw new Error("Unexpected external call");
  };
  const config = { billing_enabled: "true", stored_cards_enabled: "true", stored_cards_cleanup: "off",
    invoice4u_env: "qa", stored_cards_env: "qa", invoice4u_clearing_company_type: "15", vat_rate: "18" };
  db.AppSettings = Object.entries(config).map(([setting_key, setting_value]) => ({ id: setting_key, setting_key, setting_value }));
  db.User = [{ id: "admin", role: "admin", email: "admin@example.test" }];
  db.BillingCustomer = [{ id: "customer", name: "QA Customer", phone: "0500000000", email: "qa@example.test", active_card_id: "card", busy_operation_id: "", revision: 0 }];
  db.StoredCard = [{ id: "card", customer_id: "customer", state: "active", provider_customer_id: "1234", environment: "qa",
    card_suffix: "1111", cleanup_pending: false, cleanup_notified: false }];
  db.Event = [{ id: "event", stored_card_qa_only: true, event_name: "QA event", billing_customer_id: "customer", status: "completed", primary_currency: "ILS",
    total_override: 100, total_override_includes_vat: true }];
  const setConfig = (key, value) => { config[key] = value; const row = db.AppSettings.find(r => r.setting_key === key); if (row) row.setting_value = value; else db.AppSettings.push({ id: key, setting_key: key, setting_value: value }); };
  return { db, calls, logs, client, config, setConfig };
}
async function request(action, body = {}) {
  const response = await handler(new Request("https://pulse.example.test/functions/invoice4uStoredCards", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...body })
  }));
  return { status: response.status, data: await response.json() };
}
const chargeBody = { eventId: "event", customerId: "customer", cardId: "card", amount: 100, confirmedTotal: 100, currency: "ILS",
  requestKey: "12345678-1234-1234-1234-123456789012", description: "QA service" };

test("unauthorized users cannot access customer cards or invoke the provider", async () => {
  const f = fixture(); f.client.auth.me = async () => ({ id: "supplier", role: "user" });
  assert.equal((await request("status", { eventId: "event" })).status, 403);
  assert.equal((await request("charge", chargeBody)).status, 403);
  assert.equal(f.calls.length, 0);
});
test("disabled feature performs no mutation or provider call", async () => {
  const f = fixture(); f.setConfig("stored_cards_enabled", "false");
  assert.equal((await request("charge", chargeBody)).status, 403);
  assert.equal(f.calls.length, 0); assert.equal(f.db.Payment?.length || 0, 0);
});
test("missing QA key never falls back to production; production requires readiness", async () => {
  const f = fixture(); globalThis.__secrets = { INVOICE4U_API_TOKEN: "fake-production" };
  assert.equal((await request("charge", chargeBody)).status, 503);
  assert.equal(f.calls.length, 0);
  f.setConfig("stored_cards_env", "production"); f.db.StoredCard[0].environment = "production";
  assert.equal((await request("charge", chargeBody)).status, 503);
  assert.equal(f.calls.length, 0);
});
test("status returns masked card metadata without provider identifiers", async () => {
  fixture(); const r = await request("status", { eventId: "event" });
  assert.equal(r.data.card.card_suffix, "1111");
  assert.equal(JSON.stringify(r.data).includes("provider_customer_id"), false);
});
test("customer cleanup checks all events, debt, pending payments and order of transitions", () => {
  const done = { status: "completed", balance: 0 };
  assert.equal(core.cleanupDecision([done]).eligible, true);
  for (const status of ["confirmed", "in_progress"]) assert.equal(core.cleanupDecision([done, { status, balance: 0 }]).eligible, false);
  assert.equal(core.cleanupDecision([done, { status: "cancelled", balance: 1 }]).eligible, false);
  assert.equal(core.cleanupDecision([{ status: "completed", balance: -100 }, { status: "completed", balance: 10 }]).eligible, false);
  assert.equal(core.cleanupDecision([{ ...done, pending: true }]).eligible, false);
  assert.equal(core.cleanupDecision([{ ...done, balance: NaN }]).eligible, false);
  assert.equal(core.cleanupDecision([], false).eligible, false);
  assert.equal(core.cleanupDecision([done], true).eligible, false);
  assert.equal(core.cleanupDecision([done, { status: "quote", balance: 500 }]).eligible, true);
});
test("manual removal clears only local card capability and preserves payments", async () => {
  const f = fixture(); f.db.Payment = [{ id: "old-payment", event_id: "event", amount: 100 }];
  const r = await request("remove", { customerId: "customer", cardId: "card" });
  assert.equal(r.data.removed, true); assert.equal(f.db.BillingCustomer[0].active_card_id, "");
  assert.equal(f.db.StoredCard[0].provider_customer_id, ""); assert.equal(f.db.Payment.length, 1); assert.equal(f.calls.length, 0);
  assert.equal((await request("charge", chargeBody)).status, 409);
});
test("old removal approval cannot remove a replacement card", async () => {
  const f = fixture(); f.db.BillingCustomer[0].active_card_id = "new-card";
  assert.equal((await request("remove", { customerId: "customer", cardId: "card" })).status, 409);
  assert.equal(f.db.BillingCustomer[0].active_card_id, "new-card");
});
test("eligibility removal rechecks a newly opened debt and releases lock", async () => {
  const f = fixture();
  const r = await request("remove", { customerId: "customer", cardId: "card", eligibleOnly: true });
  assert.equal(r.status, 409); assert.equal(f.db.BillingCustomer[0].busy_operation_id, "");
  assert.equal(f.db.BillingCustomer[0].active_card_id, "card");
});
test("conditional customer lock admits one concurrent writer", async () => {
  const f = fixture(), customer = structuredClone(f.db.BillingCustomer[0]);
  const r = await Promise.allSettled([core.claimCustomer(f.client, customer, "a"), core.claimCustomer(f.client, customer, "b")]);
  assert.equal(r.filter(x => x.status === "fulfilled").length, 1);
  assert.equal(r.filter(x => x.status === "rejected").length, 1);
});
test("approved charge records payment and document exactly once on retry", async () => {
  const f = fixture();
  const first = await request("charge", chargeBody); assert.equal(first.data.state, "completed", JSON.stringify(first));
  const second = await request("charge", chargeBody); assert.equal(second.data.id, first.data.id);
  assert.equal(f.calls.filter(c => c.payload.request?.ChargeWithToken).length, 1);
  assert.equal(f.db.Payment.length, 1); assert.equal(f.db.FinancialDocument.length, 1);
  assert.equal(f.db.Payment[0].payment_status, "completed");
});
test("simultaneous charge attempts send at most one provider request", async () => {
  const f = fixture();
  const r = await Promise.all([request("charge", chargeBody), request("charge", { ...chargeBody, requestKey: "22345678-1234-1234-1234-123456789012" })]);
  assert.equal(r.filter(x => x.data.state === "completed").length, 1);
  assert.equal(f.calls.filter(c => c.payload.request?.ChargeWithToken).length, 1);
});
test("timeout is unknown, keeps payment pending and never retries the financial request", async () => {
  const f = fixture(); let sent = 0;
  globalThis.fetch = async () => { sent++; throw new Error("timeout after dispatch"); };
  const first = await request("charge", chargeBody); assert.equal(first.data.state, "unknown");
  assert.equal(f.db.Payment[0].payment_status, "pending"); assert.ok(f.db.BillingCustomer[0].busy_operation_id);
  const second = await request("charge", chargeBody); assert.equal(second.data.state, "unknown"); assert.equal(sent, 1);
});
test("accounting failure after provider approval is recovered without charging again", async () => {
  const f = fixture(); let fail = true;
  globalThis.__failWrite = (entity, data) => { if (fail && entity === "Payment" && data.payment_status === "completed") { fail = false; return true; } return false; };
  const first = await request("charge", chargeBody); assert.equal(first.data.state, "unknown");
  const result = await request("reconcile", { customerId: "customer", operationId: first.data.id });
  assert.equal(result.data.state, "completed", JSON.stringify(result));
  assert.equal(f.db.FinancialDocument.length, 1); assert.equal(f.calls.filter(c => c.payload.request?.ChargeWithToken).length, 1);
});
test("mismatched amount or unresolved hosted payment prevents charging", async () => {
  const f = fixture();
  assert.equal((await request("charge", { ...chargeBody, confirmedTotal: 101 })).status, 409);
  f.db.Payment = [{ id: "pending", event_id: "event", amount: 100, payment_status: "pending" }];
  assert.equal((await request("charge", chargeBody)).status, 409); assert.equal(f.calls.length, 0);
});
test("setup creates a dedicated provider customer and no payment/document", async () => {
  const f = fixture();
  const r = await request("setup", { customerId: "customer", consentConfirmed: true, consentReference: "Agreement QA-1" });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(f.db.Payment?.length || 0, 0); assert.equal(f.db.FinancialDocument?.length || 0, 0);
  const payload = f.calls.find(c => c.payload.request?.AddToken).payload.request;
  assert.equal(payload.AddToken, true); assert.equal(payload.IsDocCreate, false);
  assert.notEqual(String(payload.CustomerId), "1234"); assert.equal(payload.ChargeWithToken, undefined);
});
test("verified setup callback activates new card and duplicate callback is harmless", async () => {
  const f = fixture();
  await request("setup", { customerId: "customer", consentConfirmed: true, consentReference: "Agreement QA-1" });
  const p = f.calls.find(c => c.payload.request?.AddToken).payload.request;
  f.logs.push({ PaymentId: "capture", ClearingTraceId: "capture-trace", IsSuccess: true, LogType: 2, TransactionType: 1, Amount: 0, CreditNumber: "2222" });
  const payload = { Success: "True", TokenCaptureOnly: "True", TokenCaptureAndCharge: "False",
    OrderIdClientUsage: p.OrderIdClientUsage, CustomerId: String(p.CustomerId), PaymentId: "capture",
    ClearingTraceId: "capture-trace", CardSuffix: "2222", CardBrandName: "Visa" };
  const make = () => new Request(p.CallBackUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ Data: JSON.stringify(payload) }) });
  let r = await handler(make()); assert.equal(r.status, 200, await r.text());
  const cardId = f.db.BillingCustomer[0].active_card_id; assert.notEqual(cardId, "card");
  r = await handler(make()); assert.equal(r.status, 200);
  assert.equal(f.db.BillingCustomer[0].active_card_id, cardId);
  assert.equal(f.db.StoredCard.find(c => c.id === "card").state, "removed");
});
test("cancelled setup cannot reactivate a card; new setup remains available", async () => {
  const f = fixture();
  await request("setup", { customerId: "customer", consentConfirmed: true, consentReference: "Agreement QA-1" });
  const url = f.calls.find(c => c.payload.request?.AddToken).payload.request.CallBackUrl;
  await request("cancel_setup", { customerId: "customer" });
  assert.equal((await handler(new Request(url, { method: "POST", body: "{}" }))).status, 403);
  assert.equal(f.db.BillingCustomer[0].active_card_id, "card");
  assert.equal((await request("setup", { customerId: "customer", consentConfirmed: true, consentReference: "Agreement QA-2" })).status, 200);
});
test("approval notifications deduplicate, automatic mode removes locally", async () => {
  const f = fixture(); f.db.Payment = [{ id: "paid", event_id: "event", amount: 100, payment_status: "completed" }];
  f.setConfig("stored_cards_cleanup", "approval");
  await core.applyCleanup(f.client, "customer", f.config); await core.applyCleanup(f.client, "customer", f.config);
  assert.equal(f.db.InAppNotification.length, 1); assert.equal(f.db.StoredCard[0].cleanup_pending, true); assert.equal(f.calls.length, 0);
  f.setConfig("stored_cards_cleanup", "automatic"); await core.applyCleanup(f.client, "customer", f.config);
  assert.equal(f.db.BillingCustomer[0].active_card_id, ""); assert.equal(f.calls.length, 0);
});
test("log validation rejects wrong transaction, amount, currency and identity", () => {
  const expected = { paymentId: "p", traceId: "t", type: 3, amount: 100, currency: "ILS" };
  const valid = { PaymentId: "p", ClearingTraceId: "t", IsSuccess: true, LogType: 2, TransactionType: 3, Amount: 100, Currency: 1 };
  assert.equal(provider.matchClearingLog(valid, expected), true);
  for (const change of [{ PaymentId: "wrong" }, { Amount: 99 }, { Currency: 2 }, { TransactionType: 1 }, { IsSuccess: false }, { LogType: 1 }])
    assert.equal(provider.matchClearingLog({ ...valid, ...change }, expected), false);
});

test("reassignment cannot move an event away from a customer with a running charge", async () => {
  const f = fixture();
  f.db.BillingCustomer[0].busy_operation_id = "ongoing-charge";
  f.db.BillingCustomer.push({ id: "other", name: "Other", active_card_id: "", busy_operation_id: "", revision: 0 });
  const result = await request("bind", { eventId: "event", customerId: "other" });
  assert.equal(result.status, 409);
  assert.equal(f.db.Event[0].billing_customer_id, "customer");
  assert.equal(f.db.BillingCustomer.find(c => c.id === "other").busy_operation_id, "");
});
test("a card belonging to a different customer is never charged", async () => {
  const f = fixture(); f.db.StoredCard[0].customer_id = "different-customer";
  assert.equal((await request("charge", chargeBody)).status, 409);
  assert.equal(f.calls.length, 0);
});
test("idempotency key reuse with a different amount is rejected", async () => {
  const f = fixture();
  assert.equal((await request("charge", chargeBody)).data.state, "completed");
  const response = await request("charge", { ...chargeBody, amount: 50, confirmedTotal: 50 });
  assert.equal(response.status, 409);
  assert.equal(f.calls.filter(c => c.payload.request?.ChargeWithToken).length, 1);
});
test("capture interrupted during local writes can be recovered without creating a second setup", async () => {
  const f = fixture();
  await request("setup", { customerId: "customer", consentConfirmed: true, consentReference: "Agreement QA" });
  const p = f.calls.find(c => c.payload.request?.AddToken).payload.request;
  f.logs.push({ PaymentId: "capture", ClearingTraceId: "capture-trace", IsSuccess: true, LogType: 2, TransactionType: 1, Amount: 0, CreditNumber: "2222" });
  const payload = { Success: "True", TokenCaptureOnly: "True", TokenCaptureAndCharge: "False",
    OrderIdClientUsage: p.OrderIdClientUsage, CustomerId: String(p.CustomerId), PaymentId: "capture",
    ClearingTraceId: "capture-trace", CardSuffix: "2222" };
  let once = true;
  globalThis.__failWrite = (entity, data) => {
    if (once && entity === "StoredCard" && data.state === "active") { once = false; return true; } return false;
  };
  const response = await handler(new Request(p.CallBackUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }));
  assert.equal(response.status, 500);
  assert.equal(f.db.StoredCard.find(c => c.id === "card").state, "active");
  assert.equal(f.db.BillingCustomer[0].active_card_id, "card");
  const recovered = await request("recover_setup", { customerId: "customer" });
  assert.equal(recovered.status, 200, JSON.stringify(recovered));
  assert.notEqual(f.db.BillingCustomer[0].active_card_id, "card");
  assert.equal(f.calls.filter(c => c.payload.request?.AddToken).length, 1);
  assert.equal(f.calls.filter(c => c.payload.request?.ChargeWithToken).length, 0);
});
test("cleanup considers pending quote payments and pages beyond 500 payment rows", async () => {
  const f = fixture();
  f.db.Payment = Array.from({ length: 501 }, (_, i) => ({ id: "p-" + i.toString().padStart(4,"0"), event_id: "event", amount: i === 500 ? 100 : 0, payment_status: "completed" }));
  assert.equal((await core.customerEligibility(f.client, "customer", f.config)).eligible, true);
  f.db.Event.push({ id: "quote", billing_customer_id: "customer", status: "quote" });
  f.db.Payment.push({ id: "quote-payment", event_id: "quote", amount: 50, payment_status: "pending" });
  assert.equal((await core.customerEligibility(f.client, "customer", f.config)).eligible, false);
});
test("missing amount in capture log cannot be mistaken for zero", () => {
  assert.equal(provider.matchClearingLog({ IsSuccess: true, LogType: 2, PaymentId: "p", TransactionType: 1 },
    { paymentId: "p", type: 1, amount: 0 }), false);
});
test("all new entities restrict direct data access to admins", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const name of ["BillingCustomer","StoredCard","CardSetupRequest","StoredCardOperation"]) {
    const schema = JSON.parse(await readFile("base44/entities/" + name + ".jsonc", "utf8"));
    for (const op of ["read", "create", "update", "delete"]) assert.deepEqual(schema.rls[op], { user_condition: { role: "admin" } });
  }
});

test("QA and production settings are independent and QA cannot credit a real event", async () => {
  const f = fixture(); f.setConfig("invoice4u_env", "production");
  delete f.db.Event[0].stored_card_qa_only;
  assert.equal((await request("charge", chargeBody)).status, 409);
  assert.equal(f.calls.length, 0);
  f.db.Event[0].stored_card_qa_only = true;
  assert.equal((await request("charge", chargeBody)).data.state, "completed");
  assert.equal(f.calls.find(c => c.payload.request?.ChargeWithToken).payload.request.Invoice4UUserApiKey, "fake-qa-key");
});
test("failed notification creation is retried without duplicating delivered notices", async () => {
  const f = fixture(); f.setConfig("stored_cards_cleanup", "approval");
  f.db.Payment = [{ id: "paid", event_id: "event", amount: 100, payment_status: "completed" }];
  f.db.User.push({ id: "admin2", role: "admin", email: "second@example.test" });
  let once = true;
  globalThis.__failWrite = (entity, data) => {
    if (once && entity === "InAppNotification" && data.user_id === "admin2") { once = false; return true; } return false;
  };
  await assert.rejects(core.applyCleanup(f.client, "customer", f.config));
  assert.equal(f.db.InAppNotification.length, 1);
  await core.applyCleanup(f.client, "customer", f.config);
  assert.equal(f.db.InAppNotification.length, 2);
});
test("stored-card financial document retains the precise provider customer", async () => {
  const f = fixture(); await request("charge", chargeBody);
  assert.equal(f.db.FinancialDocument[0].customer_identifier, "1234");
});
