# SEC-P0 — Event / EventService entity RLS migration, current 03.11.2026

## Implementation status
- CODE: ClientDashboard and SupplierDashboard/Calendar already use restricted server-side feeds.
- CODE: EventDetails client was migrated to authenticated read-only `clientEventDetailsFeed`, which checks event ownership or a permitted client contact BEFORE reading services. The event, services and minimal catalog are returned as an explicit field whitelist. The admin route keeps the existing editor.
- CODE: Raw Event/EventService realtime subscriptions are restricted to admins in Layout. Route role decisions now prevent mounting unauthorized admin page children before redirect.
- CODE: WhatsApp provider numbers/settings and central queue are unchanged. Added office inquiry buttons with `need details` and `callback` intents, both using a trusted office phone and event-service reference.

## Security status — NOT FINISHED
**Verified against live Base44 entity schemas on 2026-11-03:** both Event and EventService still report `rls.read={}`. A user might still make direct SDK calls and retrieve raw rows even when protected frontend paths are blocked. This is NOT resolved by the code changes above. Do not claim tenant-level confidentiality.

## Next P0 work before turning on restrictive RLS
1. Inventory all other direct Event and EventService readers including Layout, admin UI, provider integrations, client galleries, notifications and calendar functions.
2. Ensure all non-admin code paths access verified server projections, not raw entity records or subscriptions. Check legitimate function permissions/roles.
3. Cross-account test two client identities, two suppliers with disjoint assignments, unauthenticated user and admin, calling Event/EventService GET, FILTER and LIST directly. Verify denied raw reads and allowed scoped endpoints.
4. Deploy admin-only read RLS in a controlled checkpoint with rollback after staging QA; test supplier calendar and responses, client event finance and clearing, admin editing and Google Calendar, WhatsApp notifications and reconciliation.
5. Audit broad Supplier, Service and AppSettings reads separately without breaking client billing switches and VAT.

## WhatsApp follow-up
Per-template office reply intents now work as buttons but require the supplier to press Send. Original message reference is included as a text reference, NOT WhatsApp's native quoted-message bubble.
Green SendInteractiveButtons does not document quotedMessageId; native quote may be offered for text-only messages after same-chat/account/assignment-revision verification and GetMessage proof. Use one provider send and no automatic retry on UNKNOWN.

Current detailed plan: `docs/wa-i08h-production-client-event-and-quick-replies-2026-11-03.md`. Main WhatsApp plan: `docs/whatsapp-performance-and-reliability-plan-2026-10-15.md`.
