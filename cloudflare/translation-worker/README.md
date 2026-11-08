# Pulse multilingual: optional Cloudflare translation drafts

Status: CODE ONLY. Not deployed, authorized or configured.

This independent Worker provides drafts for FUTURE texts only. Existing catalog,
packages and quote templates are manually translated inside ContentTranslation.

## Required activation (Cloudflare owner login)

- Keep Cloudflare Workers on the FREE plan; do not configure a paid fallback.
- Create a Cloudflare Zero Trust Access application restricted to authorized admins,
  protecting the exact Worker hostname; deny unprotected workers.dev aliases.
- Clone wrangler.example.toml to wrangler.toml and replace team, audience and
  quota KV namespace values, and set ALLOWED_EMAILS as a Worker secret.
- Deploy using wrangler after signing in to the owner's Cloudflare account.
- Set the Base44 Vite environment variable VITE_TRANSLATION_WORKER_URL to the
  protected HTTPS origin. Avoid introducing Base44 backend functions or InvokeLLM.
- Test Cloudflare Access login, cross-origin OPTIONS and credentials handling,
  particularly on Safari/iOS and Android. Browsers may block third-party cookies;
  fail closed and do not enable this flow unless verified.
- Compare at least 30 actual business texts with the in-house approved glossary.

API: POST /translate; JSON body with source and kind. The response is a
DRAFT only. Never silently store it or publish it without an admin review.
Rate limiting uses per-user Cloudflare KV; no customer text stored in KV.
Worker does not log message content or customer identifiers.

If Access, quota KV, model or origin are missing, the endpoint is disabled.
If a model changes numbers, URLs, placeholders, or HTML tags/attributes,
the draft is rejected. Hebrew originals remain unchanged. No credit card
charge, business write, customer notification or quote is made by this code.

Official docs:
https://developers.cloudflare.com/workers-ai/platform/pricing/
https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/
https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
