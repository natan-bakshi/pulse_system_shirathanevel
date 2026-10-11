import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getWhatsAppActiveProvider, hasWhatsAppProviderCredentials, checkWasenderSessionStatus,
  sendWasenderTextToChat, sendWasenderDocumentToChat
} from '../base44/shared/wasenderSend.ts';

const env = {};
globalThis.Deno = { env: { get: (key) => env[key] } };
const originalFetch = globalThis.fetch;
function mockResponse(obj, status = 200) {
  globalThis.fetch = async (url, init = {}) => {
    assert.ok(url.startsWith('https://www.wasenderapi.com/api/'));
    return { ok: status >= 200 && status < 300, status, json: async () => obj };
  };
}
test.after(() => { globalThis.fetch = originalFetch; delete globalThis.Deno; });

test('defaults safely to the unchanged Green API', () => {
  assert.equal(getWhatsAppActiveProvider(), 'green');
  assert.equal(hasWhatsAppProviderCredentials(), false);
  env.WHATSAPP_ACTIVE_PROVIDER = 'wasender';
  assert.equal(getWhatsAppActiveProvider(), 'wasender');
  assert.equal(hasWhatsAppProviderCredentials(), false);
  delete env.WHATSAPP_ACTIVE_PROVIDER;
});
test('status reports missing key without hitting a provider', async () => {
  assert.deepEqual(await checkWasenderSessionStatus(), { configured: false, status: 'not_configured' });
});
test('status uses per-session Bearer key and never sends', async () => {
  env.WASENDER_API_KEY = 'synthetic-test-key';
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://www.wasenderapi.com/api/status');
    assert.equal(init.method, 'GET');
    assert.equal(init.headers.Authorization, 'Bearer synthetic-test-key');
    return { ok: true, status: 200, json: async () => ({ status: 'connected' }) };
  };
  assert.deepEqual(await checkWasenderSessionStatus(), { configured: true, status: 'connected', connected: true });
});
test('text endpoint, E.164 recipient, group JID and numeric msgId', async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://www.wasenderapi.com/api/send-message');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.Authorization, 'Bearer synthetic-test-key');
    const body = JSON.parse(init.body);
    assert.ok(body.to === '+972501234567' || body.to === '120363123456789@g.us');
    assert.equal(body.text, 'message');
    return { ok: true, status: 200, json: async () => ({ success: true, data: { msgId: 123, status: 'in_progress' } }) };
  };
  assert.deepEqual((await sendWasenderTextToChat('972501234567@c.us', 'message')).messageId, '123');
  assert.equal((await sendWasenderTextToChat('120363123456789@g.us', 'message')).deliveryStatus, 'accepted');
});
test('document payload matches Wasender docs', async () => {
  globalThis.fetch = async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body), {
      to: '+972501234567',
      documentUrl: 'https://example.com/report.pdf',
      fileName: 'report.pdf',
      text: 'attached'
    });
    return { ok: true, status: 200, json: async () => ({ success: true, data: { msgId: 55 } }) };
  };
  assert.equal((await sendWasenderDocumentToChat('972501234567@c.us', 'https://example.com/report.pdf', 'report.pdf', 'attached')).messageId, '55');
});
test('4xx provider rejection is not silently accepted', async () => {
  mockResponse({ success: false, message: 'Invalid API key' }, 401);
  await assert.rejects(sendWasenderTextToChat('972501234567@c.us', 'message'), err => err.errorCode === 401 && err.deliveryUncertain === false);
});
test('2xx with success=false is rejected', async () => {
  mockResponse({ success: false, message: 'Invalid payload' });
  await assert.rejects(sendWasenderTextToChat('972501234567@c.us', 'message'), err => err.errorCode === 422);
});
test('5xx or network failure has unknown delivery, never auto-retries', async () => {
  mockResponse({ success: false }, 503);
  await assert.rejects(sendWasenderTextToChat('972501234567@c.us', 'message'), err => err.deliveryUncertain === true);
  globalThis.fetch = async () => { throw new Error('synthetic connection outage'); };
  await assert.rejects(sendWasenderTextToChat('972501234567@c.us', 'message'), err => err.deliveryUncertain === true);
});
