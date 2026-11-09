# Pulse — Hebrew/English quotation visual parity (2026-11-09)

## Owner's design invariant

An English quotation is the Hebrew quotation rendered with English business text, **not a newly laid-out document**:
- Hebrew right alignment → English left alignment; Hebrew left → English right.
- Centered titles, event headers, introductions, centered passages and footer remain **centered**. Justified text stays justified.
- Bold, italics, underlines, structural headings, font sizes, line heights, colors, page margins, borders, background imagery, package sections, financial table structure, spaces and break rules remain the same, except that left/right physical positioning mirrors to the other side.
- Same source document and settings, same quote language choice independent of user-interface language.
- Never modify source event, customer, payment, account number, financial amount or Hebrew catalog/template data.

## Root cause

The earlier English-only CSS injected by `applyDocumentDirection` in `base44/shared/quoteLocalization.ts` forcibly set `.section,.event-details-box,.intro-content,.payment-terms,.event-notes` to `text-align:left` and forced some other alignments. This destroyed Hebrew **centered** presentation when switching to English, and did not consistently mirror manually authored headings or rich-text alignment. Quill-specific `ql-align-center` classes were not explicitly supported in the PDF stylesheet.

## Applied source changes

1. New read-only `base44/shared/quoteLayoutMirror.ts`. Operates ONLY on final outgoing English HTML (not stored fields or source document):
   - Mirrors `text-align:right/left`, `float`, `clear`, physical `padding/margin/border/left/right` and corner styles in CSS style blocks and quoted inline `style` attributes;
   - Mirrors legacy `align=` and `dir=rtl` attributes, using a quote-aware HTML opening-tag scanner so `>` within URLs/attributes is not split.
   - Leaves `text-align:center/justify`, `font-weight`, `font-size`, `line-height`, HTML tags `<strong>`, `<em>`, `<u>`, colors, image URLs and all text unchanged.
2. `applyDocumentDirection` now uses this presentation mirror, removes the blanket `text-align:left` override and only sets LTR base direction. Adds English-only equivalents for `ql-align-center/right/left/justify` and `ql-direction-rtl` (original class names remain unchanged).
3. All three quote composers already share `applyDocumentDirection`: automatic `quoteHtml.ts`, manual `generateManualQuotePdf/entry.ts`, modular `modularQuote.ts`. No parallel English-only templates were introduced.
4. `translationPreservesProtectedContent` also safeguards markup sequence, emphasis tags, HTML blank-line paragraphs, Quill paragraph alignment classes and inline presentation styles. A new or edited English translation with lost formatting is rejected and returned for human review rather than silently producing a differently formatted document.
5. `indexedText` retains existing legacy-copy matching for event services but now copies presentation attributes from the *actual current Hebrew event paragraph* onto the matching reviewed English paragraphs, so copied Quill descriptions remain correctly aligned without requiring external machine translation.

## Existing approved rich content QA

Read-only audit before migration found 504 ContentTranslation rows / 729 approved English field pairs, of which 219 had HTML. Ten existing approved records differed structurally, mainly missing empty spacer paragraphs (`<p><br></p>`), one empty bold wrapper, a span color wrapper and a direction-only span; two also omitted the Hebrew template's Quill paragraph alignment classes.

Completed source-preserving format-only backfill on those ten existing `ContentTranslation` records:
- Restored the original visible paragraph breaks/blank lines and equivalent style tags in English.
- Restored the same Quill paragraph alignment metadata where missing.
- Removed one unnecessary direction-only span while preserving its English words.
- Before each update, verified the text with HTML tags stripped was unchanged. Updates used exact record/old-value filters.
- **Did not change any translated words, prices, bank names/numbers, hyperlinks, Hebrew originals, Event, EventService, Service or QuoteTemplate source.**

Read-only audit after the corrections: **729/729 approved field pairs inspected, 219/219 rich HTML fields have matching tag order, Quill alignment classes and inline presentation attributes**. Existing approved texts that do not have HTML are unchanged.

## Regression and publication acceptance

- New `tests/english-quote-layout-parity.test.mjs`: seven tests for regular/manual/modular quotes, CSS and HTML legacy align attributes, `ql-align` rich text, inline center vs side alignment, bold/underline/italics, borders/padding, finance tables, document page margins, and loss of rich formatting.
- Extended `tests/multilingual-quote-compatibility.test.mjs` to check source-presentation inheritance on historical Quill service copies.
- Current complete gate: **1,282/1,282** Node regression tests passed, Vite production build passed, targeted eslint zero errors and `git diff --check` clean.
- Historical Hebrew document generation remains byte-identical in the direction helper. No real API2PDF, customer charge, WhatsApp delivery, document signature or event data mutation occurred as part of test execution.
- Visual layout is consistent by computed-style tests, but real PDF pagination can naturally vary if English wording occupies more or fewer lines than Hebrew. Final physical PDF visual check with a noncustomer test event and API2PDF remains an acceptance step that requires an authenticated browser / authorized PDF operation.
- Preserve previously fixed EventDetails authentication hook, and perform a read-only event-card smoke check after deploying this checkpoint to ensure the white-screen incident has not returned.
