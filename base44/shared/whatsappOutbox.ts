// Durable centralized WhatsApp outbox. Producers never call WhatsApp providers directly.
// Security: only backend clients with service-role entity access may enqueue.
const CONTROL_KEY = 'global';

export async function readWhatsAppQueueControl(client: any) {
  if (!client?.asServiceRole?.entities?.WhatsAppQueueControl) {
    throw new Error('WhatsApp queue requires an authenticated backend client');
  }
  const items = await client.asServiceRole.entities.WhatsAppQueueControl.filter({ control_key: CONTROL_KEY }, '-created_date', 3);
  if (!Array.isArray(items) || items.length !== 1) {
    throw new Error('WhatsApp queue control is missing or duplicated');
  }
  return items[0];
}

export async function enqueueWhatsApp(client: any, data: {
  chatId: string; messageType: 'text' | 'document'; messageText?: string;
  documentUrl?: string; fileUri?: string; fileName?: string; caption?: string;
  context?: any;
}) {
  const control = await readWhatsAppQueueControl(client);
  // Fail closed, never bypass the queue, even while disabled.
  if (!control.enabled) throw new Error('Central WhatsApp queue has not been activated');
  const context = data.context || {};
  const key = String(context.idempotencyKey || '').trim();
  const entity = client.asServiceRole.entities.WhatsAppOutbox;
  if (key) {
    if (key.length > 240) throw new Error('Invalid WhatsApp idempotency key');
    const previous = await entity.filter({ idempotency_key: key }, '-created_date', 3);
    if (previous.length) {
      return { success: true, queued: !['accepted', 'cancelled', 'expired'].includes(previous[0].status),
        status: previous[0].status, jobId: previous[0].id, messageId: previous[0].provider_message_id || '',
        deduplicated: true };
    }
  }
  const record = await entity.create({
    chat_id: data.chatId, message_type: data.messageType,
    message_text: data.messageText || '', document_url: data.documentUrl || '',
    file_uri: data.fileUri || '', file_name: data.fileName || '', caption: data.caption || '',
    source_type: String(context.sourceType || 'system').slice(0, 64),
    source_id: String(context.sourceId || '').slice(0, 120),
    idempotency_key: key,
    in_app_notification_id: String(context.inAppNotificationId || ''),
    client_message_delivery_id: String(context.clientMessageDeliveryId || ''),
    card_setup_request_id: String(context.cardSetupRequestId || ''),
    event_service_id: String(context.eventServiceId || ''),
    supplier_id: String(context.supplierId || ''),
    status: 'queued', available_at: new Date().toISOString(), attempt_count: 0, max_attempts: 3
  });
  // The WhatsAppOutbox CREATE workflow wakes a worker. Scheduled watchdog covers interruptions.
  return { success: true, queued: true, status: 'queued', jobId: record.id, messageId: '' };
}
