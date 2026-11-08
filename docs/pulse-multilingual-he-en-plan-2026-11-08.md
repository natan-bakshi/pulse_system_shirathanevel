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
| L10 | Map current source, content, quote/rendering and existing language support | File/entity inventory; no business writes | In progress |
| L20 | Native localization core and compact language selector | Hebrew default unchanged; English/LTR and Hebrew/RTL switching tests; no network on switch | Pending |
| L30 | Translate existing catalog, packages and reusable quote content directly | Exact source reviewed, English added only, totals/names unchanged, coverage count | Pending |
| L40 | Quote language choice and translated content assembly | English and Hebrew previews, PDF text/direction, preserved totals and URLs, original Hebrew document unchanged | Pending |
| L50 | Customer language and bilingual content maintenance | Source/translation stale detection; private data keeps permissions; no duplicate editor clutter | Pending |
| L60 | Translate remaining fixed UI text explicitly | Coverage inventory; critical screens and mobile controls tested; no business-value translation | Pending |
| L70 | External translation for future changes | Server authentication, quota/error handling, glossary/placeholder validation tests; deployment separately verified | Pending |
| L80 | Regression, visual checks, checkpoint and release | Existing tests + new tests; build; differences restricted to localization; release evidence | Pending |

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
### 2026-11-08 — Planning saved before implementation
- Read the current app entry points and confirmed a React/Vite app with existing Hebrew/English billing and closing support.
- Base44 is idle/ready at the baseline commit.
- A prior discovery found no connected Cloudflare plugin; external deployment remains unverified. Do not substitute a paid Base44 AI call.
- Plan and restore point created before implementation. No business data changes, provider inference, client messages or document issuance performed.
- Next: inspect catalog schema and quote generation, then implement and test the additive localization layer.
