# WA-I08f: Notification-template buttons + verified smart links (2026-11-01)

App: Pulse, Shirat HaNevel. Source of truth: docs/whatsapp-performance-and-reliability-plan-2026-10-15.md

## User decision
Button editing belongs IN EACH NotificationTemplate editing dialog, in a sixth tab "כפתורים". The general WhatsApp "כפתורים בהודעות" section retains only source-level and existing business-action controls. One template-card shortcut directly opens that tab. Do not make users visit a separate list to customize a single notification.

## Implemented — code
1. NotificationTemplateForm now has "כפתורים" tab. WhatsAppTemplateButtonsTab uses existing owner-authenticated WhatsAppQueueAdmin supplierTemplateButtonsGet/Save CAS; preserves all other templates' settings and existing default/inheritance. Saves from both the tab's Save button and the containing template dialog Save. Unsaved changes warn on close. The old per-template editor is not mounted in NotificationManagementTab. New templates must first be saved to obtain an ID.
2. Existing custom actions unchanged: URL navigation, office WhatsApp, copy reference, call office and a separately enabled signed reminder ACK. Existing approve/reject assignment buttons remain on their original secure path, with no new callbacks or business action.
3. Smart navigation matrix:
   - event_page: supplier -> /SupplierEventView?id=EVENT, admin/client -> /EventDetails?id=EVENT.
   - payment_page: admin/client -> /EventDetails?id=EVENT&tab=financial; never supplier.
   - assignment_page: supplier -> /SupplierDashboard; admin -> /EventDetails?id=EVENT&tab=services.
   - calendar_page: supplier -> /SupplierCalendarDashboard; admin -> /EventsBoardPage; client -> /ClientDashboard.
   - settings_page: /MyNotificationSettings.
   - All unknown roles and invalid event IDs fail closed.
4. AdvancedLinksTab now selects safe role-specific link presets and populates BOTH dynamic_url_type and the legacy deep_link_base/deep_link_params_map fields for scheduled producers. Ambiguous multi-role event/payment destinations are disabled; templates with preexisting manual maps are not silently overwritten unless the owner selects a smart preset. Fixed the query separator bug in 14 existing backend link builders (when a base page already contains '?tab=', append '&id=', not '?id=').
5. /SupplierEventView is a new deliberately minimal supplier screen. Its new read-only supplierEventView backend requires an authenticated account, email association with the Supplier record, current membership in a specific EventService and a pending/approved/confirmed assignment. It returns allowlisted event name/date/time/location and the recipient's own service info only. No payments, prices, private notes, family contacts, other supplier identities or bulk Event/EventService data. Rejects forged IDs, unrelated/rejected assignments and spoofable phone-only matches. Old supplier EventDetails deep links redirect here BEFORE the full event page mounts.
6. /EventDetails now gates a client before full event-page queries via new eventLinkAccess backend; compares authenticated email with the event creator or client contacts. The tab component now honors tab=financial/legacy payments, tab=services/legacy suppliers (including same-mounted navigation). The admin path remains unchanged. Do not regard these UI guards as a substitute for entity RLS.
7. Supplier pending-assignment reminders previously placed EventService.id in source_id. The daily producer now also stamps actual Event.id and matching EventService.id into the existing enqueue context, and Outbox stores smart_event_id only for that matching trusted provenance. New per-template pending reminder buttons may select "event_details"; the destination is the Event ID from the stamped server value, NEVER source_id or free-form text. Missing or inconsistent provenance fails closed to plain text; old queued jobs are unchanged. No new worker, cron, per-send DB read, provider call or automatic resend.

## IMPORTANT OPEN SECURITY FINDING — P0
Event.jsonc and EventService.jsonc currently have RLS read:{}; other frontend pages (SupplierDashboard, SupplierCalendarDashboard, ClientDashboard, etc.) still directly query Event.list/EventService.list and filter only in the browser. A signed-in user MAY retrieve unrelated raw rows via the existing SDK regardless of what a URL or screen displays. This predates the smart-link changes. The new protected event link and frontend gate DO NOT fix that underlying direct entity exposure. Do not claim the whole app is secure.

Do NOT blindly change these RLS reads to admin-only; existing client/supplier dashboards and other workflows rely on them and would break. Required migration:
- Inventory all direct Event/EventService reads and any entity relationships or private fields, per user role.
- Replace supplier/client/other non-admin raw reads with minimum backend projections secured by authenticated identity and current authorized event scope; add negative direct API tests with different user identities.
- Identify verified client access rules (creator and permitted contact) and supplier access across multiple supplier records, authorization changes, event removals, and role-specific data sensitivity.
- Only after non-admin reads have safely migrated, restrict Event/EventService RLS reads (admin-only by default; customer scoped through allowlisted backend functions) with a checkpoint and a staged QA rollout.
- Test supplier calendars, supplier dashboard, client dashboard, event details, financial data, push/InApp and role switching. Treat this as P0 security work before declaring the broader smart-link ecosystem secure.
- Keep owner settings, provider credentials, queue and immutable snapshots unchanged through this migration.

## QA, launch gates and follow-up
- Automated tests for signed-in/unauthorized supplier, foreign/rejected assignment, spoofable phone, private-field redaction, role-specific smart link targets, nested query strings, per-template UI, pending EventService vs Event identity and old queue compatibility.
- Green-native button device acceptance and production delivery remain unverified until an appropriate real notification is observed; no extra live message was sent for testing.
- Existing 'קיבלתי' reply is still controlled by its original owner-operated toggle, not auto-enabled.
- Next: P0 direct-entity read migration/RLS; then reply actions and quote/tag compatibility with Green; then queue latency/UNKNOWN troubleshooting per original plan.
