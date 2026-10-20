import {whatsappEnqueueReceiptState} from './whatsappReceipt.ts';
import {parseWhatsAppPhone} from './whatsappPhone.ts';

// No customer data, raw phone, token, message, URL, secrets or arbitrary
// exception text is ever copied into business/audit records.
const OUTBOX_TO_BUSINESS:Record<string,string>={
  queued:'queued',sending:'queued',retry_wait:'queued',
  accepted:'accepted',unknown:'unknown',failed:'failed',
  cancelled:'cancelled',expired:'expired',resolved:'resolved'
};
export function agreementDeliveryStatus(receipt:any):string {
  const fromReceipt=whatsappEnqueueReceiptState(receipt);
  return OUTBOX_TO_BUSINESS[fromReceipt]||'unknown';
}
export function agreementDeliveryStatusFromOutbox(status:any):string {
  return OUTBOX_TO_BUSINESS[String(status||'').toLowerCase()]||'unknown';
}
export function agreementDeliveryErrorCode(err:any):string {
  const msg=String(err?.message||'').toLowerCase();
  if(/invalid whatsapp (phone|target|destination)|invalid whatsapp destination/.test(msg))
    return 'INVALID_PHONE_FORMAT';
  if(/empty whatsapp message/.test(msg))return 'EMPTY_MESSAGE';
  if(/central whatsapp queue.*not.*activat|queue.*disabled/.test(msg))
    return 'QUEUE_DISABLED';
  if(/whatsapp is paused|queue.*paused/.test(msg))return 'QUEUE_PAUSED';
  if(/enqueue lock unavailable/.test(msg))return 'QUEUE_LOCK_BUSY';
  if(/queue control.*missing|queue control.*duplicat|whatsapp queue requires/.test(msg))
    return 'QUEUE_CONTROL_UNAVAILABLE';
  if(/provider settings|provider selection|unsupported whatsapp provider/.test(msg))
    return 'PROVIDER_CONFIG_UNAVAILABLE';
  if(/permission|unauthorized|forbidden|\b403\b/.test(msg))return 'QUEUE_PERMISSION_DENIED';
  if(/schema|validation|invalid.*field/.test(msg))return 'QUEUE_SCHEMA_REJECTED';
  if(err?.deliveryUncertain===true)return 'TRANSPORT_UNCERTAIN';
  if(err?.queuePhase)return 'QUEUE_PHASE_FAILURE';
  return 'QUEUE_ENQUEUE_UNVERIFIED';
}
export function agreementDeliverySafeErrorLabel(code:string):string {
  const labels:Record<string,string>={
    INVALID_PHONE_FORMAT:'פורמט מספר WhatsApp אינו תקין; נא לציין קידומת בינלאומית.',
    EMPTY_MESSAGE:'נוסח הודעת WhatsApp ריק.',
    QUEUE_DISABLED:'תור WhatsApp אינו פעיל.',
    QUEUE_PAUSED:'תור WhatsApp הושהה.',
    QUEUE_LOCK_BUSY:'מערכת התור אינה מצליחה לשמור הודעה כעת.',
    QUEUE_CONTROL_UNAVAILABLE:'הגדרות התור אינן זמינות.',
    PROVIDER_CONFIG_UNAVAILABLE:'הגדרות ספק WhatsApp אינן זמינות.',
    QUEUE_PERMISSION_DENIED:'גישה לתור WhatsApp נדחתה.',
    QUEUE_SCHEMA_REJECTED:'שמירת רשומת התור נדחתה בבדיקת נתונים.',
    TRANSPORT_UNCERTAIN:'תוצאת ספק WhatsApp אינה ידועה. נדרש בירור לפני שליחה חוזרת.',
    QUEUE_PHASE_FAILURE:'פעולת התור נכשלה לפני שהתקבל אישור קליטה.',
    QUEUE_ENQUEUE_UNVERIFIED:'לא התקבל אישור שרשומת WhatsApp נשמרה בתור.',
    QUEUE_LOOKUP_UNAVAILABLE:'לא ניתן לאמת אם הודעה נקלטה בתור. אין לשלוח שוב ללא בירור.',
    UNKNOWN_OUTBOX_STATE:'תוצאת הודעת WhatsApp בתור אינה ידועה.',
    OUTBOX_TERMINAL:'ההודעה קיימת בתור אך מצבה מחייב בדיקה.'
  };
  return labels[code]||labels.QUEUE_ENQUEUE_UNVERIFIED;
}
export function agreementPhoneFormatEvidence(phone:any){
  const raw=String(phone||'').trim();
  const digits=raw.replace(/\D/g,'');
  const parsed=parseWhatsAppPhone(raw);
  const israel=parsed.digits.startsWith('972');
  const international=parsed.status==='VALID'&&!israel;
  const countryHint=israel?'IL':parsed.digits.length===11&&parsed.digits.startsWith('1')?'NANP':'INTERNATIONAL_OTHER';
  return {valid:parsed.status==='VALID',e164Digits:digits.length,
    international,countryHint:parsed.status==='VALID'?countryHint:'INVALID',
    formatStatus:parsed.status,formatReason:parsed.reason,
    // This is only syntax evidence; it does not verify WhatsApp registration.
    destinationRegistrationVerified:false};
}
export function agreementReceiptPatch(receipt:any,when:string){
  const state=agreementDeliveryStatus(receipt);
  const accepted=state==='accepted';
  const ongoing=state==='queued';
  const failure=['unknown','failed','cancelled','expired','resolved'].includes(state);
  return {state,provider_message_id:accepted?String(receipt?.messageId||receipt?.provider_message_id||''):'',
    error:failure?(state==='unknown'
       ?'תוצאת השליחה אינה ידועה; יש לבדוק לפני שליחה נוספת.'
       :agreementDeliverySafeErrorLabel('OUTBOX_TERMINAL')):'',
    error_code:failure?(state==='unknown'?'UNKNOWN_OUTBOX_STATE':'OUTBOX_TERMINAL'):'',
    queue_job_id:String(receipt?.jobId||receipt?.id||''),
    ...(accepted||ongoing?{queued_at:when}:{}),
    ...(accepted?{sent_at:when}:{})};
}
