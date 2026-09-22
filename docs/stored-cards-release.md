# Customer stored cards — release and verification notes

Status (2026-09-22 latest): production token capture explicitly enabled at the owner's request; production charging retains its separate readiness gate. Real-card capture remains unverified. Historical verification sections below describe their respective dates.

## Production capture-only activation
- Owner requested a production capture test instead of provider QA. No real card, provider request, charge, customer message or test-event creation was performed by this code change.
- Existing live settings were stored_cards_enabled=true, stored_cards_env=production, stored_cards_cleanup=approval. Added stored_cards_production_capture_enabled=true after passing all 35 mocked tests.
- Setup and setup verification request capture-only provider access. That access accepts customer creation, log retrieval and AddToken without monetary/document flags or a nonzero amount; it refuses charging and refunds.
- Charge paths still require INVOICE4U_STORED_CARDS_PRODUCTION_READY=true; no secrets were changed. The capture setting does not satisfy the charge gate.
- Credentials, terminal tokenization support, provider callback shape and a completed hosted capture must still be verified live. Offline tests are not proof of provider compatibility.
- Rollback capture activation: set stored_cards_production_capture_enabled=false. Checkpoints restore code, not AppSettings data.
- Pre-change checkpoint: 6ab2a31dea65853c5218b7aa (commit 4714936af2b1f85756289e015dea584674511cec).
- Signature, closing-policy, WhatsApp receipt tracking and immutable signed-PDF changes remain planning only; existing consent-reference requirement is unchanged.

## Implemented
- Explicit BillingCustomer identity; Event.billing_customer_id. No automatic matching by contact name.
- Customer-wide card setup, charge, local removal, approval/automatic cleanup and paginated bulk removal.
- Admin-only entity policies and server authorization. Hosted collection only; no PAN/CVV handling.
- Setup callbacks use a hashed per-request credential and provider-log verification.
- Each card generation receives a separate Invoice4U customer ID to isolate old hosted links.
- Conditional customer locks, stable operation IDs, no automatic retry after ambiguous charge dispatch.
- Local accounting reconciliation without sending another financial request.
- Setup-write recovery using previously recorded provider identifiers and fresh log verification.
- Existing financial/status mutation hooks. No new scheduler or entity automation was created.
- Pending/failed payments excluded from UI balances, preserving legacy payments without a status.
- New stored-card payments preserved by EventForm instead of deletion/recreation.
- QA configuration separate from the existing invoice4u_env setting.

## Settings and secrets
- stored_cards_enabled: false by default.
- stored_cards_cleanup: off | approval | automatic, default off.
- stored_cards_env: qa | production, default qa; does not change ordinary payment settings.
- QA requires INVOICE4U_API_TOKEN_QA; never falls back to production.
- Production charging requires INVOICE4U_STORED_CARDS_PRODUCTION_READY=true.
  Production capture also accepts the explicit stored_cards_production_capture_enabled=true setting.
  These are operational release gates, not evidence that verification happened.
- Existing INVOICE4U_API_TOKEN and company setting continue to be used for production.
- QA charges require an explicitly disposable Event with stored_card_qa_only=true.
  Never set this on a real customer event. Prefer an isolated test app/dataset.
  QA creates test accounting records; these must remain in disposable test data.
- The release work did not enable these settings, configure secrets, send messages, or charge cards.

## Verification completed
- node --test tests/stored-cards.test.mjs: 29 passing tests.
- npm run build: exit 0.
- Focused ESLint on new/changed billing components: exit 0.
- The broader changed-file lint has 17 unused-import errors that also exist in the
  original checkpoint 22106b3079c10b914b41c5fc24cef2e650483826 (6 EventForm, 2 NotificationBell, 9 EventDetails).
- Live Base44 entity schema inspection confirmed the four new entities and their admin-only policies.
- Live settings inspection: ordinary Invoice4U environment remains production, company type 15;
  no stored_cards_enabled setting existed (therefore disabled).
- Browser runtime verification was not completed: automatic approval review reported workspace credits exhausted.
- Tests use in-memory Base44/Invoice4U adapters. They do not prove real database atomicity,
  provider callback compatibility, terminal enablement, or browser interactions.

## Required before production activation
1. Confirm tokenization and merchant-initiated charge support on the actual terminal.
2. In isolated QA, verify AddToken with the exact provider: hosted capture without a charge/document.
   Dedicated token docs omit Sum while the general request schema marks it required; do not silently
   replace capture-only with a small real charge.
