# Pulse: bilingual event closing and softer client communications
Date: 2026-11-09. App: 687d1de6659eff83e9c034f7. Source plan: docs/pulse-multilingual-he-en-plan-2026-11-08.md.

## WhatsApp assignment callback prerequisite
Read-only production verification after owner reported recovery:
- 9 new inbound decision receipts on Nov 9: six approvals applied, three genuine business state conflicts correctly rejected.
- All nine produced one feedback outbox job accepted by Green.
- WhatsApp central queue active, unpaused and operational.
- No new Green GetSettings, webhook provisioning, restart, retry, synthetic send or mutation was performed. A fresh *successful supplier reject* click was not sampled, so do not claim newly exercised reject success beyond previous verified functionality.

## Implemented, no old agreement mutation
1. Introduced base44/shared/customerMessageTone.ts with friendly bilingual assistant-authored default COPY for:
   - Customer agreement invitation, OTP verification, signed agreement PDF caption;
   - Agreement milestone reminders (amount, currency, agreed due date, office contact);
   - New hosted payment link, link-expiry reminder, payment receipt;
   - New payment link and reminder email SUBJECTS.
   Original legal clauses on card authorizations, service fees, timing/caps, deposits, provider verification and signed document are left intact.
2. Normalized two EXACT legacy harsh saved PaymentMilestone defaults at time-of-send only (not when reading/updating signed snapshots). All operator-edited templates remain intact. English message preference does not send a Hebrew fallback template: it uses reviewed English text.
3. Wired reusable copy to base44/shared/{closingLanguage.ts,agreementRules.ts,agreementLifecycle.ts,clientBillingMessages.ts}, Base44 functions eventAgreement, invoice4uCreateClearingRequest, processPaymentLinkLifecycle, and collapsed admin editors (ClosingSettings, BillingPaymentLinkSettings, BillingLifecycleSettings). Did not alter any job schedules, queue idempotency keys, retries, cards, invoice prices, user data or money.
4. Public EventClosing view:
   - Language choices on authenticated-link **open**, before OTP. English OTP when user selects English and the snapshot has approved English legal text.
   - Preserves user language selection through verification; retains separate agreement, message and operator UI locales.
   - Friendly English/Hebrew signing, step-by-step explanatory copy, errors and exit prompts; prevents suggestion to repeat uncertain payment/WhatsApp operations.
5. Event closing English content:
   - Compact customer quote summary now uses exact-source approved English EventService name and package names, including included package services, from shared ContentTranslation/QuotePhrase index. Service names without current approved translation are surfaced as missing and block English issuance, not machine translated.
   - Event title explicitly resolves approved Event event_name translation or fixed glossary English label (personal names require human review).
   - Each snapshot carries per-locale event title, quote text, structured quote summary, PDF reference, and English-verified bank details. The signed snapshot remains immutable, and localizedAgreement/localizedSnapshot select matching material instead of showing Hebrew rows on an English form.
   - Stored Hebrew bank instructions require a distinct verified English version where they contain Hebrew; matching numeric account and branch tokens are a prerequisite. No guessed beneficiary spellings or account number changes.
   - QuoteHistory now labels newly generated quote PDFs with document_language he/en (both standard and manual/modular); an unlabelled historical quote or an explicitly Hebrew PDF is never offered as though it were an English PDF. Hebrew quote history remains visible as previously. When no English PDF is identified, the operator sees a warning and can issue an English quotation.
   - English agreement issuance is blocked with visible actionable missing fields when translations, bank data or English terms are incomplete, without blocking Hebrew workflow.
6. Administration:
   - All Hebrew fixed labels in BillingConfiguration, ClosingSettings, EventClosingPanel, ClosingLanguageFields and MilestoneScheduleEditor now map to an English UI equivalent, including audit event names, confirmation states, invoice and refund dialogs, financial limits and bank labels. Page/dialog direction follows the operator's selected UI language.
   - Existing immutable signed legal authorizations remain explicit, not euphemized. Text does not imply that a security card is itself charged when only being stored.
