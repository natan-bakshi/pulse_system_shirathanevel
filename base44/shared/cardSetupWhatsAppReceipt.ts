import {whatsappEnqueueReceiptState,isWhatsAppEnqueueConfirmed} from './whatsappReceipt.ts';

// One canonical interpretation for customer card setup invitations.
// It reports durable queue acceptance separately from provider acceptance.
// A duplicate Outbox entry in UNKNOWN/FAILED must never become "sent".
export function cardSetupWhatsAppOutcome(receipt:any){
  const state=whatsappEnqueueReceiptState(receipt);
  const confirmed=isWhatsAppEnqueueConfirmed(receipt);
  const accepted=confirmed&&state==='accepted';
  const queued=confirmed&&!accepted;
  return {
    deliveryState:state,
    linkState:accepted?'accepted':queued?'queued':state==='failed'?'rejected':'unknown',
    sent:accepted,
    queued,
    manualReviewRequired:!confirmed,
    jobId:String(receipt?.jobId||''),
    messageId:accepted?String(receipt?.messageId||''):''
  };
}
