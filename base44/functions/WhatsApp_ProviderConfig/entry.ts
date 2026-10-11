import { createClientFromRequest } from 'npm:@base44/sdk@0.8.11';
import { resolveWhatsAppProvider, WHATSAPP_PROVIDER_SETTING_KEY } from '../../shared/whatsappProviderConfig.ts';
import { isWasenderConfigured, checkWasenderSessionStatus } from '../../shared/wasenderSend.ts';

// Changing this value affects every backend WhatsApp sender, including scheduled jobs.
// The administrator's selection is server-side AppSettings; the API key always stays in Secrets.
const SYSTEM_OWNER_EMAIL = 'natib8000@gmail.com';
const validProvider = (value: unknown) => value === 'green' || value === 'wasender';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 });
  try {
    const base44 = createClientFromRequest(req);
    const actor = await base44.auth.me().catch(() => null);
    if (!actor) return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    if (actor.role !== 'admin' || String(actor.email || '').trim().toLowerCase() !== SYSTEM_OWNER_EMAIL) {
      return Response.json({ success: false, error: 'Forbidden: system owner required' }, { status: 403 });
    }

    let input: any;
    try { input = await req.json(); } catch { return Response.json({ success: false, error: 'Invalid JSON' }, { status: 400 }); }
    const action = input?.action;
    const greenConfigured = !!(Deno.env.get('GREEN_API_INSTANCE_ID') && Deno.env.get('GREEN_API_TOKEN'));
    const wasenderConfigured = isWasenderConfigured();

    if (action === 'get') {
      const provider = await resolveWhatsAppProvider(base44);
      return Response.json({ success: true, provider, greenConfigured, wasenderConfigured });
    }
    if (action === 'check') {
      const provider = await resolveWhatsAppProvider(base44);
      const wasender = await checkWasenderSessionStatus();
      return Response.json({ success: true, provider, greenConfigured, wasenderConfigured, wasender });
    }
    if (action !== 'set' || !validProvider(input?.provider)) {
      return Response.json({ success: false, error: 'Unsupported action or provider' }, { status: 400 });
    }

    const provider = input.provider as 'green' | 'wasender';
    if (provider === 'wasender') {
      if (!wasenderConfigured) return Response.json({ success: false, error: 'WASENDER_API_KEY is not configured in Secrets' }, { status: 409 });
      const status = await checkWasenderSessionStatus();
      if (!status.connected) {
        return Response.json({ success: false, error: 'WasenderAPI session is not connected; provider selection unchanged', connectionStatus: status.status }, { status: 409 });
      }
    } else if (!greenConfigured) {
      return Response.json({ success: false, error: 'Green API credentials are not configured; selection unchanged' }, { status: 409 });
    }

    const entity = base44.asServiceRole.entities.AppSettings;
    const existing = await entity.filter({ setting_key: WHATSAPP_PROVIDER_SETTING_KEY }, '-created_date', 3);
    if (existing.length > 1) return Response.json({ success: false, error: 'Duplicate provider settings require administrator review' }, { status: 409 });
    if (existing.length === 1) {
      if (existing[0].setting_value !== provider) {
        await entity.update(existing[0].id, { setting_value: provider });
      }
    } else {
      await entity.create({
        setting_key: WHATSAPP_PROVIDER_SETTING_KEY,
        setting_value: provider,
        setting_type: 'string',
        description: 'System owner selected WhatsApp sending provider; green or wasender'
      });
    }
    console.log('[WhatsAppProviderConfig] provider selected:', provider);
    return Response.json({ success: true, provider, greenConfigured, wasenderConfigured });
  } catch (error) {
    console.error('[WhatsAppProviderConfig] operation failed:', error instanceof Error ? error.name : 'error');
    return Response.json({ success: false, error: 'Could not load or save WhatsApp provider settings' }, { status: 500 });
  }
});
