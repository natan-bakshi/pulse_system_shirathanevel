import test from 'node:test';
import assert from 'node:assert/strict';
import { sendWhatsAppText, sendWhatsAppToChat, sendWhatsAppFileByUrl } from '../base44/shared/whatsappSend.ts';

const env = {
  GREEN_API_INSTANCE_ID: 'synthetic-instance',
  GREEN_API_TOKEN: 'synthetic-green-token',
  WASENDER_API_KEY: 'synthetic-wasender-key'
};
globalThis.Deno = { env: { get: (key) => env[key] } };
const originalFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = originalFetch; delete globalThis.Deno; });

test('Green API path is unchanged until explicit provider switch', async () => {
  delete env.WHATSAPP_ACTIVE_PROVIDER;
  globalThis.fetch = async (url, opts) => {
    assert.equal(url, 'https://api.green-api.com/waInstancesynthetic-instance/sendMessage/synthetic-green-token');
    assert.deepEqual(JSON.parse(opts.body), { chatId: '972501234567@c.us', message: 'test message' });
    return { ok: true, status: 200, text: async () => JSON.stringify({ idMessage: 'green-123' }) };
  };
  const result = await sendWhatsAppText('0501234567', 'test message');
  assert.equal(result.messageId, 'green-123');
});
test('switch sends text and group messages through WasenderAPI with Bearer authentication', async () => {
  env.WHATSAPP_ACTIVE_PROVIDER = 'wasender';
  globalThis.fetch = async (url, opts) => {
    assert.equal(url, 'https://www.wasenderapi.com/api/send-message');
    assert.equal(opts.headers.Authorization, 'Bearer synthetic-wasender-key');
    const body = JSON.parse(opts.body);
    assert.ok(body.to === '+972501234567' || body.to === '120363123456@g.us');
    assert.equal(body.text, 'test message');
    return { ok: true, status: 200, json: async () => ({ success: true, data: { msgId: 66 } }) };
  };
  assert.equal((await sendWhatsAppText('0501234567', 'test message')).messageId, '66');
  assert.equal((await sendWhatsAppToChat('120363123456@g.us', 'test message')).provider, 'wasender');
});
test('switch sends documentUrl, fileName and caption, never the file contents', async () => {
  env.WHATSAPP_ACTIVE_PROVIDER = 'wasender';
  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    assert.deepEqual(body, { to: '+972501234567', documentUrl: 'https://example.com/file.pdf', fileName: 'file.pdf', text: 'document' });
    return { ok: true, status: 200, json: async () => ({ success: true, data: { msgId: 99 } }) };
  };
  assert.equal((await sendWhatsAppFileByUrl('0501234567', 'https://example.com/file.pdf', 'file.pdf', 'document')).messageId, '99');
});
test('Green API network failures are flagged as uncertain, not safe for automatic replay', async () => {
  env.WHATSAPP_ACTIVE_PROVIDER = 'green';
  globalThis.fetch = async () => { throw new Error('synthetic timeout'); };
  await assert.rejects(sendWhatsAppText('0501234567', 'test message'), err => err.deliveryUncertain === true);
  globalThis.fetch = async () => ({ ok: false, status: 503, text: async () => 'unavailable' });
  await assert.rejects(sendWhatsAppText('0501234567', 'test message'), err => err.deliveryUncertain === true && err.errorCode === 503);
});

test('without backup key selected provider fails closed; it never falls back to Green', async () => {
  env.WHATSAPP_ACTIVE_PROVIDER = 'wasender';
  delete env.WASENDER_API_KEY;
  globalThis.fetch = () => { throw new Error('should not send'); };
  await assert.rejects(sendWhatsAppText('0501234567', 'test message'), /not configured/);
});
