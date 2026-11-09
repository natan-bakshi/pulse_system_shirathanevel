# Pulse / Shirat HaNevel — Hebrew / English implementation plan

Created: 2026-11-08. Scope: Base44 app `687d1de6659eff83e9c034f7`, repository `natan-bakshi/pulse_system_shirathanevel`, production `https://pulse-system.base44.app` ONLY.

## Owner's requirements
- Preserve every existing business action, permission, integration, calculation, layout and Hebrew workflow. This project adds languages only.
- Hebrew remains the default and source of truth. English must be natural, professional, faithful, and consistently use Shirat HaNevel terminology.
- Translate EXISTING content directly in this implementation session; do not send the existing catalog or private data to an external AI provider.
- Future new/changed text may use an external translator within a free quota, WITHOUT Base44 InvokeLLM, translation functions, cron, or automatic paid fallback.
- Keep language controls unobtrusive: one application language control, separate customer/document language, and compact bilingual editing where content is authored.
- Do not translate identifiers, amounts, currencies, phone numbers, email, URLs, document numbers, status values, signatures or customer names without an explicitly approved spelling.

## Safety and baseline
- Baseline commit: `1d6596509121b240e196cf6c16b35776f30a6b6f`.
- Restore checkpoint before implementation: `6af0ec8bb869076d24d89577`.
- No production payment, WhatsApp, email, push, signature, customer notification or provider inference is permitted as an incidental development test.
- No rewrite of stored Hebrew content; translated fields/snapshots are additive.
- Never put private customer notes, contacts or agreement text in the public GitHub repository. Runtime translations must have the same effective visibility as their source. Public UI dictionaries can contain UI labels only.
- Existing signed agreements and already-issued PDFs remain immutable; issuing a new English quote must not mutate an existing Hebrew document.
- Verify exact deployed state separately from build readiness. Do not mark untested behavior complete.

## Architecture decisions
1. A native React localization provider: locale `he` or `en`, default `he`, local preference, locale-aware text/date/number formatting and root direction. Explicit component translation, not Google page translation or DOM rewriting.
2. Keep operator UI language separate from the language of a customer, quote, invoice or agreement. Existing billing/closing language choices retain their semantics.
3. Optional English content alongside Hebrew for services, packages, quote templates and editable business text. Translation is tied to the exact source value/revision. On source changes, an old translation becomes stale rather than silently replacing the current meaning.
4. A small approved terminology glossary (Shirat HaNevel, Bar Mitzvah boy, Torah aliyah, ceremonial canopy, four-piece band, etc.). Unknown personal names require a human-entered English spelling; never invent one.
5. Customer-facing document assembly selects English text before rendering, preserves numeric fields and links, and adjusts only language-dependent direction/alignment. Missing/stale material is visible to the operator; never claim a fully English document when material is untranslated.
6. Future translation adapter is disabled until a real external endpoint and server authentication are configured. Endpoint failure, quota exhaustion, absent configuration or validation failure cannot erase source text or send incomplete client documents.
7. External worker must authenticate the existing app user, allow only authorized translation work, bound body size and rate, protect numbers/URLs/placeholders, return structured results, reject unsafe HTML/changed identifiers, and never expose a provider key to the browser. No Base44 integration call for translation. No unprotected public translation proxy.
8. External production deployment and free-tier consumption cannot be asserted before authorized Cloudflare access, live configuration and billing verification. Prepare code and tests even when account access is unavailable; report the dependency precisely.

## Implementation order and acceptance gates
| Phase | Work | Gate | Status |
|---|---|---|---|
| L10 | Map current source, content, quote/rendering and existing language support | File/entity inventory; no business writes | **Complete** |
| L20 | Native localization core and compact language selector | Hebrew default unchanged; English/LTR and Hebrew/RTL switching tests; no network on switch | **Implemented; live visual verification pending** |
| L30 | Translate existing catalog, packages and reusable quote content directly | Exact source reviewed, English added only, totals/names unchanged, coverage count | **Complete for Service 96, Package 3, QuoteTemplate 7, OrganizerType 1; custom event fields remain per-record** |
| L40 | Quote language choice and translated content assembly | English and Hebrew previews, PDF text/direction, preserved totals and URLs, original Hebrew document unchanged | **Implemented; synthetic tests passed; live PDF and edge-case visual QA pending** |
| L50 | Customer language and bilingual content maintenance | Source/translation stale detection; private data keeps permissions; no duplicate editor clutter | **Bilingual editors implemented; per-customer persisted preference not yet done** |
| L60 | Translate remaining fixed UI text explicitly | Coverage inventory; critical screens and mobile controls tested; no business-value translation | **Partial: navigation, ClientDashboard, SupplierCalendarDashboard, UserSettings, key quote UI. Remaining screens and mobile QA open** |
| L70 | External translation for future changes | Server authentication, quota/error handling, glossary/placeholder validation tests; deployment separately verified | **Protected Worker/client code prepared, synthetic auth/quota tests passed; Cloudflare account integration and deployment NOT DONE** |
| L80 | Regression, visual checks, checkpoint and release | Existing tests + new tests; build; differences restricted to localization; release evidence | **1,224/1,224 tests + build passed; production publication held for coverage, visual QA and external auth** |

