import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';
import {webcrypto} from 'node:crypto';
import {buildDocumentBody, summarizeItems} from '../base44/shared/invoice4uDocuments.ts';
import {calculateProcessingFee,itemsToPipedFields} from '../base44/shared/eventBilling.ts';
import {
 editDocumentUnitPrice,editDocumentVatRate,itemUnitGross,totalDocumentNet,totalDocumentGross
} from '../src/components/billing/documentAmountMath.js';

const ID='payment-abc123';
function fixture(overrides={}){
 const payment={
  id:ID,event_id:'event-123',agreement_id:'agreement-abc',
  agreement_verified:true,amount:2000,processing_fee_amount:18,
  currency:'ILS',payment_status:'completed',invoice4u_clearing_status:'approved',
  invoice_environment:'production',auto_invoice_mode:'post_charge_v1',
  invoice_issuance_state:'pending',invoice_issuance_owner:'',
  invoice_charge_label:'מקדמה עבור אירוע',invoice_fee_label:'עמלת סליקה',
  invoice_vat_percent:18,created_date:'2026-11-04T12:40:00Z',
  payment_date:'2026-11-04',payment_method:'credit_card',
  payer_name:'Testing Family',payer_phone:'0501234567',payer_email:'',
  is_interested_in_invoice:true,document_language:'he',
  ...overrides
 };
 const docs=[],provider={remote:null,creates:0,lookups:0,throwAfterCreate:false,invalidTotal:false};
 const stats={claims:0,invoiceTokens:0,providerVerifications:0,messages:[],lastDoc:null};
 const db={
  AppSettings:{list:async()=>[]},
  Payment:{
   update:async(id,patch)=>{
    assert.equal(id,payment.id);Object.assign(payment,patch);return {...payment};
   },
   updateMany:async(query,ops)=>{
    if(Object.entries(query).some(([key,val])=>payment[key]!==val))return {updated:0};
    Object.assign(payment,ops.$set);stats.claims++;return {updated:1};
   }
  },
  FinancialDocument:{
   filter:async(query)=>docs.filter(d=>d.linked_payment_id===query.linked_payment_id),
   create:async(fields)=>{
    const doc={...fields,id:'local-doc-'+(docs.length+1)};
    docs.push(doc);return doc;
   }
  }
 };
 const request=async(_env,endpoint,args)=>{
  if(endpoint==='GetDocumentByApiIdentifier'){
   provider.lookups++;return provider.remote;
  }
  if(endpoint!=='CreateDocumentWithIdentifierValidation')throw Error('Unexpected API '+endpoint);
  provider.creates++;
  const doc=args.doc;stats.lastDoc=doc;
  assert.equal(doc.TaxIncluded,true);
  assert.equal(doc.DocumentType,3);
  assert.equal(doc.TaxPercentage,18);
  assert.equal(doc.ApiIdentifier,'pulse-hosted-payment-'+ID+'-invoice-receipt');
  assert.equal(doc.Items.length,2);
  assert.equal(doc.Items[0].Name,'מקדמה עבור אירוע');
  assert.equal(doc.Items[0].Price,2000);
  assert.equal(doc.Items[1].Name,'עמלת סליקה');
  assert.equal(doc.Items[1].Price,18);
  assert.equal(doc.Payments[0].Amount,2018);
  assert.equal(doc.Payments[0].PaymentType,3);
  provider.remote={
   ID:'123e4567-e89b-12d3-a456-426614174000',
   DocumentType:3,DocumentNumber:501,Total:provider.invalidTotal?2000:2018,
   TotalWithoutTax:1710.17,TotalTaxAmount:307.83,
   CipherTextOriginal:'a%2Fb+c',CipherText:'examplecipher',
   Errors:[]
  };
  if(provider.throwAfterCreate)throw Error('Provider response lost after document was created');
  return provider.remote;
 };
 const code=esbuild.transformSync(fs.readFileSync(
  'base44/shared/hostedPaymentInvoice.ts','utf8'),
  {loader:'ts',format:'cjs',target:'es2022'}).code;
 const exports={},module={exports};
 vm.runInNewContext(code,{
  module,exports,console:{warn:()=>{},error:()=>{}},URL,Date,
  crypto:webcrypto,
  require:name=>{
   if(name.endsWith('invoice4uDocuments.ts'))return {buildDocumentBody,round2:x=>Math.round(Number(x)*100)/100};
   if(name.endsWith('invoice4uClient.ts'))return {
    invoice4uErrors:result=>(result?.Errors||[]).map(e=>e.Error).join(','),
    invoice4uRequest:request,
    invoice4uToken:()=>{stats.invoiceTokens++;return 'test-token-only';}
   };
   if(name.endsWith('storedCardProvider.ts'))return {
    verifyLog:async()=>{stats.providerVerifications++;return {verified:true};}
   };
   if(name.endsWith('clientBillingMessages.ts'))return {
    renderClientMessage:(_config,_kind,_lang,v)=>'Received '+v.amount+'; '+v.document_url,
    sendClientMessage:async(_base44,opts)=>{
     stats.messages.push(opts);return ['whatsapp'];
    }
   };
   throw Error('Unexpected module '+name);
  }
 });
 const base44={asServiceRole:{entities:db}};
 return {payment,docs,provider,stats,db,base44,...module.exports};
}

