import { buildDocumentBody, round2 } from './invoice4uDocuments.ts';
import { invoice4uErrors, invoice4uRequest, invoice4uToken } from './invoice4uClient.ts';
import { verifyLog } from './storedCardProvider.ts';
import { renderClientMessage, sendClientMessage } from './clientBillingMessages.ts';

// Only new, explicitly marked hosted-card payments may create a document here.
// Historic payments used Invoice4U's own auto-issuance; never mint a second
// document when replaying an older callback or repairing an old agreement.
export const HOSTED_INVOICE_MODE = 'post_charge_v1';
const identifier = (paymentId: string) => 'pulse-hosted-payment-'+paymentId+'-invoice-receipt';
const valid = (value:unknown) => /^[A-Za-z0-9_-]{3,128}$/.test(String(value||''));
const pdf = (url:unknown) => {
  const value = String(url||'');
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' &&
      ['newview.invoice4u.co.il','newviewqa.invoice4u.co.il'].includes(parsed.hostname) ? value : '';
  } catch {return '';}
};
const cipherUrl=(cipher:unknown,environment:string)=>{
  const value=String(cipher||'');
  return value ? 'https://'+(environment==='qa'?'newviewqa':'newview')+
    '.invoice4u.co.il/Views/PDF.aspx?cipher='+encodeURIComponent(value) : '';
};
const documentTotal=(payment:any)=>round2(Number(payment.amount)+Number(payment.processing_fee_amount||0));

export function hostedInvoiceItems(payment:any) {
  const base=round2(Number(payment.amount));
  const fee=round2(Number(payment.processing_fee_amount||0));
  if(!Number.isFinite(base)||base<=0||!Number.isFinite(fee)||fee<0)
    throw new Error('Invalid hosted payment items');
  const rows=[{name:String(payment.invoice_charge_label||'תשלום עבור אירוע').slice(0,280),
    quantity:1,price:base}];
  if(fee>0)rows.push({name:String(payment.invoice_fee_label||'עמלת סליקה').slice(0,280),
    quantity:1,price:fee});
  return rows;
}

function remoteDocumentIsValid(result:any,payment:any):boolean{
  return result && /^[0-9a-f-]{36}$/i.test(String(result.ID||'')) &&
    Number(result.DocumentNumber)>0 &&
    (!result.DocumentType || Number(result.DocumentType)===3) &&
    Number.isFinite(Number(result.Total)) &&
    Math.abs(round2(Number(result.Total))-documentTotal(payment))<=0.01;
}

function readProviderDocumentUrl(result:any,environment:string):string {
  return pdf(result.PrintOriginalPDFLink)||pdf(result.PrintCertifiedCopyPDFLink)||
    cipherUrl(result.CipherTextOriginal||result.CipherText,environment);
}
async function mirrorDocument(db:any,payment:any,result:any,environment:string) {
  const existing=await db.FinancialDocument.filter({linked_payment_id:payment.id},'-created_date',3);
  if(existing.length>1)throw new Error('Multiple financial documents require review');
  if(existing.length){
    if(existing[0].invoice4u_id && existing[0].invoice4u_id!==result.ID)
      throw new Error('Existing document belongs to a different provider ID');
    await db.Payment.update(payment.id,{
      financial_document_id:existing[0].id,
      invoice4u_document_number:String(existing[0].document_number||result.DocumentNumber),
      invoice_issuance_state:'issued',invoice_issuance_owner:''
    });
    return existing[0];
  }
  const total=documentTotal(payment);
  const tax=Number(result.TotalTaxAmount);
  const net=Number(result.TotalWithoutTax);
  const document=await db.FinancialDocument.create({
    document_type:'invoice_receipt',document_number:String(result.DocumentNumber),
    invoice4u_id:String(result.ID),invoice4u_unique_id:identifier(payment.id),
    status:'open',total,currency:payment.currency||'ILS',
    ...(Number.isFinite(tax)?{total_tax:round2(tax)}:{}),
    ...(Number.isFinite(net)?{total_without_tax:round2(net)}:{}),
    issue_date:new Date().toISOString(),linked_event_id:payment.event_id||'',
    linked_payment_id:payment.id,customer_name:payment.payer_name||'',
    pdf_original_url:pdf(result.PrintOriginalPDFLink)||cipherUrl(result.CipherTextOriginal,environment),
    pdf_certified_url:pdf(result.PrintCertifiedCopyPDFLink)||cipherUrl(result.CipherText,environment),
    cipher_text:String(result.CipherTextOriginal||result.CipherText||'')
  });
  await db.Payment.update(payment.id,{
    financial_document_id:document.id,invoice4u_document_number:document.document_number,
    invoice_issuance_state:'issued',invoice_issuance_owner:''
  });
  return document;
}

