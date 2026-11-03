import { createNotificationCore } from './notificationCore.ts';
import { sendWhatsAppToChat, toChatId } from './whatsappSend.ts';
import { isWhatsAppEnqueueConfirmed } from './whatsappReceipt.ts';
import { buildNotificationSmartLink } from './notificationSmartLinks.ts';
import { resolveNotificationDelay } from './quietHours.ts';

// Internal-only post-CAS dispatcher. The supplier endpoint determines the
// signed-in supplier and calls this ONLY after a confirmed, changed rejection.
// Never use an untrusted client source, phone, admin ID or notification body.
const TEMPLATE = 'ADMIN_ASSIGNMENT_REJECTED';
const ID = /^[A-Za-z0-9_-]{3,128}$/;

function render(value: unknown, fields: Record<string,string>): string {
  return String(value || '').replace(/\{\{(\w+)\}\}/g,
    (_match: string, key: string) => fields[key] ?? '');
}
function hebrewDate(value: unknown): string {
  const date = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return date ? '\u200E' + date[3] + '/' + date[2] + '/' + date[1] : String(value || '');
}
async function whatsappDecisionKey(serviceId: string,supplierId: string,
  decisionNonce: string,chatId: string): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([
    'supplier-rejection-alert-v1',serviceId,supplierId,decisionNonce,chatId
  ]));
  const hash = await crypto.subtle.digest('SHA-256',bytes);
  return 'supplier-rejection-alert-v1:' +
    Array.from(new Uint8Array(hash)).map(n=>n.toString(16).padStart(2,'0')).join('');
}
function rejectionConditionsMatch(template: any, event: any, service: any): boolean {
  // Preserve the template's existing assignment_status=rejected condition.
  // Unknown/malformed conditions fail closed instead of silently broadening
  // an admin-selected recipient policy.
  let conditions: any[] = [];
  try {
    if(template.event_filter_condition) {
      const parsed = JSON.parse(template.event_filter_condition);
      if(!Array.isArray(parsed))return false;
      conditions = parsed;
    }
  } catch { return false; }
  if(template.condition_field)conditions.push({
    field:template.condition_field,operator:template.condition_operator || 'equals',
    value:template.condition_value
  });
  if(!conditions.length)return true;
  const values:any = { ...event, ...service, assignment_status:'rejected' };
  const checks = conditions.map(c=>{
    if(!c || typeof c.field!=='string' || !(c.field in values))return false;
    const current=String(values[c.field] ?? '');
    const expected=String(c.value ?? '');
    if(c.operator==='equals')return current===expected;
    if(c.operator==='not_equals')return current!==expected;
    if(c.operator==='contains')return current.includes(expected);
    if(c.operator==='is_empty')return !current;
    if(c.operator==='is_not_empty')return !!current;
    return false;
  });
  return template.condition_logic==='or' ? checks.some(Boolean) : checks.every(Boolean);
}
export async function notifyManagersOfSupplierRejection(client: any, input: {
  eventId:string;eventServiceId:string;supplierId:string
}, dependencies: {
  createInApp?: typeof createNotificationCore;
  sendWhatsApp?: typeof sendWhatsAppToChat;
  now?: Date;decisionNonce?:string
} = {}): Promise<{
  enabled:boolean;targeted:number;inAppCreated:number;whatsappQueued:number;
  failures:number;skippedReason?:string
}> {
  const empty=(skippedReason:string)=>({
    enabled:false,targeted:0,inAppCreated:0,whatsappQueued:0,failures:0,skippedReason
  });
  const {eventId,eventServiceId,supplierId}=input || ({} as any);
  if(!ID.test(eventId)||!ID.test(eventServiceId)||!ID.test(supplierId))
    throw new Error('Invalid trusted supplier rejection identity');
  const db=client?.asServiceRole?.entities;
  if(!db?.NotificationTemplate||!db?.Event||!db?.EventService||
    !db?.Supplier||!db?.User)
    throw new Error('Supplier rejection notification backend unavailable');
  const templates=await db.NotificationTemplate.filter({
    type:TEMPLATE,is_active:true
  });
  const template=templates[0];
  if(!template || !Array.isArray(template.target_audiences) ||
    !template.target_audiences.includes('admin'))
    return empty('disabled_or_no_admin_audience');
  const allowed=Array.isArray(template.allowed_channels)
    ? template.allowed_channels : ['push'];
  const sendPush=allowed.includes('push');
  const sendWhatsApp=allowed.includes('whatsapp');
  if(!sendPush && !sendWhatsApp)return empty('no_enabled_channels');
  const [event,service,supplier,allAdmins]=await Promise.all([
    db.Event.get(eventId),db.EventService.get(eventServiceId),
    db.Supplier.get(supplierId),db.User.filter({role:'admin'})
  ]);
  if(!event||!service||!supplier||service.event_id!==eventId)
    throw new Error('Supplier rejection notification context unavailable');
  if(!rejectionConditionsMatch(template,event,service))
    return empty('template_conditions_not_met');
  let serviceName=String(service.service_name||'');
  if(!serviceName && service.service_id && db.Service?.get) {
    try { serviceName=String((await db.Service.get(service.service_id))?.service_name||''); }
    catch { /* Display fallback must not block a genuine rejection. */ }
  }
  const fields:Record<string,string> = {
    event_name:String(event.event_name||event.family_name||''),
    family_name:String(event.family_name||event.event_name||''),
    event_date:hebrewDate(event.event_date),
    event_time:String(event.event_time||''),
    event_location:String(event.location||''),
    supplier_name:String(supplier.supplier_name||supplier.contact_person||''),
    service_name:serviceName,
    event_id:eventId
  };
  const restrictTo=Array.isArray(template.admin_recipient_ids)
    ? template.admin_recipient_ids.filter((id:any)=>typeof id==='string') : [];
  const admins=Array.isArray(allAdmins)
    ? allAdmins.filter((u:any)=>u?.role==='admin'&&u?.id&&
       (!restrictTo.length||restrictTo.includes(u.id))) : [];
  const title=render(template.title_template,fields);
  const message=render(template.body_template,fields);
  const whatsappMessage=render(
    template.whatsapp_body_template || template.body_template,fields);
  const link=buildNotificationSmartLink(template.dynamic_url_type || 'event_page',
    {eventId,role:'admin'});
  const now=dependencies.now||new Date();
  const nonce=dependencies.decisionNonce||crypto.randomUUID();
  const inApp=dependencies.createInApp || createNotificationCore;
  const whatsapp=dependencies.sendWhatsApp || sendWhatsAppToChat;
  const usedChats=new Set<string>();
  let inAppCreated=0,whatsappQueued=0,failures=0;
  // Each administrator gets an independent in-app record. One WhatsApp
  // per chat avoids duplicate messages where administrators share a number.
  await Promise.all(admins.map(async(admin:any)=>{
    try {
      const outcome=await inApp(client,{
        target_user_id:admin.id,target_user_email:admin.email,
        title,message,link,template_type:TEMPLATE,
        related_event_id:eventId,related_event_service_id:eventServiceId,
        related_supplier_id:supplierId,send_push:sendPush,
        check_quiet_hours:true
      });
      if(outcome?.ok && outcome.body?.notification_id &&
        outcome.body.notification_id!=='virtual')inAppCreated++;
      else failures++;
    }catch {
      failures++;
      console.error('[SupplierRejectionAlert] In-app notification was not confirmed');
    }
    if(!sendWhatsApp||admin.whatsapp_enabled===false||!admin.phone)return;
    const chatId=toChatId(admin.phone);
    if(!chatId)return;
    // The set is updated synchronously before the first await in this branch.
    if(usedChats.has(chatId))return;
    usedChats.add(chatId);
    try {
      const delay=resolveNotificationDelay(admin,{checkQuietHours:true},now);
      const key=await whatsappDecisionKey(eventServiceId,supplierId,nonce,chatId);
      const receipt=await whatsapp(chatId,whatsappMessage,client,{
        sourceType:'notification',sourceId:eventServiceId,
        eventServiceId,supplierId,idempotencyKey:key,
        ...(delay.shouldDelay && delay.scheduledFor
          ? {availableAt:delay.scheduledFor.toISOString()} : {})
      });
      if(isWhatsAppEnqueueConfirmed(receipt))whatsappQueued++;
      else {
        failures++;
        console.error('[SupplierRejectionAlert] WhatsApp enqueue not confirmed');
      }
    }catch {
      failures++;
      // A provider/queue timeout after a successful enqueue is ambiguous:
      // never create a second message under a different key.
      console.error('[SupplierRejectionAlert] WhatsApp enqueue outcome uncertain');
    }
  }));
  return {enabled:true,targeted:admins.length,inAppCreated,whatsappQueued,failures};
}