## What NOT to change
Payment creation/callbacks, invoice amounts/VAT behavior, WhatsApp queues/buttons/webhooks, assignment decisions/status transitions, existing scroll fixes, notifications, calendar sync, RLS semantics, logos, colors, typography hierarchy, business pricing or service inclusions.

## Test matrix
- Default Hebrew, stored English preference, invalid preference fallback and immediate language switching.
- Mixed Hebrew/English names and numbers, LTR/RTL, dialogs/menus and mobile layout.
- User may operate in Hebrew and issue an English quote; switching UI does not alter document language.
- Exact source matching, changed-source detection, manual corrections protected from automatic overwrite.
- Translator offline/unconfigured/quota limit: no fake translation, no lost original, no paid fallback.
- Malicious translated HTML, changed numbers/links/placeholders and unapproved field names are rejected.
- Catalog translations never change IDs, quantity, tax, prices, event assignments or customer identities.
- Client/supplier receives only content already authorized by the original workflow.

## Execution log
### 2026-11-08 — Localization development session 2 (verified checkpoint candidate)
- **Translations migrated by assistant, no external AI calls:** 96/96 Service records, 3/3 Package records, 7/7 QuoteTemplate records, and the existing QuoteOrganizerType (organization/institution) title plus eight labels. 107 ContentTranslation records, exactly one per source, protected by admin-only RLS. Every translated field retains the exact Hebrew source. The 107-record audit found **zero stale source mismatches, number mismatches or URL mismatches**. No original Hebrew Service, Package, QuoteTemplate or organizer was rewritten.
- **Native locale structure:** src/i18n/{dictionary.js,LanguageProvider.jsx,LanguageSwitch.jsx,contentTranslations.js}, compact header language switch, local preference, fixed text dictionary. Explicitly translated existing navigation, client dashboard, supplier assignment calendar and settings entry labels without replacing dynamic customer data. **Fixed interface coverage is not yet complete**; many other pages still have hardcoded Hebrew, and a full visual RTL/LTR review is still needed. Do not advertise a fully translated interface yet.
- **Documents:** EventDetails now offers independent Hebrew/English quote language in the existing quote dropdown and a collapsed English event-content editor. generateQuote + generateQuotePdf use shared quoteHtml English rendering; old Hebrew flow is untouched. ModularQuoteEditor now stores independent document language and optional manually approved English fields/description, with validation on preview/share/PDF. Both preserve the exact financial values and refuse to generate an English document when client-visible translated text is missing or stale (422), rather than silently sending mixed-language content. Existing signed agreements, payment and invoices untouched. **Live PDF visual proof not yet performed.**
- **Content maintenance:** service/package editors and quote-template editor have collapsed English sections. Exact-source matching, review warnings and explicit editor saves prevent source changes from silently reusing outdated English. Event-specific names, personal spellings, schedules and bespoke notes remain manual-review fields; not falsely marked as pretranslated. Organization template field-ID placeholders remain in Hebrew for correct internal lookup and English headings are sourced from approved records.
- **Future external drafts:** cloudflare/translation-worker/{src/index.mjs,wrangler.example.toml,README.md,package.json}, client src/i18n/futureTranslationClient.js and optional EnglishDraftButton. Free Workers AI Gemma 4 26B + Cloudflare Access signed JWT, explicit admin email allowlist, origin restriction, KV daily counter, no paid fallback. No API key in browser. Drafts are not written until administrator approves them. Cloudflare Worker **NOT deployed** because there is no authorized connected Cloudflare account/team, protected host, KV and validated Access flow. VITE_TRANSLATION_WORKER_URL remains absent; draft buttons are hidden, not broken controls. Must test Safari/iOS third-party cookie and preflight before enabling.
- **Test results:** Node test suite **1,224/1,224 passed**, including English quote finance/RTL, source-staleness, custom organizer field IDs, Worker free quota/auth/unsafe responses; npm run build and git diff --check passed. ESLint of new UI helpers passed. Tests were synthetic/in-memory; no real customer message, actual PDF issuance, payment/WhatsApp action, or Cloudflare AI inference was performed.
- **Risk gates:** English UI still partly Hebrew in less common screens, no live browser visual QA, nonstandard custom templates need review, no external translator account connection, and no live document proof. Do not publish this version to production until the remaining gates are satisfied. Existing Hebrew production behavior is preserved on the previously published version.
- **Next safe steps:** complete explicitly translated fixed UI strings on all remaining administrator, supplier and customer pages; test screen width and RTL/LTR; add per-customer language preference and bilingual client card if justified without role/data leakage; verify HTML/PDF side-by-side in authenticated preview; connect Cloudflare account only with user's explicit action, confirm Workers Free and Access Free usage and authentication; then publish after a final checkpoint and independent regression test.

