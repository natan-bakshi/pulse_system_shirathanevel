# Pulse — supplier event reminders missing on 10 Nov 2026

App: 687d1de6659eff83e9c034f7. Source plan: docs/pulse-multilingual-he-en-plan-2026-11-08.md. Scope: Shirat HaNevel only.

## Read-only production diagnosis
- Owner identified one supplier manually reminded already, with an explicit prohibition on any system outbound messages or catch-up today.
- The active one-day supplier reminder template was enabled and the central WhatsApp queue was functional for unrelated traffic. The reminder failure was before queue delivery.
- The app contains 253 events, at least 500 EventService rows and 97 supplier records. The daily and legacy producer used nonpaginated list() methods. Their first 50 EventService results had zero rows belonging to the next-day events; their first Event results omitted some next-day events.
- Two active events on 11 Nov have 7 + 10 confirmed supplier assignments; 6 + 8 = 14 event-supplier assignments were WhatsApp eligible, representing 12 distinct people. None had a matching event_reminder Outbox record, supplier event-reminder InApp record or event reminder pending fanout when investigated. Three other confirmed assignments had no eligible WhatsApp destination/WhatsApp disabled. No assertion is made about messages sent manually outside Pulse.
- Two eligible supplier phone strings included U+2069 right-to-left direction controls, so the old strict phone parser would reject them. Phone numbers and private customer details are not stored in this public plan.

## Permanent code remediation
- Added date-window-scoped Israel-local event inventory with full pagination of all relevant EventServices and Suppliers; no need for a broad every-service-on-every-day query. Used by dailyScheduledNotifications and sendEventReminders.
- Existing event reminder scheduled fanout now paginates services and suppliers, uses one event-supplier reminder per recipient instead of once per EventService row, and uses the same business idempotency key as the daily and legacy sender.
- InApp notifications are only mirrors; their existence is not proof WhatsApp was enqueued. The same durable Outbox business key is offered without creating duplicates. Already accepted or uncertain key outcomes remain non-replayable.
- Removed only invisible Unicode directional presentation markers in canonical WhatsApp phone parsing, preserving all digits and rejecting extensions, invalid formats, URLs and second numbers.
- Corrected the legacy day-before event reminder cutoff to use local start-of-day rather than the event start time.
- Added a one-time owner-requested hold for 11 Nov 2026 event reminders during 10–11 Nov in all three event-reminder producers, automatically expiring after that day. This prevents remediation from dispatching the previously missed messages while obeying explicit no-send instructions, without disabling future event reminders or changing the queue. Do not manually invoke any sender or run a backfill.

## Test and operations
- Paginated source fixture includes 160 unrelated events, 516 services on a relevant event and 97 suppliers. End-of-page eligible service is retained, and no real data changes occur.
- Bidi phone string and malformed number tests; business key/idempotency regression; event reminder retry and side-effect isolation; one-time incident hold and expiry tests.
- Production build and full 1,311/1,311 Node tests passed at initial check, targeted ESLint and diff check clean.
- No real WhatsApp, payment, mail or Push was sent, no Outbox backfill/queue worker manually invoked, no contact, assignment or template was modified.
- Next: checkpoint, publish, verify production app status/read-only outbox and event card, then return to main L60 UI coverage and L70 external translation integration with user-authorized provider credentials.
