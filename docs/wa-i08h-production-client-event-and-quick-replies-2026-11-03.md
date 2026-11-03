# WA-I08h — 2026-11-03: Scoped client event page and non-business response buttons

App: Pulse Shirat HaNevel, Base44 687d1de6659eff83e9c034f7.
This phase is a targeted code and production rollout, not the final entity-RLS security migration.

## Completed in code
- Authenticated POST `base44/functions/clientEventDetailsFeed/entry.ts`. Calls `readClientEventDetailsFeed` with server-authenticated user; event ID never acts as authorization. Restricted projection returns only one authorized client event, its services, and minimal catalog data. Missing/foreign IDs produce generic errors. No raw supplier assignment data, payment tokens or workflow internals are returned.
- `src/pages/EventDetails.jsx`: client first passes the scoped backend feed, then the page mounts. Client queries use the same cached feed, not Event.get/EventService.filter or Supplier/Service/Package/QuoteTemplate global lists. Admin editor queries and cache keys remain intact. Refresh uses two parallel reads (client feed + client finance) for clients and the three historical reads for admins.
- `src/Layout.jsx`: raw Event/EventService live subscriptions run for admins only; route-role guard blocks unauthorized admin/dashboard components synchronously before mount. No new subscriptions, cron or polling.
- Additional owner template button choices `office_details` ('צריך פרטים') and `office_callback` ('תחזרו אליי'). Each opens an editable, prefilled WhatsApp draft to the trusted office number containing the Outbox message reference, optional event-service reference and a redacted event summary. The supplier presses Send manually; no business status is changed, no new inbound handler is installed, and there are no extra server/provider requests. The worker checks the exact prefilled URL and the configured office phone before send. Supports at most 3 buttons including existing types.
- Protected the existing office inquiry builder by reusing its redaction, length restrictions and fixed reference format. No external URL shortener and no expanded permissions for customers/admins.

## Quotes: documented provider limitation
- Green API `SendMessage` supports `quotedMessageId` but can return HTTP 200 without delivery if the ID is invalid; `GetMessage` can confirm the original is in the sender's chat journal, but journal updates may be delayed.
- Currently functional Green `SendInteractiveButtons` and `SendInteractiveButtonsReply` do NOT document a `quotedMessageId` request field. Old `SendButtons` and `SendTemplateButtons` endpoints explicitly say they are not working (403). Do not attempt a native quote together with current interactive buttons and risk sending failure.
- The two new office reply intents add an accurate original `EventService` reference for the office. These are contextual references, **not** WhatsApp native reply bubbles.
- Existing `greenVerifiedQuotePlanner.ts` stays CODE-ONLY. Native quote on text-only messages requires owner opt-in, same-chat/account/revision evidence, GetMessage cost budget, and no resend on UNKNOWN. Prioritize interactive buttons when both are configured. Do not add a second WhatsApp message just to mimic quoting.
- Sources: https://green-api.com/en/docs/api/sending/SendInteractiveButtons/ ; https://green-api.com/en/docs/api/sending/SendMessage/ ; https://green-api.com/en/docs/api/journals/GetMessage/ ; https://green-api.com/en/docs/api/sending/SendTemplateButtons/

## Important P0 security remainder
- Event and EventService entity RLS read remains broad (`read: {}`) until all non-admin SDK consumers have been migrated and confirmed in live cross-account testing. New client/supplier page guards protect those particular paths but cannot stop a direct authenticated SDK read under existing RLS. Do NOT call the entire application secure until entity policies are fixed.
- A separate AppSettings, Supplier and catalog data-access review is required. Client EventDetails still uses the existing AppSettings read to preserve billing, VAT and client-clearing behavior. Do not accidentally disable client payments.
- Before tightening RLS: inventory all remaining browser paths, all legitimate background functions, service-role credentials, and subscription consumers; use two independent real user sessions to test direct API denials, client finance, supplier calendar, assignment decisions, admin editors and pending reminders.

## Testing / release gates
- New tests: `tests/client-event-details-projection.test.mjs`, `tests/wa-i08h-production-wiring.test.mjs`, expanded `tests/event-details-parallel-refresh.test.mjs`, `tests/whatsapp-custom-template-buttons.test.mjs`.
- Unit tests do not prove WhatsApp provider delivery or full entity RLS. Verify real outgoing behavior through normal production events (without unsolicited test messages).
- Continue: P0 RLS migration / cross-account smoke test, then text-only native quote opt-in, signed non-business quick replies, and reliability/UNKNOWN audit. Never use an unsupported Green quote field for interactive messages.
