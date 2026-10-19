import {canonicalAssignmentUpdatedDate} from './assignmentWhatsApp.ts';
import {isInQuietHours,getQuietHoursEndTime} from './quietHours.ts';

// Shared ONE-Outbox intent for a non-assignment entity trigger. The legacy
// quiet-hour path wrote a separate PendingPushNotification and swallowed
// failures, while the daytime path sent directly to Outbox. Here both paths
// retain ONE business key, and quiet hours only set available_at.
//
// The trigger revision identifies the original business mutation; it must
// never be the worker wake time. If no durable revision is available, do NOT
// invent a key that would suppress later, legitimate notifications.
export async function entityTriggerWhatsAppContext(input:{
  entityName:string;origin:any;template:any;recipientChatId:string;
  specificSupplierId?:string;eventServiceId?:string;eventId?:string;
  sourceType?:string;
},now=new Date()):Promise<any>{
  const sourceId=String(input?.origin?.id||'').trim();
  const kind=String(input?.entityName||'').trim();
  const chat=String(input?.recipientChatId||'').trim();
  const templateId=String(input?.template?.id||input?.template?.type||'').trim();
  const rawRevision=String(input?.origin?.updated_date||input?.origin?.created_date||'').trim();
  const revision=canonicalAssignmentUpdatedDate(rawRevision);
  let idempotencyKey='';
  if(sourceId&&kind&&chat&&templateId&&revision){
    const identity=[
      'entity-notification-v1',kind,sourceId,templateId,revision,chat,
      String(input.specificSupplierId||'')
    ];
    const bytes=new TextEncoder().encode(JSON.stringify(identity));
    const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
    const hex=Array.from(hash).map(v=>v.toString(16).padStart(2,'0')).join('');
    idempotencyKey='entity-notification-v1:'+hex;
  }

  // Retain the existing 22:00-08:00 Jerusalem policy for all non-assignment
  // entity notifications. Respect Israel DST via the shared clock utility.
  // This does NOT introduce Shabbat / individual-preference changes.
  const delayed=isInQuietHours('22:00','08:00',now);
  const availableAt=delayed?getQuietHoursEndTime('08:00',now).toISOString():'';
  return {
    sourceType:String(input?.sourceType||'notification'),
    sourceId:sourceId||String(input.eventId||''),
    eventServiceId:String(input.eventServiceId||''),
    supplierId:String(input.specificSupplierId||''),
    idempotencyKey,
    ...(availableAt?{availableAt}:{})
  };
}
