// Single, transport-independent interpretation of central WhatsApp Outbox receipts.
// Creating an Outbox job, the provider accepting it, and delivery to the
// recipient are THREE distinct events. This module proves only the first two.
const TERMINAL=new Set(['unknown','failed','cancelled','expired','resolved']);
const IN_PROGRESS=new Set(['queued','retry_wait','sending']);
export function whatsappEnqueueReceiptState(receipt:any):string {
  const raw=String(receipt?.status||'').trim().toLowerCase();
  // Terminal records win over boolean `queued`, which may be stale/incorrect
  // in an older SDK caller or a mock.
  if(TERMINAL.has(raw))return raw;
  if(receipt?.success===false)return 'unverified';
  if(raw==='accepted')return 'accepted'; // Provider accepted. Not delivered.
  if(IN_PROGRESS.has(raw) && (raw!=='queued'||receipt?.queued===true))return raw;
  if(!raw && receipt?.queued===true)return 'queued'; // Legacy enqueue response.
  if(receipt?.legacyDirect===true && receipt?.success===true &&
     String(receipt?.messageId||'').trim())return 'accepted';
  return 'unverified';
}
export function isWhatsAppEnqueueConfirmed(receipt:any):boolean {
  return ['queued','retry_wait','sending','accepted'].includes(whatsappEnqueueReceiptState(receipt));
}
export function whatsappResultIsUncertain(receipt:any):boolean {
  return whatsappEnqueueReceiptState(receipt)==='unknown'||
    receipt?.deliveryUncertain===true;
}
