// WasenderAPI session-scoped WhatsApp transport.
// Reference: https://api.wasenderapi.com/api-docs/messages/send-text-message
// Only store the Session API Key in Base44 server-side Secrets (never in frontend or git).
const BASE_URL = 'https://www.wasenderapi.com';
const TIMEOUT_MS = 15000;

export function isWasenderConfigured() {
  return !!Deno.env.get('WASENDER_API_KEY');
}

export function getWhatsAppActiveProvider() {
  return String(Deno.env.get('WHATSAPP_ACTIVE_PROVIDER') || 'green').trim().toLowerCase() === 'wasender'
    ? 'wasender'
    : 'green';
}

export function hasWhatsAppProviderCredentials() {
  return getWhatsAppActiveProvider() === 'wasender'
    ? isWasenderConfigured()
    : !!(Deno.env.get('GREEN_API_INSTANCE_ID') && Deno.env.get('GREEN_API_TOKEN'));
}

function toWasenderRecipient(chatId: string) {
  const input = String(chatId || '').trim();
  if (/^[0-9A-Za-z_-]+@g\.us$/.test(input)) return input;
  const digits = input.replace(/@c\.us$/, '').replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) throw new Error('Invalid WhatsApp destination');
  return '+' + digits;
}

function wasenderError(status: number, uncertain: boolean) {
  const error = new Error('WhatsApp provider request failed') as Error & { errorCode: number; deliveryUncertain: boolean };
  error.errorCode = status || 502;
  error.deliveryUncertain = !!uncertain;
  return error;
}

async function requestWasender(path: string, { method = 'GET', payload }: { method?: string; payload?: Record<string, unknown> } = {}, alreadyRetriedRateLimit = false) {
  const token = Deno.env.get('WASENDER_API_KEY');
  if (!token) throw new Error('WasenderAPI session key not configured');
  let response;
  try {
    response = await fetch(BASE_URL + path, {
      method,
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json' } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (e) {
    console.error('[WasenderAPI] transport error:', e instanceof Error ? e.name : 'error');
    throw wasenderError(502, true); // Unknown whether the provider accepted the request.
  }
  let data: any = null;
  try { data = await response.json(); } catch (_) {}
  // 429 is an explicit rejection: this one retry cannot create a duplicate accepted send.
  // Paid Account Protection permits one send each five seconds; stagger bursts from separate invocations.
  if (response.status === 429 && method === 'POST' && path === '/api/send-message' && !alreadyRetriedRateLimit) {
    const jitterMs = 1200 + Math.floor(Math.random() * 1800);
    const delayMs = 5800 + jitterMs;
    console.warn('[WasenderAPI] Rate-limited; one bounded retry after backoff');
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return await requestWasender(path, { method, payload }, true);
  }
  if (!response.ok || data?.success === false) {
    console.error('[WasenderAPI] request rejected; httpStatus=' + response.status);
    // 5xx may have accepted the message before returning an error.
    throw wasenderError(response.ok ? 422 : response.status, response.status === 408 || response.status >= 500);
  }
  return data;
}

export async function sendWasenderTextToChat(chatId: string, message: string) {
  const data = await requestWasender('/api/send-message', {
    method: 'POST',
    payload: { to: toWasenderRecipient(chatId), text: message }
  });
  if (data?.success !== true || data?.data?.msgId == null) throw wasenderError(502, true);
  const messageId = String(data.data.msgId);
  return { success: true, provider: 'wasender', messageId, idMessage: messageId, deliveryStatus: 'accepted' };
}

export async function sendWasenderDocumentToChat(chatId: string, documentUrl: string, fileName: string, caption: string) {
  const data = await requestWasender('/api/send-message', {
    method: 'POST',
    payload: { to: toWasenderRecipient(chatId), documentUrl, fileName, text: caption || '' }
  });
  if (data?.success !== true || data?.data?.msgId == null) throw wasenderError(502, true);
  const messageId = String(data.data.msgId);
  return { success: true, provider: 'wasender', messageId, idMessage: messageId, deliveryStatus: 'accepted' };
}

// Read-only status: validates the Session API Key without sending WhatsApp messages.
export async function checkWasenderSessionStatus() {
  if (!isWasenderConfigured()) return { configured: false, status: 'not_configured' };
  try {
    const data = await requestWasender('/api/status');
    const status = String(data?.status || data?.data?.status || 'unknown').toLowerCase();
    return { configured: true, status, connected: status === 'connected' };
  } catch (error) {
    return { configured: true, status: 'error', connected: false, errorCode: error && typeof error === 'object' && 'errorCode' in error ? Number(error.errorCode) : 502 };
  }
}
