# Pulse — 2026-11-09 — English quotation's hidden Hebrew text repair

## Incident

An English quote failed with the iPhone modal `Complete English Quote Content`, `document.visible_text`, and a Hebrew snippet `אבי תמים הפקות`, but no actionable field. The cause was an **approved** `ContentTranslation` row for QuoteTemplate payment terms (`source_id: 68c8209c308735d7504b8e19`, `fields.content`) whose English target text contained `<span dir="rtl">אבי תמים הפקות</span>`. A scan of 504 saved translations revealed no other approved English target with visible Hebrew after ignoring protected template placeholders.

The previous translation validator had permitted a partially translated English target and only rejected it at final output assembly. The editor showed only source fields explicitly in `missingFields` and could not associate `document.visible_text` with the approved template.

## Applied changes

- `base44/shared/quoteLocalization.ts`: checks that approved English targets contain no **rendered** Hebrew, but preserves protected Hebrew placeholder IDs as opaque runtime identifiers. A bad approved template now yields `template.<id>.content` before PDF issuance, not an orphaned final-document error. Original amounts, URLs, numbers, references and rich HTML remain validated.
- `src/components/event-details/EventQuoteEnglishDialog.jsx`: surfaces approved QuoteTemplates when they need repair and expands their sections when translation is blocked. For an English target with a Hebrew text node, a compact inline editor lets an authorized admin enter just that phrase in English and apply it to the English draft, followed by normal Save Translations. It rechecks the current Hebrew source and protected content before saving. No changes to original Hebrew QuoteTemplate or bank account details.
- `src/i18n/quoteEnglishReviewHelpers.js`: extracts untranslated visible Hebrew from English rich text and replaces only full matched text nodes, not tags or attributes. Safe replacement refuses HTML injection and Hebrew.
- Legacy fallback: if the final assembled English document contains an orphan Hebrew text fragment with no editable originating field, the dialog can offer an event-scoped exact-source English override as a new field of that event's existing `ContentTranslation` row. `applyReviewedEventQuoteFragments` applies approved overrides ONLY to exact visible HTML text nodes, never attributes, comments, scripts, styles or another event. It keeps the final no-Hebrew guard; ambiguous/unsafe overrides fail closed. Visible excerpts now capped at 640 chars and incomplete/truncated fragments cannot be approved blindly.
- Updated regression expectations to require source-specific validation rather than waiting for the generic final HTML error. Added `tests/english-quote-actionable-remnants.test.mjs` for payment-term bank-holder and orphan-text recovery, immutable amounts and source, invalid target rejection, renderer-only entity encoding and event scoping.

## Verification and release gates

- Last complete local check: `npm run build` succeeded; **1,273 / 1,273** Node tests passed, `git diff --check` clean, targeted ESLint zero errors.
- Verified no payment charge, WhatsApp send, real PDF, customer event modification or automatic rewording of bank beneficiary was performed. Existing Hebrew original untouched. The official English spelling of the beneficiary must be supplied and approved by the administrator; no automatic guess.
- Future external translation via Cloudflare remains **unconnected**; that dependency is separate from this fix.
- Live authenticated iPhone/desktop PDF end-to-end visual acceptance could not run from the available sandbox without user session, and should be verified by the administrator after release.
