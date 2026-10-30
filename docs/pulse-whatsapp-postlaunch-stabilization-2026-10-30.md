# Pulse — WhatsApp post-launch stability / 30.10.2026

**Policy:** Keep working Pulse assignments, Push, reminders, calendar, queue and UI. Buttons are additional. Make only necessary fixes. Use targeted checkpoints and existing routes.

## P0 Calendar sync — targeted repair implemented
- Evidence: Google Calendar OAuth connector still active; admin/supplier sync settings true; original Event and EventService workflows active. Live function logs had repeated Google PATCH 400: Invalid start time. Workflows sometimes reported success although the backend function returned handled failures.
- Root cause addressed: Google Calendar PATCH retains nested obsolete start/end date fields when changing all-day to timed and vice versa, producing invalid start. Both existing calendar functions now use a PATCH-only normalization helper. POST, IDs, titles, templates, account and event data remain unchanged.
- Second gap: the existing SupplierDashboard and signed WhatsApp callbacks use EventService.updateMany CAS, which does not emit the standard entity UPDATE workflow. After a committed change only, those two paths request existing calendar sync with a metadata-only EventService.update. The old EventService calendar workflow condition and relevance allowlist recognize calendar_sync_wake_at. onAssignmentChange ignores calendar-only wake to avoid duplicate Push/reminders.
- No new Google calendar, no mass resynchronization, no new cron, no provider send, no assignment workflow replacement.
- Safety: if calendar metadata update's acknowledgement is uncertain, no blind repeat; supplier CAS and inbound Receipt remain authoritative. Track uncertain wake for later scoped recovery; never trigger another business action.
- Validation: Google calendar workflow definition validated by platform API. Full regression 926/926; Vite build successful. Pure tests cover PATCH all-day↔timed, wake payload and no touching of business fields.

## P1 Next: automatic response after verified button presses
- Reuse signed Green callback, existing terminal WhatsAppInboundReceipt, centralized WhatsAppOutbox and provider pacing. Send a unique feedback intent only after durable terminal receipt: approved, rejected, already handled in Pulse, expired/invalid, and changes allowed only from Pulse.
- An ambiguous backend/provider result NEVER creates optimistic confirmation or blind resend. Repeated button clicks must not create repeated feedback. Ignore non-button manual WhatsApp messages.

## P1 Security and operational readiness
- Verify webhook authentication and instance, supplier-to-phone and tenant binding, Outbox source, HMAC token, receipt states, rate budget, RLS, callback ACK paths, and owner on/off switch. Preserve already sent responses while new buttons off.

## P2 Additional message kinds
- Reuse whatsappInteractiveActionRegistry.ts, action binding V2 and draft settings. Each new message kind needs exact recipient, action handler, business origin, durable receipt and independent eligibility. Start with one type at a time, do not activate arbitrary actions from JSON.

## P3 Existing WhatsApp master plan
- After P0/P1, resume docs/whatsapp-performance-and-reliability-plan-2026-10-15.md: Green/Wasender fallback, pacing, UNKNOWN investigation, international recipients, duplicate protection and app performance. Do not rewrite proven functions or switch on staging-only assignmentEffectProcessor.

**Deployment state:** code complete and tested; record checkpoint and deployment separately, verify post-deploy workflow trigger and published version.