# Pulse: bilingual event closing and softer client communications
Date: 2026-11-09. App: 687d1de6659eff83e9c034f7. Source plan: docs/pulse-multilingual-he-en-plan-2026-11-08.md.

## WhatsApp assignment callback prerequisite
Read-only production verification after owner reported recovery:
- 9 new inbound decision receipts on Nov 9: six approvals applied, three genuine business state conflicts correctly rejected.
- All nine produced one feedback outbox job accepted by Green.
- WhatsApp central queue active, unpaused and operational.
- No new Green GetSettings, webhook provisioning, restart, retry, synthetic send or mutation was performed. A fresh *successful supplier reject* click was not sampled, so do not claim newly exercised reject success beyond previous verified functionality.

## Implemented, no old agreement mutation
1. Introduced base44/shared/customerMessageTone.ts with friendly bilingual owner-reviewed default COPY for:
   - Customer agreement invitation, OTP verification, signed agreement PDF caption;
   - Agreement milestone reminders (amount, currency, agreed due date, office contact);
   - New hosted payment link, link-expiry reminder, payment receipt;
   - New payment link and reminder email SUBJECTS.
   Original legal clauses on card authorizations, service fees, timing/caps, deposits, provider verification and signed document are left intact.
2. Normalized two EXACT harsh 48-hour era saved PaymentMilestone defaults at time-of-send only (not when reading/updating signed snapshots). All operator-edited templates remain intact. English message preference does not send a Hebrew fallback template: it uses reviewed English text.
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
   - Disabled CLIENT_PAYMENT_REMINDER NotificationTemplate was not activated or modified. If this old separate feature is activated later, it still requires a bilingual, friendly template audit to avoid the legacy hard wording. The active milestone and link reminder sources have been updated.
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
- Later optional: expand bilingual user notification preferences and update the still-disabled legacy CLIENT_PAYMENT_REMINDER template in both languages only with explicit enabled-flow parity tests and without changing is_active.