7. Security and reliability:
   - No new unauthenticated public endpoint or foreign translation service.
   - No email, WhatsApp, signature, approval, bank/payment charge or invoice was sent/created by testing.
   - The separate CLIENT_PAYMENT_REMINDER NotificationTemplate was kept **inactive**, with its scheduling, allowed channels, reminder interval, frequency and maximum sends unchanged. After release, its Hebrew title, body and WhatsApp text were updated once in production data using exact-current-value conditional filtering to softer "תזכורת קטנה" wording, preserving all three placeholders (event_name, event_date, balance). Read-only re-query confirmed is_active=false, unchanged 7-day interval and max 4. This disabled legacy route still needs an explicit English-recipient language setting and English template variants **before any future activation**. The active milestone and payment-link reminders are independently bilingual.
   - No Cloudflare/free external Worker deployed: remains an explicit separate integration dependency.

## Verification
- 8 new closing HE/EN tone, placeholders, legacy custom override, quote language and source immutability tests in tests/closing-bilingual-gentle-tone.test.mjs.
- 2 new complete admin closing label/direction tests in tests/closing-admin-locale-completeness.test.mjs, scanning fixed Hebrew literal coverage.
- Existing eventAgreement end-to-end synthetic tests: OTP, signing, stale snapshots, deposit/card gating, wrong code, no duplicate delivery and no double charging. Existing quote and phone/WhatsApp queue suites untouched.
- Last complete pre-release gate: **1,306 / 1,306 tests passed**, npm run build passed, targeted ESLint for all touched files passed, git diff --check clean.
- NO real customer testing, real signed PDF issuance or physical PDF page-by-page visual QA has occurred. Final client/browser acceptance and manual legal review of actual configured English terms remain separate. Lack of an English PDF in old history is intentionally conservative, not a regeneration bug.
- Keep the previously fixed EventDetails blank-screen and supplier operational cards under regression/smoke checks after deploy.

## Safe next actions (uncompleted)
- Confirm deployment's exact checkpoint/commit and app status, anonymous no-leak route smoke + read-only admin event card.
- Authenticated owner test of English EventClosing in a disposable/noncustomer event, including comparison of bilingual signed PDF, bank instruction styling and no physical-page overflow; do not charge or send.
- Complete app-wide L60 localization outside the closing modules and preexisting fixed UI. Cloudflare future-translation Worker L70 cannot go live until protected account, KV, team allowlist, quota and authentication are configured and authorized.
- Later optional: expand bilingual user notification preferences and add English variants to the still-disabled legacy CLIENT_PAYMENT_REMINDER template, with explicit enabled-flow parity tests before any future activation. The Hebrew inactive copy has already been softened without activating any notification automation.

## Verified production deployment / no-customer smoke
- Code release checkpoint 6af22e82fd0380af17f84928, commit b38f28db79eb73c577d012934901a9ea6bbde8a3, deployed at 2026-11-09T20:35:34.937526Z to https://pulse-system.base44.app.
- Published URL and app status both verified; production ready. Subsequent automatic commits were documentation-only, and the quoted code release included all changes before deployment.
- An anonymous POST to production eventAgreement preview/list with a synthetic nonexistent ID was denied HTTP 403. Public GET without signed_quote proof returned HTTP 404 as designed; no agreement data was leaked, no customer status changed.
- Fresh read-only browser flow 6af22ec0d94bdf58e4f8c17f, execution 6af22ec2d2e766a400bc9d1f, completed successfully on 2026-11-09T20:38:25.157Z. With an authorized admin test account it opened Events, selected an event card, saw title/status/four tabs, and opened financial summary showing payments/totals. No blank screen or JS error, no clicks on save/issue/sign/charge/send. Runtime reported 2.1 test credits.
- Real authenticated public EventClosing in both languages was not exercised; no signed PDF or payment simulation was performed against live accounts. English legal copy must still be reviewed by an authorized human before business deployment of English agreements.