export async function ensureHostedPaymentInvoice(base44:any,payment:any):Promise<{
  state:string,document?:any
}> {
  if(payment?.auto_invoice_mode!==HOSTED_INVOICE_MODE)return {state:'legacy_payment'};
  if(!valid(payment.id))throw new Error('Invalid trusted payment identity');
  if(payment.payment_status!=='completed'||payment.invoice4u_clearing_status!=='approved')
    return {state:'unverified_payment'};
  if(!['qa','production'].includes(payment.invoice_environment))
    throw new Error('Payment invoice environment was not frozen');
  const db=base44.asServiceRole.entities;
  const found=await db.FinancialDocument.filter({linked_payment_id:payment.id},'-created_date',3);
  if(found.length>1)throw new Error('Ambiguous linked financial documents');
  if(found.length){
    const existing=found[0];
    await db.Payment.update(payment.id,{
      financial_document_id:existing.id,
      invoice4u_document_number:String(existing.document_number||''),
      invoice_issuance_state:'issued',invoice_issuance_owner:''
    });
    return {state:'issued',document:existing};
  }
  if(payment.financial_document_id)
    throw new Error('Payment references a document not found under its payment ID');

  // A newly issued hosted payment needs provider evidence before issuing a tax
  // document. Agreement deposit has already checked this exact clearing log.
  if(payment.agreement_id && payment.agreement_verified!==true)
    return {state:'pending_agreement_verification'};
  if(!payment.agreement_id){
    if(!payment.invoice4u_payment_id)
      return {state:'pending_provider_payment_id'};
    const key=invoice4uToken(payment.invoice_environment);
    if(!key)throw new Error('Invoice4U invoice token unavailable');
    await verifyLog({environment:payment.invoice_environment,key,purpose:'hosted'},{
      paymentId:String(payment.invoice4u_payment_id),amount:documentTotal(payment),
      currency:payment.currency||'ILS'
    },payment.created_date||new Date().toISOString());
  }

  const state=String(payment.invoice_issuance_state||'');
  if(!['pending','review','issuing'].includes(state))
    return {state:state||'invoice_state_missing'};
  if(state==='issuing' && Date.now()-Date.parse(payment.invoice_issuance_started_at||'')<300000)
    return {state:'busy'};
  const owner=crypto.randomUUID();
  const now=new Date().toISOString();
  const match:any={id:payment.id,auto_invoice_mode:HOSTED_INVOICE_MODE,
    invoice_issuance_state:state};
  if(state==='issuing'){
    match.invoice_issuance_owner=payment.invoice_issuance_owner||'';
    match.invoice_issuance_started_at=payment.invoice_issuance_started_at||'';
  }
  const claimed=await db.Payment.updateMany(match,{$set:{
    invoice_issuance_state:'issuing',invoice_issuance_owner:owner,
    invoice_issuance_started_at:now
  }});
  if(claimed?.updated!==1)return {state:'busy'};
  const environment=payment.invoice_environment;
  try{
    const token=invoice4uToken(environment);
    if(!token)throw new Error('Invoice4U token unavailable');
    const apiIdentifier=identifier(payment.id);
    // A previous call can commit at Invoice4U before its HTTP response is lost.
    // Look it up by immutable ApiIdentifier before any new creation attempt.
    let result:any;
    try {
      result=await invoice4uRequest(environment,'GetDocumentByApiIdentifier',{
        apiIdentifier,docType:3,token
      });
    } catch {
      // Fail closed on an uncertain lookup; do NOT try to create a potentially
      // duplicate document when the provider could not confirm absence.
      throw new Error('Invoice4U document lookup unavailable');
    }
    if(result && invoice4uErrors(result))
      throw new Error('Invoice4U document lookup returned an error');
    if(result && !result.ID)
      throw new Error('Invoice4U document lookup returned an ambiguous record');

    if(!result){
      const items=hostedInvoiceItems(payment);
      const lang=payment.document_language==='en'?'en':'he';
      const sendEmails=payment.is_interested_in_invoice!==false && payment.payer_email
        ? [payment.payer_email]:[];
      const doc=buildDocumentBody({
        slug:'invoice_receipt',subject:payment.invoice_charge_label||'תשלום באשראי',
        currency:payment.currency||'ILS',taxIncluded:true,
        items,payments:[{amount:documentTotal(payment),type:'credit_card',
          date:payment.payment_date||new Date().toISOString().slice(0,10)}],
        customer:{name:payment.payer_name||'לקוח',email:payment.payer_email||'',
          phone:payment.payer_phone||''},
        vatPercent:Number(payment.invoice_vat_percent)||18,
        language:lang,associatedEmails:sendEmails
      });
      doc.ApiIdentifier=apiIdentifier;
      result=await invoice4uRequest(environment,'CreateDocumentWithIdentifierValidation',{token,doc});
      const errs=Array.isArray(result?.Errors)?result.Errors:[];
      if(errs.length && !errs.every((e:any)=>Number(e.ID??e.Id)===134))
        throw new Error('Invoice4U document issuance rejected');
      if(errs.length){
        // A duplicate response proves provider idempotency, but may not
        // include Total or PDF tokens. Read the existing full document.
        result=await invoice4uRequest(environment,'GetDocumentByApiIdentifier',{
          apiIdentifier,docType:3,token
        });
        if(invoice4uErrors(result))throw new Error('Invoice4U duplicate-document read failed');
      }
    }
    if(!remoteDocumentIsValid(result,payment))
      throw new Error('Invoice4U document amount or identity does not match the payment');
    const document=await mirrorDocument(db,payment,result,environment);
    return {state:'issued',document};
  } catch(error){
    // An invoice may have been created at the provider even if the response
    // was lost. Never automatically mint another using a different key.
    try{
      await db.Payment.updateMany({id:payment.id,invoice_issuance_owner:owner},
        {$set:{invoice_issuance_state:'review',invoice_issuance_owner:''}});
    }catch{}
    throw error;
  }
}

