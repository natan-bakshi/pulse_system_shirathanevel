// Server-side source of truth for the WhatsApp provider selected by the system owner.
// Read AppSettings only on the server; an incoming request never chooses its own provider.
import { getWhatsAppActiveProvider, isWasenderConfigured } from './wasenderSend.ts';

export const WHATSAPP_PROVIDER_SETTING_KEY = 'whatsapp_default_provider';
export type WhatsAppProvider = 'green' | 'wasender';

// One settings read per backend invocation even when that invocation sends a batch.
// Base44 creates a distinct authenticated client for each request; no cross-request
// cache, cron, or delay when a system administrator changes the selection.
const selectedByClient = new WeakMap<object, Promise<WhatsAppProvider>>();

export async function resolveWhatsAppProvider(client?: any): Promise<WhatsAppProvider> {
  if (!client) return getWhatsAppActiveProvider();
  if (selectedByClient.has(client)) return selectedByClient.get(client)!;
  const read = (async (): Promise<WhatsAppProvider> => {
    const entities = client.asServiceRole?.entities || client.entities;
    if (!entities?.AppSettings?.filter) throw new Error('WhatsApp provider settings unavailable');
    const records = await entities.AppSettings.filter({ setting_key: WHATSAPP_PROVIDER_SETTING_KEY }, '-created_date', 3);
    if (!Array.isArray(records)) throw new Error('WhatsApp provider settings invalid');
    if (records.length > 1) throw new Error('Duplicate WhatsApp provider selection; administrator review required');
    if (!records.length) return getWhatsAppActiveProvider();
    const value = String(records[0]?.setting_value || '').trim().toLowerCase();
    if (value !== 'green' && value !== 'wasender') throw new Error('Unsupported WhatsApp provider selection');
    return value;
  })();
  selectedByClient.set(client, read);
  return read;
}

export async function hasSelectedWhatsAppProviderCredentials(client?: any): Promise<boolean> {
  const provider = await resolveWhatsAppProvider(client);
  return provider === 'wasender'
    ? isWasenderConfigured()
    : !!(Deno.env.get('GREEN_API_INSTANCE_ID') && Deno.env.get('GREEN_API_TOKEN'));
}
