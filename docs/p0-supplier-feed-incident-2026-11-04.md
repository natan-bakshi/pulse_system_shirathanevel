# INC-P0 Supplier portals: assignment feed unavailable — 2026-11-04

Scope: Pulse / Shirat HaNevel (`687d1de6659eff83e9c034f7`), supplier dashboard and supplier calendar. No WhatsApp provider changes.

## Incident
Two independent suppliers reported an empty screen saying the authenticated assignment list/calendar could not be loaded; another supplier could use the app normally. The error is emitted from the shared `useSupplierAssignmentsFeed` hook after a backend `supplierAssignmentsFeed` invocation fails. It is NOT the deliberate empty-results screen.

## Live read-only diagnostics performed
- Observed approximately **2,847 EventService records** (6 pages of up to 500), but only a minority carry supplier assignments. The previous backend walked the ENTIRE EventService collection for EACH supplier login, then read individual Event records; the number of requests, scan duration and call budget grow with unrelated events.
- Verified Base44 entity `$regex` filter matching the complete quoted supplier ID against the existing JSON-encoded `supplier_ids` string. Real supplier examples (53, 49, 15 and 1 assigned services) returned their expected assignments. Some historical invalid supplier IDs were present; they are not eligible as authenticated supplier identities and are never used in the query.
- Verified Base44 `Event` query `{id:{$in:[...]}}` against actual event records; returned only the requested IDs. Existing catalog/user/Supplier data were not modified.
- The function's production log endpoint did not have historical lines. The scan is a strong cause candidate, not a conclusive proof of the specific two suppliers' errors. Never claim to have authenticated as those suppliers or validated their phones in this session.

## Hotfix implementation
- `base44/shared/supplierAssignmentsFeed.ts`: after server authentication and exact email match to the Supplier, query `EventService.filter({supplier_ids:{$regex:'"'+supplier.id+'"' }})` rather than the full table. Validate exact JSON array membership for every returned row before any Event reads. Never use user-submitted supplier IDs and never fall back to global scans. Preserve active/pending/approved/rejected semantics, redaction, and pagination until an empty page even for provider-imposed lower page sizes.
- Batch the already authorized `Event.id` set into one paginated `Event.filter({id:{$in:...}})` query instead of doing one request per event. Restrict selected columns and validate every returned ID against the membership-derived ID set. A runtime without `$in` can still fall back to **individual authorized IDs only**; errors never widen event scope.
- No mutation to event assignments, statuses, supplier accounts, webhook configuration, WhatsApp queue, notifications or saved payments.
- `base44/functions/supplierAssignmentsFeed/entry.ts`: log fixed sanitized error categories on 5xx without putting names, IDs, phone numbers, message text or raw exceptions into logs.
- `tests/supplier-assignments-feed-security.test.mjs`: regression coverage of 2,847 unrelated services, deep pagination, scoped foreign record rejection, long individual history, fast batch event lookup, server fallback without cross-account reads, rejected history cards, negative auth and the original HTTP wrapper.
- This change affects both `SupplierDashboard` and `SupplierCalendarDashboard` through their existing shared hook, with no UI redesign.

## Release and verification
- [x] Read-only production data audit and targeted query validation.
- [x] Checkpoint created before editing: `6aeb10206beb1f7a36380d39`.
- [x] Focused tests passed: 18/18.
- [x] Full regression suite: **1,164 / 1,164 tests passed**; production Vite build and focused ESLint succeeded; diff validation clean.
- [x] Final checkpoint created: `6aeb13fe46414439bb688aaf`, commit `44712f0b8fcaac4e1a8c49509d6bb7a118ad54be`.
- [x] **Published to production 2026-11-04 11:16:38 UTC** at `https://pulse-system.base44.app`. Base44 status is `ready`, published URL matches, and the deployed checkpoint reports that exact commit.
- [x] Checked production `supplierAssignmentsFeed` logs after publish; no errors were logged in the available window. No real affected supplier session was impersonated or observed.
- [ ] Retest by one of the two affected suppliers; this cannot be simulated as their authenticated accounts by admin-only queries.
- [ ] If issue recurs, read `supplierAssignmentsFeed` prod logs for `category=...`; distinguish expired authentication (401), role (403), query fallback (503), network failure or stale PWA cache. Do not diagnose by switching the browser to unrestricted EventService.list.

## Follow-up
A separate, lower-priority account linkage issue exists: among 29 registered supplier-role users in a limited read-only snapshot, 28 matched a Supplier contact email and one did not. That mismatch displays **'supplier profile not found'** instead of the incident's feed-error message; investigate independently without guessing identity or changing supplier records. Finish the global Event/EventService RLS migration only after the existing client/supplier/dashboard paths have passed end-to-end cross-account QA.