export async function deliverHostedPaymentDocument(base44:any,payment:any,document:any,
  config:Record<string,string>) {
  // Explicit no-invoice requests and explicit administrator setting off remain
  // respected. Missing setting means automatic customer receipt is ON.
  if(payment.is_interested_in_invoice===false||config.client_payment_receipt_enabled==='false')
    return {state:'disabled'};
  const url=pdf(document?.pdf_original_url)||pdf(document?.pdf_certified_url);
  if(!url)return {state:'pdf_unavailable'};
  const symbol=payment.currency==='USD'?'$':'₪';
  const lang=payment.document_language==='en'?'en':'he';
  const businessName=config.business_name||config.company_name||'שירת הנבל';
  const total=documentTotal(payment);
  const body=renderClientMessage(config,'receipt',lang,{
    name:payment.payer_name||'',
    business_name:businessName,amount:symbol+total.toLocaleString('he-IL',{
      minimumFractionDigits:2,maximumFractionDigits:2
    }),document_url:url
  });
  const channels=await sendClientMessage(base44,{
    phone:payment.payer_phone,email:payment.payer_email,
    subject:lang==='en'?'Tax invoice / receipt - '+businessName:'חשבונית מס/קבלה - '+businessName,
    body,businessName,
    idempotencyKey:'payment-receipt:'+payment.id
  });
  return {state:'queued_or_sent',channels};
}
