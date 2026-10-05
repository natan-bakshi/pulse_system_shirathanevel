# Client closing guidance — 2026-10-05

Scope: Shirat HaNevel / Pulse, app 687d1de6659eff83e9c034f7.
Before checkpoint: 6ac3587a0a45f3b32a9d962c, commit 5bad15b10b04fa1ae00f805f6ff6c6f8f924c735.

## Implemented
- Hebrew and English plain-language security-card explanation. No routine/automatic collection; provider stores full card details, office uses a secure identifier under signed permissions. Deposit card payment is separate.
- Intro dialog after identity verification and before the agreement, showing only configured steps and actual fee settings. Can be reopened.
- Outstanding-step banner, including bank transfer awaiting receipt/recording. Native beforeunload warning while incomplete; custom confirmation for same-window links. Intentional provider redirects bypass the exit warning.
- No-card routes omit token, regular and exceptional card authorizations, and fee clause when no deposit is required. Unsigned legacy versions are normalized under the agreement lock with a new content hash; signed snapshots/PDFs are not rewritten.
- Card limits/notices hidden in no-card summaries and omitted in PDFs without a token-consent clause. Deposit fee information remains where an actual card deposit option exists.
- Removed payment-only auto-confirmation from EventDetails payment entry and EventForm save.
- New explicit admin payment-only approval in event management. Waives signature AND card, records actor/time, and allows closing after a positive completed payment. Pending payments do not count; manual status overrides retain priority. New agreement clears this approval.
- No new scheduled jobs, provider polling, messages or live card charges.

## Validation
- Vite production build passed.
- 92 offline tests: 91 passed; 1 pre-existing schema assertion failed. The failing test expects direct agreement writes to be false, but actual schemas grant admin writes. Verified this exact schema existed at the pre-change checkpoint; permissions were not changed in this task.
- Added behavioral tests for bank payment not bypassing unsigned/card-incomplete agreements, admin-only waiver, pending money, manual status priority, new-version reset, multilingual omitted clauses, immutable signed snapshots, unfinished steps, fee text, and hidden card limits.
- Existing PDF fixture generated and both pages rendered/visually inspected; text and layout readable, links retained.
- Event schema semantic comparison: only three requested waiver fields added; existing field definitions and RLS unchanged (Base44 reformatted schema).

## Remaining verification / limits
- Publish frontend in Base44 to expose changed components on the public site.
- Full browser interaction was not exercised in this session. Browser-controlled close/tab warnings have generic wording and are not guaranteed on every mobile browser; in-page outstanding-step summary remains visible.
- No live customer, card or payment was used for tests.
- Existing direct-write schema/test mismatch remains for a separately authorized permissions review.