test('itemized hosted invoice shows two independent gross price lines and exact matching card payment',async()=>{
 const f=fixture();
 assert.deepEqual(JSON.parse(JSON.stringify(f.hostedInvoiceItems(f.payment))),[
  {name:'מקדמה עבור אירוע',quantity:1,price:2000},
  {name:'עמלת סליקה',quantity:1,price:18}
 ]);
 const result=await f.ensureHostedPaymentInvoice(f.base44,f.payment);
 assert.equal(result.state,'issued');
 assert.equal(f.provider.creates,1);
 assert.equal(f.provider.lookups,1);
 assert.equal(f.docs.length,1);
 assert.equal(f.docs[0].total,2018);
 assert.equal(f.payment.financial_document_id,f.docs[0].id);
 assert.equal(f.payment.invoice_issuance_state,'issued');
 assert.match(f.docs[0].pdf_original_url,/cipher=a%2Fb%2Bc/);
 assert.equal(f.stats.providerVerifications,0,'agreement deposit was already verified');
});

test('duplicate callbacks do not issue a second provider or local tax document',async()=>{
 const f=fixture();
 await f.ensureHostedPaymentInvoice(f.base44,f.payment);
 const second=await f.ensureHostedPaymentInvoice(f.base44,f.payment);
 assert.equal(second.state,'issued');
 assert.equal(f.provider.creates,1);
 assert.equal(f.docs.length,1);
});