3. Verify CreateCustomer produces distinct provider IDs for identical contact details.
   If it returns an existing ID, setup deliberately stops; obtain a supported provider strategy.
4. Verify callback format, response-log identifiers, type 1/zero-amount capture logs,
   type 3 charge logs, currency, card suffix and full log retrieval.
5. Verify SDK updateMany compare-and-set and simultaneous operations against actual Base44,
   including interaction with ordinary hosted payments/manual changes, not only stored-card actions.
   Existing direct entity writers are not a database-wide transaction boundary.
6. Exercise create/link customer, add/replace/cancel card, late/duplicate callback, charge,
   decline, ambiguous timeout, accounting-write failure, manual/bulk/automatic removal,
   admin notification and non-admin denial in the browser.
7. Verify balance/document totals, fees and Invoice4U document ownership for the generated provider customer.
8. Publish frontend only after review; enable production only after the above passes.

## Operations and recovery
- Never clear a charge lock or resend a charge because the browser timed out.
- Use the displayed operation ID and provider logs to investigate.
- With recorded provider payment identifiers, reconcile completes local accounting only.
- Without an unambiguous provider transaction identifier, external investigation is required;
  matching by amount/name alone is not accepted.
- A process terminated while holding a lock may require operator reconciliation. There is no
  time-based automatic unlock: absence of a response does not establish absence of a charge.
- Setup recovery does not create a new hosted request or charge.
- Removing the local active-card pointer disables use from all linked events; it does not revoke
  the provider's token or erase historical financial documents.
- A failed cleanup notification can be retried on a later relevant change without duplicating
  recipients that already received it. No recurring scan was added.
- No customer/event migration was run. Existing events require explicit payer linking.

## Source documentation
https://invoice4u.gitbook.io/invoice4u-docs/clearing-payments/tokens-and-standing-orders
https://invoice4u.gitbook.io/invoice4u-docs/clearing-payments/process-api-request-v2
https://invoice4u.gitbook.io/invoice4u-docs/clearing-payments/clearing-logs

## Restore points
Before feature implementation:
before-stored-cards-implementation-2026-09-18
checkpoint 6aacf534ec133dd2a496b585
commit 22106b3079c10b914b41c5fc24cef2e650483826

Before final validation fixes:
before-stored-cards-final-validation-2026-09-20
checkpoint 6aafbe08901d2b55b828bb82
commit 5120cf88f2e23f1c58105e0b362b69df4433c61b


## 2026-09-21 follow-up
Hosted checkout now reserves its pending payment under the same linked-customer lock as stored-card charging when the feature is enabled. It re-reads customer binding, balance, currency, and pending payments before reservation; the legacy disabled/unlinked path is unchanged. Three additional mocked regression tests pass (32 total). This does not serialize all existing direct manual financial writers. Browser access is now available and reaches the Pulse login page; authenticated UI and live provider QA remain outstanding.

## 2026-09-22 authenticated UI follow-up
- Secure email/password sign-in to published Pulse succeeded; the connected user role was independently confirmed as admin.
- The existing billing dashboard and configuration render through the application menu. Production billing settings were not changed and no charges were sent.
- Authenticated Base44 development preview validation completed. The stored-card configuration renders the enable switch, isolated QA/production environment selector, three cleanup-policy modes and production warning.
- Draft-state behavior was verified without saving: toggling enablement activated the save button and unsaved warning; refreshing discarded the draft. No charge, customer or card record was created.
- A direct BillingDashboard navigation redirected to the home dashboard while settings were loading. Layout now waits for settings for an authenticated admin before deciding whether billing is disabled. The direct preview route remained on BillingDashboard after refresh; non-admin denial remains immediate.
- Final checks: 32/32 stored-card tests passed, production build passed, focused billing lint passed and whitespace validation passed. Layout still has the same four pre-existing unused-import errors as checkpoint commit 9fea329902f1a8e16cda8fb5dd11a664341d697e; no new lint errors.
- Live settings remain safe: stored_cards_enabled=false and stored_cards_cleanup=off; the absent stored_cards_env uses the QA default. Billing remains enabled and ordinary Invoice4U remains production. StoredCard and BillingCustomer are empty.
- Real provider QA and live Base44/Invoice4U concurrency remain unverified because no isolated provider QA credentials/test terminal and disposable payment instrument were used. Production activation remains blocked by the server release gate.
