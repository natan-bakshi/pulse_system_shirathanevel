# Pulse / Shirat HaNevel — Urgent Green assignment button incident — 2026-11-09

## Scope and owner priority
The owner paused all ongoing bilingual closing/payment tone work and asked for an immediate repair of supplier WhatsApp Approve/Reject buttons, incoming Green webhook, and WhatsApp confirmation/failure feedback. Details to resume translation are fully recorded in \`docs/pulse-multilingual-he-en-plan-2026-11-08.md\` section "PAUSED by owner".

Only Pulse app \`687d1de6659eff83e9c034f7\` is in scope. No real supplier status may be changed, no provider SetSettings/reboot without owner authorization, and no synthetic WhatsApp messages to real people.

## Real production read-only findings
- Central WhatsApp queue: enabled and unpaused. Interactive outbound and production assignment inbound historical switches: enabled. Green remains default provider.
- Two **new** assignment Outbox records dated 2026-11-09 around 13:10 UTC are \`accepted\` by Green, with signed interactive v1 button snapshots, assigned sender-account identity and source revisions. Earlier accepted interactive messages were also found.
- Last durable \`WhatsAppInboundReceipt\` is 2026-11-04; 29 prior receipts show approvals/rejections did work, and their feedback jobs were accepted by Green. No receipts or feedback from after Nov4.
- No \`WhatsAppInboundQuarantine\` records. Inbound rate-budget counter was incremented on Nov9, but that is NOT proof a current click was durably accepted; it could result from a rejected/unknown inbound payload.
- Current published webhook route responds to GET with HTTP 405 \`{"received":false}\`: route exists, NOT a proof Green has the correct URL, correct webhook Bearer, incomingWebhook enabled, or that a signed POST works.
- Owner-only Green GetSettings read-only action exists in Pulse > Settings > Notifications > WhatsApp > Advanced > "בדוק קליטת תגובות (Webhook)". Attempted read-only browser test using a generic admin test identity. It was denied access to system SettingsPage; NO provider GetSettings was performed, so actual Green webhook settings remain UNKNOWN. Do not assume configured or broken; owner session is required.
- Production backend log API did not expose any \`greenAssignmentButtonQaWebhook\` logs for the requested period. This does not establish whether callbacks reached another route or were dropped.

## Deterministic source bug and read-only historical verification
\`base44/shared/whatsappButtonBindings.ts\` issued every V1 supplier approve/reject action with a **48-hour HMAC expiration** (\`issuedAt + 2 days\`) even though assignments can legitimately remain unanswered beyond that time. After expiry, \`resolveVerifiedGreenActionForButton\` and \`preflightWhatsAppAssignmentResponse\` rejected the clicked signed action before writing \`WhatsAppInboundReceipt\` or any confirmation feedback. Outbound text/buttons could still be Green-accepted.

Decoded only the expiry metadata of actual accepted Outbox signed snapshots without disclosing their payloads. Among 44 reviewed accepted Green interactive messages, **42 already had expired action tokens** as of Nov9 ~13:30 UTC; 2 new Nov9 messages remained valid. This proves a genuine failure for old-button clicks but **does not yet explain any failure of the two fresh buttons**, which may have webhook routing/auth/config or callback format issues.

## Surgical fix staged in sandbox
1. New supplier reply button actions issue with a hard **30-day** HMAC expiry instead of 48h. The original sender account, accepted Outbox message, supplier phone, provider sender, assignment status, revision and one-time receipt CAS remain mandatory. No unconditional approval and no action without Green provider authentication.
2. For cryptographically valid **historical** 48-hour token snapshots already received by suppliers, the authenticated Green callback path alone may accept the original signed action for up to 30 days since issuance **only if the HMAC contains exactly the old 48-hour lifetime**. Direct verification, untrusted UI calls, other token lifetimes and callbacks after day 30 still fail. Already decided/cancelled/reassigned supplier records cannot be changed; duplicate callback writes remain prevented.
3. Existing Green callback handler now emits **sanitized status/stage/reason codes for non-200 authenticated admission outcomes**. No raw provider event, phone, chat, message ID, token, or response body. This enables future targeted error diagnosis without logging private chat content.
4. Existing owner-triggered **read-only** Green GetSettings display now shows exact **configured endpoint match** and **webhook Bearer match**, in addition to webhook present and incomingWebhook enabled. It explicitly says a live supplier click is still required to prove end-to-end processing. No SetSettings, no webhook URL mutation or automatic provider polling.
5. Tests updated/new for historical and new expiry, forged Bearer rejection, source/status integrity, and owner UI diagnostic. App's localization dictionary was updated for the new UI strings so English UI coverage remains intact.

## Verification & limits
- Focused tests: 38/38 passed following TTL fix; subsequently all 1,288 existing tests passed before adding the final owner UI regression; a final full gate after that test is required.
- No real message was sent, no supplier decision was changed, no webhook settings were altered, no token/phone was returned.
- Before claiming FULL RESTORATION, the real system owner must perform **one read-only Green GetSettings check** through system-owner Settings and report only the safe booleans: webhook configured, incoming notifications enabled, exact target match, exact Bearer match. If any mismatch, plan an explicit reversible owner-authorized correction without unintentionally rebooting the active Green instance or losing other provider callbacks. After that use ONE owner-approved legitimate supplier click and check that a durable receipt appears and an acknowledgement is queued/accepted once, without double sends.
- DO NOT claim backend fix alone proves Green provider callback push is functioning; there are new Nov9 accepted messages that were not expired and have not produced receipts. Do not automatically reissue all pending assignments: would cause duplicate messages.
- Once a provider callback is healthy, inspect the sanitized webhook return codes from recent genuine clicks. Unsupported beta callback shapes should be investigated against Green's documented format without trusting user-supplied payloads or weakening HMAC/source verification.

## Additional owner diagnostic and final gate
The single existing **owner-clicked** Green GetSettings request also returns a **sanitized boolean** \`serverInboundCredentialsReady\` derived from trusted backend Green production passive receiver gates (owner approval, Green instance/API token, distinct Webhook bearer and action signing secret, inbound feature enabled). The UI displays this together with exact endpoint match, exact bearer match, and \`incomingWebhook=yes\`. The check does NOT alter the Green configuration or contact a supplier and does not require extra reads beyond the one owner GetSettings call. It cannot on its own prove actual provider callback delivery.
- Complete tests after this improvement: Vite build passed; **1,289 of 1,289** Node regression tests passed; targeted ESLint passed, and \`git diff --check\` clean.