test('ambiguous provider response recovers by immutable ApiIdentifier rather than a new invoice',async()=>{
 const f=fixture();f.provider.throwAfterCreate=true;
 await assert.rejects(f.ensureHostedPaymentInvoice(f.base44,f.payment),/Provider response lost/);
 assert.equal(f.payment.invoice_issuance_state,'review');
 assert.equal(f.provider.creates,1);
 const restored=await f.ensureHostedPaymentInvoice(f.base44,f.payment);
 assert.equal(restored.state,'issued');
 assert.equal(f.provider.creates,1);
 assert.equal(f.docs.length,1);
});
test('legacy payments never create retroactive documents, even after successful payment',async()=>{
 const f=fixture({auto_invoice_mode:undefined,invoice_issuance_state:undefined});
 const result=await f.ensureHostedPaymentInvoice(f.base44,f.payment);
 assert.equal(result.state,'legacy_payment');
 assert.equal(f.provider.creates,0);
 assert.equal(f.docs.length,0);
});
test('pending payment and unverified agreement do not issue legal documents',async()=>{
 for(const override of [{payment_status:'pending'},{agreement_verified:false}]){
  const f=fixture(override);
  const result=await f.ensureHostedPaymentInvoice(f.base44,f.payment);
  assert.ok(result.state.startsWith('pending')||result.state==='unverified_payment');
  assert.equal(f.provider.creates,0);
 }
});
test('standalone hosted link/general card payment requires clearing log verification before invoice',async()=>{
 const f=fixture({agreement_id:null,invoice4u_payment_id:'123456'});
 const result=await f.ensureHostedPaymentInvoice(f.base44,f.payment);
 assert.equal(result.state,'issued');
 assert.equal(f.stats.providerVerifications,1);
});
test('a provider document for the wrong paid total is never linked or silently accepted',async()=>{
 const f=fixture();f.provider.invalidTotal=true;
 await assert.rejects(f.ensureHostedPaymentInvoice(f.base44,f.payment),/does not match/);
 assert.equal(f.docs.length,0);
 assert.equal(f.payment.invoice_issuance_state,'review');
});
test('missing provider identity / incomplete provider evidence fail closed',async()=>{
 const f=fixture({agreement_id:null,invoice4u_payment_id:''});
 const result=await f.ensureHostedPaymentInvoice(f.base44,f.payment);
 assert.equal(result.state,'pending_provider_payment_id');
 assert.equal(f.provider.creates,0);
});
test('client without email receives WhatsApp tax invoice URL and full amount, unless explicitly opted out',async()=>{
 const f=fixture();
 const {document}=await f.ensureHostedPaymentInvoice(f.base44,f.payment);
 const delivered=await f.deliverHostedPaymentDocument(f.base44,f.payment,document,{});
 assert.equal(delivered.state,'queued_or_sent');
 assert.equal(f.stats.messages.length,1);
 assert.equal(f.stats.messages[0].phone,'0501234567');
 assert.equal(f.stats.messages[0].email,'');
 assert.match(f.stats.messages[0].body,/2,018\.00/);
 assert.match(f.stats.messages[0].body,/https:\/\/newview.invoice4u.co.il/);
 assert.equal(f.stats.messages[0].idempotencyKey,'payment-receipt:'+ID);
 await f.deliverHostedPaymentDocument(f.base44,{...f.payment,is_interested_in_invoice:false},document,{});
 await f.deliverHostedPaymentDocument(f.base44,f.payment,document,{client_payment_receipt_enabled:'false'});
 assert.equal(f.stats.messages.length,1);
});
test('rounding adapter never rewrites processing fee line in hosted pipe payload',()=>{
 const fee=calculateProcessingFee({processing_fee_enabled:'true',processing_fee_type:'percent',
  processing_fee_value:'0.9',processing_fee_label:'עמלת סליקה'},2000);
 assert.equal(fee.amount,18);
 const result=itemsToPipedFields([
  {name:'מקדמה',quantity:1,price:1694.92},
  {name:'עמלת סליקה',quantity:1,price:15.25}
 ],18,2018);
 assert.equal(result.DocItemName,'מקדמה|עמלת סליקה');
 assert.equal(result.DocItemPrice.split('|')[1],'15.25');
});
test('standalone manual editor keeps gross VAT-inclusive unit price and calculates net with reverse VAT',()=>{
 let item={name:'Test',quantity:1,price:'',grossPrice:'',taxRate:18};
 item=editDocumentUnitPrice(item,'gross','2018',18);
 assert.equal(item.grossPrice,'2018');
 assert.equal(item.price,1710.17);
 assert.equal(itemUnitGross(item,18),2018);
 assert.equal(totalDocumentGross([item],18),2018);
 assert.equal(totalDocumentNet([item],18),1710.17);
 item=editDocumentUnitPrice(item,'net','2000',18);
 assert.equal(item.grossPrice,2360);
 item=editDocumentVatRate(item,'17');
 assert.equal(item.grossPrice,2340);
});
test('Invoice4U manual document with gross prices uses TaxIncluded true and exact total',()=>{
 const doc=buildDocumentBody({
  slug:'invoice_receipt',subject:'Test',taxIncluded:true,
  items:[{name:'Service',price:2000,quantity:1,taxRate:18},
    {name:'עמלת סליקה',price:18,quantity:1,taxRate:18}],
  payments:[{amount:2018,type:'credit_card',date:'2026-11-04'}],
  customer:{name:'Test Customer'},vatPercent:18
 });
 assert.equal(doc.TaxIncluded,true);
 assert.equal(doc.DocumentType,3);
 assert.equal(doc.Items[0].Price,2000);
 assert.equal(doc.Items[1].Price,18);
 assert.equal(doc.Items[0].TaxPercentage,18);
 assert.equal(doc.Payments[0].Amount,2018);
 const summary=summarizeItems([{price:2000,quantity:1,taxRate:18},
  {price:18,quantity:1,taxRate:18}],18,true);
 assert.equal(summary.total,2018);
 assert.equal(summary.totalWithoutTax,1710.17);
 assert.equal(summary.totalTax,307.83);
});
test('future agreement, direct, and link clearing paths all delegate invoice issuing to the verified callback',()=>{
 const agreement=fs.readFileSync('base44/functions/eventAgreement/entry.ts','utf8');
 const clearing=fs.readFileSync('base44/functions/invoice4uCreateClearingRequest/entry.ts','utf8');
 const callback=fs.readFileSync('base44/functions/invoice4uClearingCallback/entry.ts','utf8');
 for(const source of [agreement,clearing]){
  assert.match(source,/IsDocCreate\s*:\s*false/);
  assert.match(source,/auto_invoice_mode\s*:\s*HOSTED_INVOICE_MODE/);
  assert.match(source,/invoice_issuance_state\s*:\s*"pending"/);
 }
 assert.match(callback,/completeAgreementDeposit/);
 assert.match(callback,/ensureHostedPaymentInvoice/);
 assert.match(callback,/deliverHostedPaymentDocument/);
});