### 2026-11-08 — Planning saved before implementation
- Read the current app entry points and confirmed a React/Vite app with existing Hebrew/English billing and closing support.
- Base44 is idle/ready at the baseline commit.
- A prior discovery found no connected Cloudflare plugin; external deployment remains unverified. Do not substitute a paid Base44 AI call.
- Plan and restore point created before implementation. No business data changes, provider inference, client messages or document issuance performed.
- Next: inspect catalog schema and quote generation, then implement and test the additive localization layer.

### 2026-11-09 — Fixed-label completion in event cards and quote editors
- Restore checkpoint before edits: 6af0f7ffb291fe20ca6c5b14 (commit 2bfa4dabf6a73330b7c6dbe710c0665187e02426).
- Added fixed Hebrew/English labels to the central front-end dictionary, and connected explicit `useLanguage` calls in: AdminDashboard and stats, event cards, event overview and family cards, FinancialSummaryCard, PaymentsCard, EventDocumentsCard, ScheduleCard, ServicesCard, EventDetailsTabs, client/supplier portal cards (from prior session), manual quote lists and editors, modular quote details/visibility/item editing/preview/share, manual BlockAdder and BlockEditor, and quote-template management.
- Kept business records and actions intact. Labels are localized at render time, while event names, contact names, customer notes, prices, numeric values and provider actions remain source data.
- Quote assembly: extended fixed English labels for VAT, payment totals, balance, discounts, transport journeys, pickup stops, contacts, quantities, dates and client-facing sections. Source matching prevents stale/invalid translations.
- ManualQuote now stores `document_language` and `last_pdf_language`, preserving old PDFs while avoiding display of a Hebrew PDF as the current English file. English custom blocks and only relevant templates are source-checked before PDF generation.
- Corrected overvalidation of unrelated catalog services/templates: English quotes only need translations for items/templates included in the document. Included untranslated items still fail closed.
- Event bilingual editor now supports transport pickup locations, pickup contact names, on-site contact names, organizer custom fields and discount reason, in addition to normal name and schedule editing.
- QuoteShareLinks and QuoteWhatsAppButton take the document language so the default attachment caption is English for English modular quotes; user-authored WhatsApp captions remain editable.
- Automated coverage: 1,237 tests passed across all test suites; Vite build passed; git diff --check passed. Dedicated manual, modular and regular quote tests confirm English/RTL-LTR paths, figures and URL placeholders preserved, rejection of stale source, and no Hebrew fixed text leakage in standard and transport/discount quote fixtures.
- Dynamic personal/event data still requires administrator-approved English; this is intentional. The Cloudflare free translation Worker is source-only and disabled until verified owner-controlled Access/quota/hosting is configured.
- Not yet certified: browser visual testing on authenticated mobile and desktop; live PDF rendering against API2PDF (no production PDF was issued as a test); external translator deployment; proof of public production publish. Do not claim these are complete.
- Next gates: inspect live screenshot previews across role dashboards and Hebrew/English client quotes; test actual PDF in a non-customer test event; confirm publish state, then complete remaining lower-priority fixed UI labels and document-specific formatting.

### 2026-11-09 — Live data failure follow-up: fix scope and operator recovery (work in progress)
- Reported mobile production error: "The English quote has 11 untranslated or outdated content fields"; do not treat synthetic build tests as proof of production success.
- Live inventory: 96 catalog Service records and 7 QuoteTemplate records already have up-to-date translations, but 2,880 EventService snapshots contain many distinct per-event text variants. Catalog-only translation is insufficient.
- Root causes confirmed: EventService package_description often copies Service service_description (the old exact same-field fallback missed translations); HTML produced by different rich-text editor versions has equivalent visible text but different classes; hidden/admin-only fields and unused resources were sometimes validated; missing-content errors were surfaced as non-actionable browser alerts.
- Implement semantic-group exact-text reuse across service/package names/descriptions, display-only HTML canonical matching, and 85 assistant-reviewed reusable QuotePhrase records for common generic labels. Preserve source Hebrew, numbers, names, permissions, pricing and original document layout.
- Next work in this session: ensure normalized HTML fallback cannot silently degrade markup; show field-specific missing content and open a focused English translation dialog on 422 for preview/PDF/share, with stale checks and no automatic send; add further reusable professional translations for recurring historical text; run tests and build. Do not deploy to production until failures are reviewed on representative real-case fixtures.
- The Cloudflare translation Worker and Access are not deployed/connected. Never claim it works or send private client text to an unauthenticated public proxy. Activation requires owner authorization and service connection; fail closed in the meantime.
- Restore point before these changes: checkpoint 6af100d71efb27f76cf3905b, commit f78919ade992acd36477671ff5c83da221ab911a.

