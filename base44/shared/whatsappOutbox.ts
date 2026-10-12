// Durable centralized WhatsApp outbox. Producers never call WhatsApp providers directly.
// Security: only backend clients with service-role entity access may enqueue.
const CONTROL_KEY = 'global';
const lockPause = (ms: number) => new Promise(resolve=>setTimeout(resolve,ms));

// A separate short lease for duplicate-key creation. This does not block the
// transport worker: sending and enqueueing use different control fields.
async function withEnqueueLock(client:any,run:()=>Promise<any>) {
  const entity=client.asServiceRole.entities.WhatsAppQueueControl;
  const token=typeof crypto!=='undefined' && crypto.randomUUID ? crypto.randomUUID() : 'enqueue-'+Date.now()+'-'+Math.random();
  const deadline=Date.now()+20000;
  let control:any=null;
  while(Date.now()<deadline) {
    control=await readWhatsAppQueueControl(client);
    const occupied=!!control.enqueue_owner && Date.parse(control.enqueue_until||'')>Date.now();
    if(!occupied) {
      const won=await entity.updateMany({
        id:control.id,enqueue_owner:control.enqueue_owner||'',enqueue_until:control.enqueue_until||''
      },{$set:{enqueue_owner:token,enqueue_until:new Date(Date.now()+30000).toISOString()}});
      if(won?.updated===1)break;
    }
    await lockPause(40+Math.floor(Math.random()*65));
  }
  if(!control || (await entity.get(control.id)).enqueue_owner!==token) {
    throw new Error('WhatsApp outbox enqueue lock unavailable; message not queued');
  }
  try{return await run();}
  finally{await entity.updateMany({id:control.id,enqueue_owner:token},{$set:{enqueue_owner:'',enqueue_until:''}});}
}

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

// Used when a business workflow creates its InAppNotification after enqueueing.
// Handles either ordering of worker acceptance and notification persistence.
export async function attachOutboxInAppReceipt(client:any,sendResult:any,notificationId:string) {
  if(!sendResult?.queued||!sendResult.jobId||!notificationId)return;
  const db=client.asServiceRole.entities;
  await db.WhatsAppOutbox.updateMany({id:sendResult.jobId},{$set:{in_app_notification_id:notificationId}});
  const latest=await db.WhatsAppOutbox.get(sendResult.jobId);
  if(latest?.status==='accepted') {
    await db.InAppNotification.update(notificationId,{
      whatsapp_sent:true,whatsapp_message_id:latest.provider_message_id||''
    });
  }
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
  if (key.length > 240) throw new Error('Invalid WhatsApp idempotency key');
  const createOrReturnExisting=async()=>{
    if(key){
      const previous=await entity.filter({idempotency_key:key},'-created_date',3);
      if(previous.length){
        const item=previous[0];
        return {success:true,queued:['queued','retry_wait','sending'].includes(item.status),
          status:item.status,jobId:item.id,messageId:item.provider_message_id||'',deduplicated:true};
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
    expires_at:String(context.expiresAt || ''),
    status: 'queued', available_at: new Date().toISOString(), attempt_count: 0, max_attempts: 3
  });
    // The WhatsAppOutbox CREATE workflow wakes a worker. Watchdog covers interruptions.
    return {success:true,queued:true,status:'queued',jobId:record.id,messageId:''};
  };
  return key ? withEnqueueLock(client,createOrReturnExisting) : createOrReturnExisting();
}
