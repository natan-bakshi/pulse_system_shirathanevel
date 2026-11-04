import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';

function fixture({agreement=false,mode='post_charge_v1',documentCreated=false,success=true}={}){
 const stats={agreementCalls:0,issueCalls:0,deliveries:0,adminNotices:0,legacyDocs:0,legacyMessages:0};
 const payment={
  id:'pay-callback-1',event_id:'event-callback-1',
  agreement_id:agreement?'agreement-callback-1':'',
  auto_invoice_mode:mode,payment_status:'pending',
  agreement_verified:false,invoice4u_clearing_status:'',
  amount:2000,processing_fee_amount:18,invoice4u_callback_token:'secret-token',
  payer_phone:'0501234567',payer_email:'',payer_name:'Customer',
  payment_method:'credit_card',currency:'ILS'
 };
 const doc={id:'doc-callback-1',document_number:'501',
  pdf_original_url:'https://newview.invoice4u.co.il/Views/PDF.aspx?cipher=test'};
 const entities={
  Payment:{
   get:async id=>id===payment.id?{...payment}:null,
   update:async(id,patch)=>{assert.equal(id,payment.id);Object.assign(payment,patch);return {...payment};}
  },
  AppSettings:{list:async()=>[]},
  Event:{get:async()=>({id:payment.event_id,event_name:'Event'})},
  FinancialDocument:{
   filter:async()=>[],
   create:async()=>{stats.legacyDocs++;return {...doc};}
  }
 };
 const client={asServiceRole:{entities}};
 const code=esbuild.transformSync(fs.readFileSync(
  'base44/functions/invoice4uClearingCallback/entry.ts','utf8'),
  {loader:'ts',format:'cjs',target:'es2022'}).code;
 const exports={},module={exports};
 vm.runInNewContext(code,{
  module,exports,Date,URL,
  console:{warn:()=>{},error:()=>{}},
  Response:{json:(body,{status=200}={})=>({body,status})},
  require:name=>{
   if(name.startsWith('npm:@base44/sdk'))return {createClientFromRequest:()=>client};
   if(name.endsWith('agreementLifecycle.ts'))return {afterAgreementChange:async()=>{}};
   if(name.endsWith('agreementDeposit.ts'))return {completeAgreementDeposit:async(_client,p,d)=>{
    stats.agreementCalls++;
    assert.equal(p.id,payment.id);
    if(success){payment.agreement_verified=true;payment.payment_status='completed';
     payment.invoice4u_clearing_status='approved';}
    return {received:true,verified:success};
   }};
   if(name.endsWith('storedCards.ts'))return {afterCardRelevantChange:async()=>{}};
   if(name.endsWith('billingNotifications.ts'))return {notifyAdminsClearingResult:async()=>{
    stats.adminNotices++;
   }};
   if(name.endsWith('clientBillingMessages.ts'))return {
    renderClientMessage:()=>'legacy-message',
    sendClientMessage:async()=>{stats.legacyMessages++;}
   };
   if(name.endsWith('hostedPaymentInvoice.ts'))return {
    HOSTED_INVOICE_MODE:'post_charge_v1',
    ensureHostedPaymentInvoice:async()=>{
     stats.issueCalls++;return {state:'issued',document:doc};
    },
    deliverHostedPaymentDocument:async()=>{
     stats.deliveries++;return {state:'queued_or_sent',channels:['whatsapp']};
    }
   };
   throw Error('Unexpected import '+name);
  }
 });
 const handler=module.exports.default;
 const callback={OrderIdClientUsage:payment.id,Success:success,
   DocCreated:documentCreated,Amount:2018,PaymentId:'payment-provider-123'};
 const request={
  url:'https://pulse-system.base44.app/functions/invoice4uClearingCallback?token=secret-token',
  headers:{get:()=> 'application/json'},
  json:async()=>({Data:callback}),
  formData:async()=>{throw Error('not form')}
 };
 return {payment,doc,callback,request,handler,stats};
}
test('verified agreement deposit from card callback creates & sends the customer tax invoice',async()=>{
 const f=fixture({agreement:true});
 const response=await f.handler(f.request);
 assert.equal(response.status,200);
 assert.equal(f.stats.agreementCalls,1);
 assert.equal(f.stats.issueCalls,1);
 assert.equal(f.stats.deliveries,1);
 assert.equal(f.stats.legacyMessages,0);
 assert.equal(f.payment.payment_status,'completed');
});
test('general/direct card callback creates and delivers one invoice path, not old blank receipt',async()=>{
 const f=fixture();
 const response=await f.handler(f.request);
 assert.equal(response.status,200);
 assert.equal(f.stats.issueCalls,1);
 assert.equal(f.stats.deliveries,1);
 assert.equal(f.stats.legacyMessages,0);
 assert.equal(f.stats.adminNotices,1);
 assert.equal(f.payment.payment_status,'completed');
 assert.equal(f.payment.invoice4u_payment_id,'payment-provider-123');
});
test('legacy hosted callbacks with DocCreated=false never auto-mint a retroactive invoice',async()=>{
 const f=fixture({agreement:true,mode:undefined});
 const result=await f.handler(f.request);
 assert.equal(result.status,200);
 assert.equal(f.stats.agreementCalls,1);
 assert.equal(f.stats.issueCalls,0);
 assert.equal(f.stats.deliveries,0);
});
test('legacy generic callback without document never sends broken empty invoice URL',async()=>{
 const f=fixture({mode:undefined});
 const result=await f.handler(f.request);
 assert.equal(result.status,200);
 assert.equal(f.stats.issueCalls,0);
 assert.equal(f.stats.legacyMessages,0);
});
test('successful charge remains paid if invoice API temporarily fails; callback requests safe retry',async()=>{
 const f=fixture();
 const old=f.handler;
 // Inject failure into the snapshot by building a second handler with a
 // runtime importer that throws inside ensureHostedPaymentInvoice.
 const code=esbuild.transformSync(fs.readFileSync(
  'base44/functions/invoice4uClearingCallback/entry.ts','utf8'),
  {loader:'ts',format:'cjs',target:'es2022'}).code;
 const exports={},module={exports};
 vm.runInNewContext(code,{
  module,exports,Date,URL,console:{warn:()=>{},error:()=>{}},
  Response:{json:(body,{status=200}={})=>({body,status})},
  require:name=>{
   if(name.startsWith('npm:@base44/sdk'))return {createClientFromRequest:()=>({asServiceRole:{
    entities:{Payment:{get:async()=>({...f.payment}),update:async(_id,patch)=>Object.assign(f.payment,patch)}}}})};
   if(name.endsWith('agreementLifecycle.ts'))return {afterAgreementChange:async()=>{}};
   if(name.endsWith('agreementDeposit.ts'))return {completeAgreementDeposit:async()=>({received:true})};
   if(name.endsWith('storedCards.ts'))return {afterCardRelevantChange:async()=>{}};
   if(name.endsWith('billingNotifications.ts'))return {notifyAdminsClearingResult:async()=>{}};
   if(name.endsWith('clientBillingMessages.ts'))return {renderClientMessage:()=>'',sendClientMessage:async()=>{}};
   if(name.endsWith('hostedPaymentInvoice.ts'))return {HOSTED_INVOICE_MODE:'post_charge_v1',
    ensureHostedPaymentInvoice:async()=>{throw Error('provider temporary outage');},
    deliverHostedPaymentDocument:async()=>{}};
   throw Error('Unexpected '+name);
  }
 });
 const result=await module.exports.default(f.request);
 assert.equal(result.status,503);
 assert.equal(f.payment.payment_status,'completed');
 assert.equal(f.payment.invoice4u_clearing_status,'approved');
});
test('invalid callback token cannot issue invoice or update payment',async()=>{
 const f=fixture();
 const wrong={...f.request,url:'https://pulse-system.base44.app/functions/invoice4uClearingCallback?token=wrong'};
 const result=await f.handler(wrong);
 assert.equal(result.status,403);
 assert.equal(f.stats.issueCalls,0);
 assert.equal(f.payment.payment_status,'pending');
});
