import { createClientFromRequest } from 'npm:@base44/sdk@0.8.11';
import { checkWasenderSessionStatus, getWhatsAppActiveProvider, isWasenderConfigured } from '../../shared/wasenderSend.ts';

// Read-only, admin-only connectivity check. Never exposes session credentials.
Deno.serve(async (req) => {
  if (req.method !== 'POST') return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 });
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ success: false, error: 'Forbidden' }, { status: 403 });

    const selectedProvider = getWhatsAppActiveProvider();
    const greenConfigured = !!(Deno.env.get('GREEN_API_INSTANCE_ID') && Deno.env.get('GREEN_API_TOKEN'));
    const wasender = isWasenderConfigured()
      ? await checkWasenderSessionStatus()
      : { configured: false, status: 'not_configured', connected: false };

    return Response.json({ success: true, activeProvider: selectedProvider, greenConfigured, wasender });
  } catch (error) {
    console.error('[WhatsApp_ProviderStatus] status check failed:', error?.name || 'error');
    return Response.json({ success: false, error: 'Provider status temporarily unavailable' }, { status: 500 });
  }
});
