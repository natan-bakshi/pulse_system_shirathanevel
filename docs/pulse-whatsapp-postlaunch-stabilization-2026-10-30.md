# Pulse — WhatsApp post-launch stability / 30.10.2026

**Policy:** Keep working Pulse assignments, Push, reminders, calendar, queue and UI. Buttons are additional. Make only necessary fixes. Use targeted checkpoints and existing routes.

## P0 Calendar sync — targeted repair implemented
- Evidence: Google Calendar OAuth connector still active; admin/supplier sync settings true; original Event and EventService workflows active. Live function logs had repeated Google PATCH 400: Invalid start time. Workflows sometimes reported success although the backend function returned handled failures.
- Root cause addressed: Google Calendar PATCH retains nested obsolete start/end date fields when changing all-day to timed and vice versa, producing invalid start. Both existing calendar functions now use a PATCH-only normalization helper. POST, IDs, titles, templates, account and event data remain unchanged.
- Second gap: the existing SupplierDashboard and signed WhatsApp callbacks use EventService.updateMany CAS, which does not emit the standard entity UPDATE workflow. After a committed change only, those two paths request existing calendar sync with a metadata-only EventService.update. The old EventService calendar workflow condition and relevance allowlist recognize calendar_sync_wake_at. onAssignmentChange ignores calendar-only wake to avoid duplicate Push/reminders.
- No new Google calendar, no mass resynchronization, no new cron, no provider send, no assignment workflow replacement.
- Safety: if calendar metadata update's acknowledgement is uncertain, no blind repeat; supplier CAS and inbound Receipt remain authoritative. Track uncertain wake for later scoped recovery; never trigger another business action.
- Validation: Google calendar workflow definition validated by platform API. Full regression 926/926; Vite build successful. Pure tests cover PATCH all-day↔timed, wake payload and no touching of business fields.

## P1 — Automatic WhatsApp response after button press (implemented 30.10.2026)
- Reuses the ALREADY LIVE verified Green callback, terminal WhatsAppInboundReceipt, central WhatsAppOutbox and its existing watchdog. No new cron, provider call inside webhook, or separate send system.
- A newly finalized Green receipt sets feedback_required. Old receipts have no marker and will NEVER be bulk sent retroactive feedback. Every receipt gets exactly one stable Outbox key button-feedback:<receipt.id> under existing queue enqueue lock.
- Before feedback enqueue, service verifies terminal outcome, original accepted assignment Outbox, source Green account, provider message ID, assignment revision, current supplier/phone, signed immutable button snapshot (HMAC) and receipt event identity. The response is always in the existing private chat, never a group or unrelated number.
- Exact reply types: approved successfully, declined successfully, changed previously through Pulse/business conflict, rejected due to invalid state, and UNKNOWN (neutral text that does NOT claim success or failure). Duplicate callback and lost receipt link ACK never cause duplicate messages. Provider switch/Green sending-account change cannot cause feedback from a different number.
- Queuing happens immediately after receipt finalization; if enqueue or link ACK is uncertain, no supplier status is changed again. A small bounded scan of feedback_required terminal receipts in the EXISTING 5-minute watchdog retries queue **creation only** via the same idempotency key; never replays unknown provider transport.
- Tests: 933/933 Node tests, build and parser pass; new tests cover verified HMAC, duplicate prevention after lost link, tenant/recipient/account rejection, source integrity, manager conflict and transport sender fence. No live test message was sent.
- Exact scope: standard assignment approve/reject Green button replies only. URL button contact_office opens WhatsApp directly and is NOT an incoming business callback. Unknown/unauthenticated arbitrary messages do not receive a reply.

## P1 Next: production security review and additional buttons
- Review Base44 RLS on WhatsAppInboundReceipt/Outbox, authenticated callback routing, CSRF/role gate, rate budgets, same Green account and callback account, secrets and tenant separation. Avoid changing RLS semantics before auditing production admin visibility.
- Broaden only after separate handler tests for supplier reminder, clients, managers; keep status decisions inside Pulse available.

## Previously planned P1 Next: automatic response after verified button presses
- Reuse signed Green callback, existing terminal WhatsAppInboundReceipt, centralized WhatsAppOutbox and provider pacing. Send a unique feedback intent only after durable terminal receipt: approved, rejected, already handled in Pulse, expired/invalid, and changes allowed only from Pulse.
- An ambiguous backend/provider result NEVER creates optimistic confirmation or blind resend. Repeated button clicks must not create repeated feedback. Ignore non-button manual WhatsApp messages.

## P1 Security and operational readiness
- Verify webhook authentication and instance, supplier-to-phone and tenant binding, Outbox source, HMAC token, receipt states, rate budget, RLS, callback ACK paths, and owner on/off switch. Preserve already sent responses while new buttons off.

## P2 Additional message kinds
- Reuse whatsappInteractiveActionRegistry.ts, action binding V2 and draft settings. Each new message kind needs exact recipient, action handler, business origin, durable receipt and independent eligibility. Start with one type at a time, do not activate arbitrary actions from JSON.

## P3 Existing WhatsApp master plan
- After P0/P1, resume docs/whatsapp-performance-and-reliability-plan-2026-10-15.md: Green/Wasender fallback, pacing, UNKNOWN investigation, international recipients, duplicate protection and app performance. Do not rewrite proven functions or switch on staging-only assignmentEffectProcessor.

**Deployment state:** code complete and tested; record checkpoint and deployment separately, verify post-deploy workflow trigger and published version.