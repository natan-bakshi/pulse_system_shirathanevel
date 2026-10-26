// A bounded, read-only operator view of the staged inbound WhatsApp inbox.
// The inbox is not a transport; avoid exposing sender phones, secret material,
// raw provider events or any customer message. No status changes on audit.
const STAGES=['pending','processing','applied','rejected','needs_review'] as const;
const TERMINAL=new Set(['applied','rejected']);
const validDate=(value:any)=>typeof value==='string'?Date.parse(value):NaN;
export function summarizeInboundWhatsAppReceipts(rows:any[],control:any,now=Date.now()){
 const totals:Record<string,number>=Object.fromEntries(STAGES.map(stage=>[stage,0]));
 let unexpectedStatus=0,expiredProcessing=0,activeProcessing=0;
 const review:any[]=[];
 for(const row of (Array.isArray(rows)?rows:[]).slice(0,100)){
  if(Object.prototype.hasOwnProperty.call(totals,row?.state))totals[row.state]++;
  else unexpectedStatus++;
  const expired= row?.state==='processing' &&
   (!Number.isFinite(validDate(row.claim_until))||validDate(row.claim_until)<=now);
  if(expired)expiredProcessing++;
  if(row?.state==='processing'&&!expired)activeProcessing++;
  if(row?.state==='needs_review'||expired){
   review.push({id:String(row.id||'').slice(0,128),
    state:row.state,reason:expired?'expired_processing':'needs_review',
    provider:['green','wasender'].includes(row.provider)?row.provider:'unknown'});
  }
 }
 const guardKey=String(control?.inbound_guard_key||'');
 const pendingGuard=guardKey.length>0;
 return {
  sampleCount:Math.min(100,Array.isArray(rows)?rows.length:0),
  sampleTruncated:Array.isArray(rows)&&rows.length>=100,
  totals,unexpectedStatus,expiredProcessing,activeProcessing,
  registrationBlocked:pendingGuard,
  guardRequiresReview:pendingGuard,
  review:review.slice(0,20),
  noMessagesSent:true,providerReceiptIsNotDelivery:true,
  // A zero value from this endpoint is a sampled zero, NOT verified global zero.
  interpretation:'Read-only sample. Unknown or expired claims require manual reconciliation. No automatic replay.'
 };
}
