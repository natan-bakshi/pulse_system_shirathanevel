# Shirat HaNevel Pulse — Restore essential supplier event card information
Date: 2026-11-09. App ID: 687d1de6659eff83e9c034f7.
Owner explicitly requested this BEFORE resuming WhatsApp/customer messaging and HE/EN closing work.

## Before (verified against source)
- URL /SupplierEventView?id=... (also redirect from the old /EventDetails route for supplier users) displayed ONLY event name, family surname, date/time, generic event location/city, assigned service name and supplier_arrival_time. API returned a status string but UI did not display it.
- Child name, parents/names/phone contact links, event timeline, service description, meeting/pickup locations and supplier-specific notes were missing.
- Backend was email-authenticated and required own active service membership; no customer financial fields were projected. Rejected assignment remains a redacted status card in SupplierDashboard, not a valid route to family contacts.

## After (source committed and tested)
- Read-only supplier card now has sections:
  1. Event name, family, Bar/Bat Mitzvah child, date, time and venue.
  2. **Own assigned services only**, status badge, full practical service description normalized safely to plain text (no HTML injection), supplier arrival time, service standing time, meeting/pickup location, all valid pickup stops for assigned transport services, and supplier-specific note only.
  3. Parent contacts: name and displayed phone from Event.parents; clickable **Call** and **WhatsApp** links for EVERY supplier type (not just photographers), only when validated by server canonical E.164 phone parsing. Contact email, IDs, custom fields and secondary contact metadata never project.
  4. Event schedule items (time/activity/notes), including empty-state when not available.
- All new interface labels have reviewed English equivalents in interface dictionary (UI locale remains independent of event source-language/translated customer text).
- No supplier status mutation, no WhatsApp/notification sends, no payments, no customer data writes. No new cron/automations and no unrestricted browser-side Event/EventService reads.
- Authorization preserved: supplier email must match Supplier.contact_emails; current EventService must explicitly belong to requested event AND current supplier, with a still-active assignment; unrelated, removed/rejected/external services cannot expose a family card. Server returns allowlisted fields only. Rejects invalid IDs before database access. Catalog fallback reads only the current supplier's service when name/description is absent. A misbehaving event-scoped provider query returning a service from another event cannot leak it.
- "Parents visible to all suppliers" is an intentional per-event owner-approved broadening, NOT public access. Existing global Event/EventService RLS remains as-is; a separate long-term P0 remains to audit ALL non-admin raw readers before tightening entity-level read access. Do not claim that scoped projections change underlying RLS.
- Old EventDetails blank-screen fix is untouched. SupplierDashboard/Calendar remain powered by their narrow separate supplierAssignmentsFeed. Rejected historic cards remain redacted as before.

## Verification
- Targeted tests (notification-smartlinks, supplier feed, new supplier operational card) 35/35 passed. New tests check exact parent contact allowlist, normalized IL/US call/WhatsApp links, invalid phone no link, event schedule, own service details, transport stops, Quill description HTML plain-text conversion, no financial/private catalog fields, no foreign supplier notes or services, event-id-mismatch guard, detached/rejected access and catalog fallback without broad queries.
- Full Vite build passed; **1,295 / 1,295** Node tests passed; targeted ESLint passed, git diff --check clean.
- Actual authenticated live supplier account and side-by-side browser screenshots could not be safely obtained from generic admin test browser (not authorized to simulate a real assigned supplier). Provide a **clearly labeled example layout comparison**, not fabricated live screenshots or actual family phone numbers. A real assigned supplier should open the card on iPhone and desktop for acceptance if needed.

## Pending matters, not part of this release
- Separate urgent Green webhook provider GetSettings + real signed click round-trip acceptance remains open; no provider settings were changed here. Details: docs/pulse-urgent-green-assignment-buttons-2026-11-09.md.
- Full bilingual closing process and soft payment reminder messaging remain paused by owner; precise resumption plan: docs/pulse-multilingual-he-en-plan-2026-11-08.md.

## Final production post-deploy hardening
- After the first publish, a no-auth read-only POST to the supplierEventView endpoint returned HTTP 500 rather than a truthful 401. Its body contained no event details, but it was an incorrect authorization error.
- Updated the endpoint to handle \`client.auth.me()\` rejected sessions as anonymous and return HTTP 401 before reading an event. Kept the service-role assignment authorization, no client-controlled scope and no raw entity exposure.
- Added an isolated runtime test that executes the actual Base44 handler with a simulated rejected login and proves HTTP 401 and zero event reads. Re-ran **all 1,296/1,296** Node tests and Vite build; targeted ESLint clean, git diff --check clean.
- Production anonymous POST retest **still required after this final release**; first release had 500 and cannot be called fully verified until the corrected endpoint is deployed and retested. No authenticated supplier account was used to avoid exposing real customer names/phones.
