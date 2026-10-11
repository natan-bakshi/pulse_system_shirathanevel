import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WHATSAPP_PROVIDER_SETTING_KEY,
  resolveWhatsAppProvider,
  hasSelectedWhatsAppProviderCredentials
} from '../base44/shared/whatsappProviderConfig.ts';
import { sendWhatsAppText, sendWhatsAppFileByUrl } from '../base44/shared/whatsappSend.ts';

const vars = {
  GREEN_API_INSTANCE_ID: 'fake-green-instance',
  GREEN_API_TOKEN: 'fake-green-token',
  WASENDER_API_KEY: 'fake-wasender-token'
};
globalThis.Deno = { env: { get: name => vars[name] } };
const realFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = realFetch; delete globalThis.Deno; });

function appClient(provider = null, fail = false) {
  const records = provider === null ? [] : [{ id: 'one', setting_key: WHATSAPP_PROVIDER_SETTING_KEY, setting_value: provider }];
  let count = 0;
  return {
    get reads() { return count; },
    asServiceRole: { entities: { AppSettings: {
      filter: async (query, order, limit) => {
        count++;
        assert.deepEqual(query, { setting_key: 'whatsapp_default_provider' });
        assert.equal(order, '-created_date');
        assert.equal(limit, 3);
        if (fail) throw new Error('database unavailable');
        return records;
      }
    }}}
  };
}

test('no record preserves the previous Green default', async () => {
  const client = appClient();
  assert.equal(await resolveWhatsAppProvider(client), 'green');
  assert.equal(await hasSelectedWhatsAppProviderCredentials(client), true);
  assert.equal(client.reads, 1);
});

test('persisted Wasender choice overrides old environment provider with one read per invocation', async () => {
  vars.WHATSAPP_ACTIVE_PROVIDER = 'green';
  const client = appClient('wasender');
  assert.equal(await resolveWhatsAppProvider(client), 'wasender');
  assert.equal(await hasSelectedWhatsAppProviderCredentials(client), true);
  assert.equal(client.reads, 1);
});

test('persisted Green choice overrides environment selection', async () => {
  vars.WHATSAPP_ACTIVE_PROVIDER = 'wasender';
  const client = appClient('green');
  assert.equal(await resolveWhatsAppProvider(client), 'green');
  assert.equal(client.reads, 1);
  delete vars.WHATSAPP_ACTIVE_PROVIDER;
});

test('database errors fail closed, never silently route the message via Green', async () => {
  const client = appClient(null, true);
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('must not contact provider'); };
  await assert.rejects(sendWhatsAppText('0501234567', 'message', client), /database unavailable/);
  assert.equal(called, false);
});

test('invalid selection fails closed', async () => {
  const client = appClient('unapproved-service');
  await assert.rejects(resolveWhatsAppProvider(client), /Unsupported WhatsApp provider/);
});

test('live selected provider applies to text and PDF, without any Green request', async () => {
  const client = appClient('wasender');
  globalThis.fetch = async (url, opts) => {
    assert.equal(url, 'https://www.wasenderapi.com/api/send-message');
    assert.equal(opts.headers.Authorization, 'Bearer fake-wasender-token');
    const body = JSON.parse(opts.body);
    assert.equal(body.to, '+972501234567');
    if (body.text === 'Hello') assert.equal(body.documentUrl, undefined);
    else assert.equal(body.documentUrl, 'https://example.com/document.pdf');
    return { ok: true, status: 200, json: async () => ({ success: true, data: { msgId: 'wasender-5' } }) };
  };
  assert.equal((await sendWhatsAppText('0501234567', 'Hello', client)).messageId, 'wasender-5');
  assert.equal((await sendWhatsAppFileByUrl('0501234567', 'https://example.com/document.pdf', 'document.pdf', 'invoice', client)).messageId, 'wasender-5');
  assert.equal(client.reads, 1);
});

test('service-role entity client also respects the selected provider', async () => {
  vars.WASENDER_API_KEY = 'fake-wasender-token';
  const client = appClient('wasender').asServiceRole;
  assert.equal(await resolveWhatsAppProvider(client), 'wasender');
  assert.equal(await hasSelectedWhatsAppProviderCredentials(client), true);
});

test('missing Wasender key cannot silently use Green', async () => {
  const client = appClient('wasender');
  delete vars.WASENDER_API_KEY;
  assert.equal(await hasSelectedWhatsAppProviderCredentials(client), false);
  await assert.rejects(sendWhatsAppText('0501234567', 'Hello', client), /not configured/);
});
