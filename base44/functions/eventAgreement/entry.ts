import { createClientFromRequest } from "npm:@base44/sdk@0.8.50";
import { convert } from "npm:html-to-text@9.0.5";
import { agreementQuote } from "../../shared/agreementQuote.ts";
import { getEventContacts } from "../../shared/eventFields.js";
import { calculateAdvanceAmount, calculateProcessingFee, itemsToPipedFields } from "../../shared/eventBilling.ts";
import { beginSetup } from "../../shared/storedCardSetup.ts";
import { CardError, requireCards, reserveHostedPayment } from "../../shared/storedCards.ts";
import { providerCall, hasErrors, providerFailure } from "../../shared/storedCardProvider.ts";
import { secrets } from "base44:runtime";
import { normalizeIsraeliPhone } from "../../shared/whatsappSend.ts";
import { readAll } from "../../shared/eventReadiness.ts";
import { closingDefaults, canonical, digest, cleanText, defaultMilestones, validateMilestones, roundMoney, firstCompletedPayment } from "../../shared/agreementRules.ts";
import { AgreementError, audit, lockAgreement, settings, financials, deliver, reconcileAgreement } from "../../shared/agreementLifecycle.ts";
import { completeAgreementDeposit } from "../../shared/agreementDeposit.ts";
import { persistAgreementPdf } from "../../shared/agreementPdf.ts";
import { agreementLanguage, closingCopy, localizedAgreement, renderClosingMessage } from "../../shared/closingLanguage.ts";

import { closingClauses, withoutCardClauses } from "../../shared/closingClauses.ts";
import { reminderTime } from "../../shared/agreementReminderTime.ts";
import { milestoneEditPreview, updateAgreementMilestones } from "../../shared/agreementMilestoneChanges.ts";
import { effectiveDeposit, effectiveMilestones } from "../../shared/agreementRules.ts";
const APP="https://pulse-system.base44.app";
const textFromHtml=html=>convert(String(html||"").replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi,(full,attrs,label)=>{
  const href=attrs.match(/\bhref\s*=\s*(["'])(https?:\/\/[^"']+)\1/i)?.[2];
  return href?`[${label.replace(/<[^>]*>/g,"").trim()}](${href.replace(/&amp;/g,"&")})`:full;
 }),{wordwrap:false,selectors:[{selector:"img",format:"skip"}]});
const bool=(v,def)=>v===undefined?def:!!v;
function publicAgreement(a){return {
 id:a.id,version:a.version,state:a.state,snapshot:a.snapshot,content_hash:a.content_hash,
 effective_deposit:effectiveDeposit(a),payment_schedule:a.payment_schedule?{revision:a.payment_schedule.revision,updated_at:a.payment_schedule.updated_at,milestones:a.payment_schedule.rows.map(({id,position,label,amount,cumulative_amount,due_date})=>({id,position,label,amount,cumulative_amount,due_date}))}:null,
 require_token:a.require_token,require_deposit:a.require_deposit,signed_at:a.signed_at,
 token_state:a.token_state,deposit_state:a.deposit_state,deposit_received:a.deposit_received||0,deposit_method:a.deposit_method||"",pdf_state:a.pdf_state,copy_state:a.copy_state,
 completed_at:a.completed_at,verified_at:a.verified_at,opened_at:a.opened_at,active:a.active,
 signature:a.signature?{name:a.signature.name,role:a.signature.role,language:a.signature.language,strokes:a.signature.strokes,accepted:a.signature.accepted}:null
};}
async function requirePublic(client,body,session=false){
 const a=await client.entities.EventAgreement.get(cleanText(body.agreementId,80)).catch(()=>null);
 if(!a?.active)throw new AgreementError("הקישור אינו זמין או בוטל",403);
 const validSession=typeof body.session==="string"&&body.session.length<=100&&a.session_hash&&Date.parse(a.session_expires_at)>Date.now()&&await digest(body.session)===a.session_hash;
 const validLink=!session&&typeof body.token==="string"&&body.token.length<=100&&a.link_hash&&Date.parse(a.link_expires_at)>Date.now()&&await digest(body.token)===a.link_hash;
 if(!validSession&&!validLink)throw new AgreementError("הקישור פג תוקף או שנדרש אימות מחדש",403);
 return a;
}
function notifications(body,config){
 return {enabled:bool(body?.enabled,config.closing_reminder_enabled!=="false"),
 days:Math.min(60,Math.max(0,Math.floor(Number(body?.days??config.closing_reminder_days??3)||0))),
 time:/^([01]\d|2[0-3]):[0-5]\d$/.test(body?.time||"")?body.time:(config.closing_reminder_time||"09:00"),
 language:agreementLanguage(body?.language||config.closing_message_language),
 template:cleanText(body?.template||config[(body?.language||config.closing_message_language)==="en"?"closing_message_template_en":"closing_message_template"]||closingDefaults[(body?.language||config.closing_message_language)==="en"?"closing_message_template_en":"closing_message_template"],4000),
 notify_admin:bool(body?.notify_admin,config.closing_notify_admin!=="false")};
}
async function preview(client,base44,eventId,config){
 const event=await client.entities.Event.get(eventId);
 if(!event)throw new AgreementError("האירוע לא נמצא",404);
 const f=await financials(client,event,config);
 if(!Number.isFinite(f.finalTotal)||f.finalTotal<=0||!event.event_date)throw new AgreementError("נדרש מחיר ותאריך לאירוע לפני יצירת הסכם");
 const templates=await readAll(client.entities.QuoteTemplate,{template_type:"agreement_disclaimer"});
 const heTerms=String(config.closing_terms_text||"").trim()||textFromHtml(templates.find(x=>x.identifier==="default")?.content||templates[0]?.content||"");
 const enTerms=String(config.closing_terms_text_en||"").trim();
 const existingDeposit=Math.min(f.finalTotal,firstCompletedPayment(f.payments,f.currency,Number(config.usd_ils_exchange_rate)||3.6));
 const deposit=existingDeposit||calculateAdvanceAmount(config,f.finalTotal);
 const codes=["terms","token","regular","exceptional","fee","changes"];
 const translations=Object.fromEntries(["he","en"].map(lang=>{
  const en=lang==="en",copy=closingCopy[lang],compact=agreementQuote(event,f,lang);
  const feeText=config.processing_fee_enabled==="true"
   ?(en?"Card payments incur a processing fee under the settings at the time of this agreement: ":"בתשלום באשראי תתווסף עלות סליקה לפי הגדרות הסליקה במועד הסכם זה: ")+config.processing_fee_value+(config.processing_fee_type==="fixed"?" "+f.currency+(en?" per charge.":" לכל חיוב."):en?"% of the charged amount.":"% מסכום החיוב.")
   :copy.fee;
  const texts=[copy.terms,copy.token,config[en?"closing_regular_text_en":"closing_regular_text"]||closingDefaults[en?"closing_regular_text_en":"closing_regular_text"],config[en?"closing_exceptional_text_en":"closing_exceptional_text"]||closingDefaults[en?"closing_exceptional_text_en":"closing_exceptional_text"],feeText,config[en?"closing_changes_text_en":"closing_changes_text"]||closingDefaults[en?"closing_changes_text_en":"closing_changes_text"]];
  return [lang,{terms:en?enTerms:heTerms,clauses:codes.map((code,i)=>({code,label:copy.labels[i],text:texts[i]})),quote_text:compact.quote,pricing_note:compact.summary.pricing_note,milestones:defaultMilestones(f.finalTotal,deposit,event.event_date,undefined,lang)}];
 }));
 const form_language=enTerms?agreementLanguage(config.closing_form_language):"he";
 const selected=translations[form_language];
 const compact=agreementQuote(event,f,form_language);
 const sourceHash=await digest(canonical({translations,quoteFile:compact.quoteFile,total:f.finalTotal,currency:f.currency,event_date:event.event_date,existingDeposit}));
 return {event,sourceHash,translations,available_languages:enTerms?["he","en"]:["he"],form_language,message_language:agreementLanguage(config.closing_message_language),quote:selected.quote_text,quote_summary:compact.summary,quote_file:compact.quoteFile,terms:selected.terms,total:f.finalTotal,currency:f.currency,deposit,existing_deposit:existingDeposit,bank_details:cleanText(config.company_bank_details,1000),contacts:getEventContacts(event).map(c=>({name:c.name||"",phone:c.phone||"",email:c.email||""})),
 milestones:selected.milestones,regular_cap:existingDeposit>0?roundMoney(Math.max(0,f.balance)):roundMoney(f.finalTotal*Number(config.closing_regular_multiplier||1)),exceptional_cap:roundMoney(f.finalTotal*Number(config.closing_exceptional_multiplier||2)),
 clauses:selected.clauses,exceptional_notice:config.closing_exceptional_notice!=="false",exceptional_notice_days:Math.max(0,Number(config.closing_exceptional_notice_days)||0),require_token:config.closing_token_required!=="false",require_deposit:config.closing_deposit_required!=="false",
 send_copy:config.closing_send_copy!=="false",notifications:notifications({language:agreementLanguage(config.closing_message_language)},config)};
}
function validateSignature(body){
 const name=cleanText(body.name,120);if(name.length<2)throw new AgreementError("יש למלא את שם החותם");
 const strokes=body.strokes;
 if(!Array.isArray(strokes)||strokes.length<1||strokes.length>100)throw new AgreementError("נדרשת חתימה מצוירת");
 let count=0,movement=0;
 for(const line of strokes){
  if(!Array.isArray(line)||line.length<2)throw new AgreementError("חתימה לא תקינה");
  count+=line.length;
  for(let i=0;i<line.length;i++){
   const point=line[i];if(!Array.isArray(point)||point.length!==2||point.some(n=>typeof n!=="number"||!Number.isFinite(n)||n<0||n>1))throw new AgreementError("חתימה לא תקינה");
   if(i)movement+=Math.hypot(point[0]-line[i-1][0],point[1]-line[i-1][1]);
  }
 }
 if(count>12000||count<5||movement<0.03)throw new AgreementError("נדרשת חתימה ברורה");
 return {name,role:cleanText(body.role,120),strokes};
}
async function finishDocument(client,a){
 const consent=await readAll(client.entities.ConsentClause,{agreement_id:a.id});
 for(const c of localizedAgreement(a.snapshot,a.signature?.language).clauses)if(!consent.some(x=>x.code===c.code))await client.entities.ConsentClause.create({agreement_id:a.id,event_id:a.event_id,code:c.code,text:c.text,version:a.version,accepted_at:a.signed_at});
 try{a=await persistAgreementPdf(client,a);}
 catch{return await client.entities.EventAgreement.update(a.id,{pdf_state:"failed"});}
 if(a.send_copy&&a.copy_state==="pending"){
  await client.entities.EventAgreement.update(a.id,{copy_state:"dispatching"});
  try{
   const {signed_url}=await client.integrations.Core.CreateFileSignedUrl({file_uri:a.pdf_uri,expires_in:3600});
   const d=await deliver(client,a,"signed_copy",a.id+":signed_copy",renderClosingMessage(await settings(client),"signed",a.notifications?.language||a.snapshot.message_language,{event_name:a.snapshot.event_name,customer_name:a.recipient_name}),{url:signed_url,name:"agreement-"+a.id+".pdf"});
   a=await client.entities.EventAgreement.update(a.id,{copy_state:d.state});
  }catch{a=await client.entities.EventAgreement.update(a.id,{copy_state:"unknown"});}
 }
 return a;
}
async function createDeposit(client,a,config){
 const event=await client.entities.Event.get(a.event_id),f=await financials(client,event,config);
 if(event.closing_agreement_id!==a.id||f.currency!==a.snapshot.currency||Math.abs(f.finalTotal-a.snapshot.total)>0.01)throw new AgreementError("פרטי ההזמנה השתנו; נדרשת גרסה מעודכנת");
 const amount=roundMoney(Math.max(0,effectiveDeposit(a)-f.totalPaid));
 if(!amount)return {paid:true};
 const old=f.payments.find(p=>p.agreement_id===a.id&&p.payment_status==="pending");
 if(old){if(old.payment_link_url)return {redirectUrl:old.payment_link_url};throw new AgreementError("בקשת מקדמה בבירור. אין ליצור בקשה נוספת.",409);}
 if(f.payments.some(p=>p.payment_status==="pending"))throw new AgreementError("קיים תשלום ממתין באירוע. יש לברר אותו לפני יצירת מקדמה נוספת.",409);
 const environment=config.invoice4u_env==="production"?"production":"qa";
 const key=secrets.get(environment==="qa"?"INVOICE4U_API_TOKEN_QA":"INVOICE4U_API_TOKEN");
 if(environment==="qa" && event.stored_card_qa_only!==true)throw new AgreementError("תשלום בדיקה מותר רק באירוע טסט",409);
 if(!Number(config.invoice4u_clearing_company_type))throw new AgreementError("חסר סוג חברת סליקה",503);
 if(!key)throw new AgreementError("לא הוגדר מפתח לסביבת התשלום",503);
 const fee=calculateProcessingFee(a.snapshot.fee_config,amount),total=roundMoney(amount+fee.amount),cb=crypto.randomUUID()+crypto.randomUUID();
 const payment=await reserveHostedPayment(client,event,config,amount,f.currency,()=>client.entities.Payment.create({
  event_id:event.id,agreement_id:a.id,agreement_environment:environment,agreement_verified:false,
  amount,currency:f.currency,payment_date:new Date().toISOString().slice(0,10),payment_method:"credit_card",payment_status:"pending",clearing_method:"hosted_page",charge_type:"advance",
  processing_fee_amount:fee.amount,payer_name:a.recipient_name,payer_phone:a.recipient_phone,payer_email:a.recipient_email||"",invoice4u_callback_token:cb,document_language:a.signature?.language||a.snapshot.form_language||"he",is_payment_link:false,notes:"מקדמה לפי הסכם "+a.id
 }));
 const vat=Number(config.vat_rate)||18;
 try{
  const result=await providerCall({environment,key,purpose:"hosted"},"ProcessApiRequestV2",{request:{
   Invoice4UUserApiKey:key,Sum:total,Currency:f.currency==="ILS"?"NIS":f.currency,Type:1,CreditCardCompanyType:Number(config.invoice4u_clearing_company_type),
   FullName:a.recipient_name,Phone:a.recipient_phone,Email:a.recipient_email||"",Description:(a.signature?.language==="en"?"Advance payment for ":"מקדמה עבור ")+event.event_name,
   OrderIdClientUsage:payment.id,IsDocCreate:true,IsManualDocCreationsWithParams:true,
   ...itemsToPipedFields([{name:(a.signature?.language==="en"?"Advance payment for ":"מקדמה עבור ")+event.event_name,quantity:1,price:total/(1+vat/100)}],vat,total),
   Language:a.signature?.language||a.snapshot.form_language||"he",IsQaMode:environment==="qa",Platform:"Pulse",
   ReturnUrl:APP+"/EventClosing?id="+a.id,CallBackUrl:APP+"/functions/invoice4uClearingCallback?token="+cb
  }});
  if(hasErrors(result)){
   await client.entities.Payment.update(payment.id,{payment_status:"failed",invoice4u_clearing_status:providerFailure(result).code});
   throw new AgreementError("הספק דחה את הבקשה: "+providerFailure(result).code);
  }
  if(!result.ClearingRedirectUrl||!String(result.ClearingRedirectUrl).startsWith("https://"))throw new Error("redirect unavailable");
  await client.entities.Payment.update(payment.id,{payment_link_url:result.ClearingRedirectUrl});
  await audit(client,a,"deposit_link_created","customer",{payment_id:payment.id});
  return {redirectUrl:result.ClearingRedirectUrl};
 }catch(e){if(e instanceof AgreementError)throw e;throw new AgreementError("תוצאת יצירת התשלום בבירור; יש לפנות למנהל לפני ניסיון נוסף.",409);}
}
export default Deno.serve(async req=>{
 try{
  if(req.method==="GET"){
   const params=new URL(req.url).searchParams;
   if(params.get("kind")!=="signed_quote")return Response.json({error:"Not found"},{status:404});
   const id=params.get("id")||"",proof=params.get("proof")||"";
   if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id)||!/^[a-f0-9]{64}$/.test(proof))return Response.json({error:"Not found"},{status:404});
   const client=createClientFromRequest(req).asServiceRole;
   const a=await client.entities.EventAgreement.get(id).catch(()=>null);
   if(!a?.signed_at||a.signature_hash!==proof||!a.snapshot?.quote_file?.file_uri)return Response.json({error:"Not found"},{status:404});
   const {signed_url}=await client.integrations.Core.CreateFileSignedUrl({file_uri:a.snapshot.quote_file.file_uri,expires_in:300});
   return new Response(null,{status:302,headers:{Location:signed_url,"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
  }
  if(req.method!=="POST")return Response.json({error:"Method not allowed"},{status:405});
  const raw=await req.text();if(raw.length>400000)throw new AgreementError("בקשה גדולה מדי",413);
  const body=JSON.parse(raw),action=body.action;
  const base44=createClientFromRequest(req),client=base44.asServiceRole;
  if(["open","otp","verify","admin_verify","view","sign","token","deposit","choose_deposit_method","document"].includes(action)){
   let a=await requirePublic(client,body,!["open","otp","verify","admin_verify"].includes(action));
   return await lockAgreement(client,a,action,async current=>{
    a=current;
    // Remove waived card consents only before signature; signed versions remain immutable.
    if(!a.signed_at&&!a.require_token){
     const snapshot=withoutCardClauses(a.snapshot),contentHash=await digest(canonical(snapshot));
     if(contentHash!==a.content_hash)a=await client.entities.EventAgreement.update(a.id,{snapshot,content_hash:contentHash});
    }
    if(action==="open"){
     if(!a.opened_at){await client.entities.EventAgreement.update(a.id,{opened_at:new Date().toISOString()});await audit(client,a,"opened","link");}
     return Response.json({id:a.id,phone:"••••"+a.recipient_phone.slice(-4),signed:!!a.signed_at});
    }
    if(action==="otp"){
     if((a.otp_sends||0)>=3||(a.otp_attempts||0)>=5)throw new AgreementError("מכסת האימות מוצתה. יש לבקש קישור חדש מהמנהל.",429);
     if(a.otp_sent_at&&Date.now()-Date.parse(a.otp_sent_at)<60000)throw new AgreementError("ניתן לשלוח קוד נוסף לאחר דקה",429);
     const n=crypto.getRandomValues(new Uint32Array(1))[0]%1000000,code=String(n).padStart(6,"0");
     await client.entities.EventAgreement.update(a.id,{otp_hash:await digest(a.id+":"+code),otp_sent_at:new Date().toISOString(),otp_expires_at:new Date(Date.now()+600000).toISOString(),otp_sends:(a.otp_sends||0)+1});
     await deliver(client,a,"verification",a.id+":otp:"+((a.otp_sends||0)+1),renderClosingMessage(await settings(client),"otp",a.notifications?.language||a.snapshot.message_language,{code,customer_name:a.recipient_name,event_name:a.snapshot.event_name}));
     await audit(client,a,"verification_sent","customer");return Response.json({sent:true});
    }
    if(action==="admin_verify"){
     let admin;try{admin=await base44.auth.me();}catch{}
     if(admin?.role!=="admin")throw new AgreementError("אימות מנהל מחייב התחברות כמנהל",403);
     if((a.otp_attempts||0)>=5)throw new AgreementError("מכסת ניסיונות האימות מוצתה",429);
     if(!/^[a-zA-Z0-9-]{40,100}$/.test(body.session||""))throw new AgreementError("מזהה הפעלה לא תקין");
     const expected=secrets.get("EVENT_CLOSING_ADMIN_PASSWORD");
     if(!expected)throw new AgreementError("לא הוגדרה סיסמת מנהל",503);
     await client.entities.EventAgreement.update(a.id,{otp_attempts:(a.otp_attempts||0)+1});
     if(typeof body.password!=="string"||body.password.length>200||await digest(body.password)!==await digest(expected))throw new AgreementError("סיסמת מנהל שגויה",403);
     a=await client.entities.EventAgreement.update(a.id,{otp_hash:"",session_hash:await digest(body.session),session_expires_at:new Date(Date.now()+2*86400000).toISOString(),verified_at:new Date().toISOString()});
     await audit(client,a,"admin_verified",admin.id);return Response.json(publicAgreement(a));
    }
    if(action==="verify"){
     if((a.otp_attempts||0)>=5)throw new AgreementError("מכסת ניסיונות האימות מוצתה",429);
     await client.entities.EventAgreement.update(a.id,{otp_attempts:(a.otp_attempts||0)+1});
     if(!a.otp_hash||Date.parse(a.otp_expires_at)<Date.now()||await digest(a.id+":"+String(body.code))!==a.otp_hash)throw new AgreementError("קוד שגוי או שפג תוקפו",403);
     if(!/^[a-zA-Z0-9-]{40,100}$/.test(body.session||""))throw new AgreementError("מזהה הפעלה לא תקין");
     a=await client.entities.EventAgreement.update(a.id,{otp_hash:"",session_hash:await digest(body.session),session_expires_at:new Date(Date.now()+2*86400000).toISOString(),verified_at:new Date().toISOString()});
     await audit(client,a,"verified","customer");return Response.json(publicAgreement(a));
    }
    if(action==="view"){await reconcileAgreement(client,a.event_id);a=await client.entities.EventAgreement.get(a.id);return Response.json(publicAgreement(a));}
    if(action==="sign"){
     if(a.signed_at){a=await finishDocument(client,a);await reconcileAgreement(client,a.event_id);return Response.json(publicAgreement(await client.entities.EventAgreement.get(a.id)));}
     if(body.contentHash!==a.content_hash)throw new AgreementError("נוסח ההסכם השתנה; יש לרענן",409);
     const sig=validateSignature(body);
     const language=agreementLanguage(body.language||a.snapshot.form_language);
     if(language==="en"&&!a.snapshot.translations?.en?.terms)throw new AgreementError("English terms have not been configured for this agreement",409);
     const accepted=Object.fromEntries(a.snapshot.clauses.map(c=>[c.code,body.accepted?.[c.code]===true]));
     if(Object.values(accepted).some(v=>!v))throw new AgreementError("נדרש אישור נפרד לכל סעיף");
     const signature={...sig,language,accepted,verified_at:a.verified_at,ip:cleanText(req.headers.get("x-forwarded-for")?.split(",")[0]||req.headers.get("x-real-ip"),100),user_agent:cleanText(req.headers.get("user-agent"),500),session_fingerprint:a.session_hash};
     const signedAt=new Date().toISOString();
     a=await client.entities.EventAgreement.update(a.id,{signature,signature_hash:await digest(canonical({signature,content_hash:a.content_hash,signed_at:signedAt})),signed_at:signedAt,state:"signed",link_hash:"",otp_hash:"",pdf_state:"pending"});
     await audit(client,a,"signed","customer",{content_hash:a.content_hash,signature_hash:a.signature_hash});
     a=await finishDocument(client,a);await reconcileAgreement(client,a.event_id);
     return Response.json(publicAgreement(await client.entities.EventAgreement.get(a.id)));
    }
    // Read-only access to the exact proposal frozen in this agreement; existing verified-session authorization applies.
    if(action==="document"&&body.kind==="quote"){
     if(!a.snapshot.quote_file?.file_uri)throw new AgreementError("לא צורפה הצעת מחיר לגרסה זו",404);
     const {signed_url}=await client.integrations.Core.CreateFileSignedUrl({file_uri:a.snapshot.quote_file.file_uri,expires_in:600});
     return Response.json({url:signed_url});
    }
    if(!a.signed_at)throw new AgreementError("יש לחתום לפני שמירת כרטיס או תשלום",409);
    if(action==="document"){
     a=await finishDocument(client,a);if(!a.pdf_uri)throw new AgreementError("החתימה נשמרה; הפקת המסמך ממתינה לטיפול",503);
     const {signed_url}=await client.integrations.Core.CreateFileSignedUrl({file_uri:a.pdf_uri,expires_in:600});
     return Response.json({url:signed_url});
    }
    const config=await settings(client);
    if(action==="choose_deposit_method"){
     if(!a.require_deposit||a.deposit_state==="paid")return Response.json(publicAgreement(a));
     if(body.method!=="bank"||!a.snapshot.bank_details)throw new AgreementError("לא הוגדרו פרטי העברה בנקאית",409);
     a=await client.entities.EventAgreement.update(a.id,{deposit_method:"bank"});
     await audit(client,a,"deposit_bank_selected","customer");
     return Response.json(publicAgreement(a));
    }
    if(action==="deposit"){
    if(!a.require_deposit)throw new AgreementError("המקדמה בוטלה בהסכם זה",409);
    return Response.json(await createDeposit(client,a,config));
   }
    if(action==="token"){
     requireCards(config);
     if(!a.require_token||!a.signature.accepted.token)throw new AgreementError("לא קיימת הרשאה לשמירת כרטיס",403);
     const event=await client.entities.Event.get(a.event_id);
     if(event.closing_agreement_id!==a.id)throw new AgreementError("נוצר הסכם חדש; יש להשתמש בו",409);
     let customer=a.customer_id?await client.entities.BillingCustomer.get(a.customer_id).catch(()=>null):null;
     if(customer?.deleted_at)customer=null;
     if(customer&&normalizeIsraeliPhone(customer.phone)!==normalizeIsraeliPhone(a.recipient_phone))throw new AgreementError("פרטי הלקוח המשלם אינם תואמים לחותם",409);
     if(customer?.active_card_id){const verified=await reconcileAgreement(client,a.event_id);if(verified?.token_state==="verified")return Response.json({verified:true});throw new AgreementError("הכרטיס הקיים אינו מאומת בסביבה הנוכחית; יש לפנות למנהל",409);}
     if(customer?.busy_operation_id?.startsWith("setup:")){
      const setup=await client.entities.CardSetupRequest.get(customer.busy_operation_id.slice(6));
      if(setup?.state==="pending"&&Date.parse(setup.expires_at)>Date.now())return Response.json({redirectUrl:setup.redirect_url});
      throw new AgreementError("בקשת כרטיס קודמת בטיפול. יש לפנות למנהל.",409);
     }
     if(!customer){
      if(event.billing_customer_id)throw new AgreementError("יש לאמת את שיוך הלקוח המשלם עם המנהל",409);
      customer=await client.entities.BillingCustomer.create({name:a.recipient_name,phone:a.recipient_phone,email:a.recipient_email||"",provisional:true,active_card_id:"",busy_operation_id:"",revision:0});
      const bound=await client.entities.Event.updateMany({id:event.id,updated_date:event.updated_date},{$set:{billing_customer_id:customer.id}});
      if(bound.updated!==1){await client.entities.BillingCustomer.delete(customer.id);throw new AgreementError("פרטי האירוע השתנו",409);}
      a=await client.entities.EventAgreement.update(a.id,{customer_id:customer.id});
     }
     const result=await beginSetup(client,{id:a.created_by_user_id},config,customer,"הסכם חתום "+a.id+" "+a.content_hash,a.event_id,!!customer.provisional,a);
     await audit(client,a,"token_link_created","customer",{setup_id:result.setupId});
     return Response.json(result);
    }
    throw new AgreementError("פעולה לא נתמכת");
   });
  }
  let user;try{user=await base44.auth.me();}catch{}
  if(user?.role!=="admin")throw new AgreementError("נדרשת הרשאת מנהל",403);
  const config={...closingDefaults,...await settings(client)};
  if(action==="reconcile"){await reconcileAgreement(client,body.eventId,config);return Response.json({success:true});}
  if(action==="payment_only_policy"){
   if(typeof body.approved!=="boolean")throw new AgreementError("יש לבחור אם לפטור מחתימה ומכרטיס");
   const event=await client.entities.Event.get(body.eventId);
   if(!event)throw new AgreementError("האירוע לא נמצא",404);
   const saved=await client.entities.Event.updateMany({id:event.id,updated_date:event.updated_date},{$set:{
    closing_payment_only_approved:body.approved,closing_payment_only_approved_by:user.id,
    closing_payment_only_approved_at:new Date().toISOString()
   }});
   if(saved.updated!==1)throw new AgreementError("האירוע השתנה; יש לרענן",409);
   await reconcileAgreement(client,event.id,config);
   return Response.json({success:true});
  }
  if(action==="preview"){
   const p=await preview(client,base44,body.eventId,config);
   return Response.json({...p,event:undefined});
  }
  if(action==="link_existing_card"){
   const event=await client.entities.Event.get(body.eventId);
   if(!event?.closing_agreement_id)throw new AgreementError("אין הסכם פעיל לאירוע",409);
   const a=await client.entities.EventAgreement.get(event.closing_agreement_id);
   if(!a?.active||!a.signed_at||!a.signature?.accepted?.token)throw new AgreementError("נדרשת הרשאה חתומה לשימוש בכרטיס",409);
   if(a.customer_id&&a.customer_id!==event.billing_customer_id)throw new AgreementError("ההסכם מקושר ללקוח משלם אחר; נדרשת גרסה מוסכמת חדשה",409);
   return await lockAgreement(client,a,"link_card",async current=>{
    const freshEvent=await client.entities.Event.get(event.id);
    if(freshEvent.closing_agreement_id!==current.id||!freshEvent.billing_customer_id||current.customer_id&&current.customer_id!==freshEvent.billing_customer_id)throw new AgreementError("שיוך הלקוח השתנה; נדרשת גרסה מוסכמת חדשה",409);
    const customer=await client.entities.BillingCustomer.get(freshEvent.billing_customer_id);
    if(!customer||customer.deleted_at||customer.provisional||!customer.active_card_id||customer.busy_operation_id)throw new AgreementError("אין ללקוח כרטיס פעיל וזמין",409);
    if(!normalizeIsraeliPhone(customer.phone)||normalizeIsraeliPhone(customer.phone)!==normalizeIsraeliPhone(current.recipient_phone))throw new AgreementError("טלפון בעל הכרטיס אינו תואם לטלפון החותם",409);
    const card=await client.entities.StoredCard.get(customer.active_card_id);
    if(!card||card.customer_id!==customer.id||card.state!=="active"||card.environment!==(config.stored_cards_env==="production"?"production":"qa")||(card.environment==="qa"&&freshEvent.stored_card_qa_only!==true))throw new AgreementError("הכרטיס אינו זמין בסביבת האירוע",409);
    if(current.customer_id!==customer.id){await client.entities.EventAgreement.update(current.id,{customer_id:customer.id});await audit(client,current,"card_linked",user.id,{customer_id:customer.id,card_id:card.id});}
    await reconcileAgreement(client,event.id,config);
    return Response.json({success:true});
   });
  }
  if(action==="recover_deposit"){
   const p=await client.entities.Payment.get(body.paymentId);
   if(!p?.agreement_id||p.event_id!==body.eventId)throw new AgreementError("תשלום לא מתאים",409);
   return Response.json(await completeAgreementDeposit(client,p));
  }
  if(action==="list"){
   await reconcileAgreement(client,body.eventId,config);
   const rows=await readAll(client.entities.EventAgreement,{event_id:body.eventId});
   rows.sort((a,b)=>b.version-a.version);
   const current=rows.find(a=>a.active);
   return Response.json({agreements:rows.map(publicAgreement),current:current?{...publicAgreement(current),notifications:current.notifications,send_copy:current.send_copy,busy_operation:!!current.busy_operation,busy_started_at:current.busy_started_at}:null,
    audit:current?await readAll(client.entities.AgreementAuditEvent,{agreement_id:current.id}):[],
    milestones:current?effectiveMilestones(current,await readAll(client.entities.PaymentMilestone,{agreement_id:current.id})):[],
    deliveries:current?await readAll(client.entities.ClientMessageDelivery,{agreement_id:current.id}):[],
    amendments:current?await readAll(client.entities.AgreementAmendment,{agreement_id:current.id}):[],
    deposits:(await readAll(client.entities.Payment,{event_id:body.eventId})).filter(p=>p.agreement_id&&p.clearing_method==="hosted_page").map(p=>({id:p.id,amount:p.amount,status:p.payment_status,verified:p.agreement_verified,canRecover:!!p.agreement_callback,pending:p.payment_status==="pending"}))});
  }
  if(action==="create"){
   const p=await preview(client,base44,body.eventId,config);
   const executeCreate=async lockedId=>{
   if(body.sourceHash!==p.sourceHash)throw new AgreementError("פרטי האירוע השתנו מאז התצוגה; יש לפתוח טיוטה מחדש",409);
   const formLanguage=agreementLanguage(body.form_language);
   if(formLanguage==="en"&&!p.available_languages.includes("en"))throw new AgreementError("יש להגדיר תנאי התקשרות באנגלית לפני בחירה בטופס באנגלית",409);
   const name=cleanText(body.name,120),phone=normalizeIsraeliPhone(body.phone),email=cleanText(body.email,200);
   if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new AgreementError("כתובת אימייל לא תקינה");
   if(!name||!phone)throw new AgreementError("נדרשים שם וטלפון תקינים");
   let customer=null;
   if(p.event.billing_customer_id){
    customer=await client.entities.BillingCustomer.get(p.event.billing_customer_id);
    if(customer?.busy_operation_id)throw new AgreementError("פעולת כרטיס בטיפול; יש להשלימה לפני יצירת גרסה",409);
    if(customer?.deleted_at||normalizeIsraeliPhone(customer?.phone)!==phone)throw new AgreementError("הטלפון חייב להתאים ללקוח המשלם המקושר. אפשר לנתק או לשנות את הלקוח באירוע.");
   }
   if(!customer){
    const matches=(await readAll(client.entities.BillingCustomer)).filter(c=>!c.deleted_at&&normalizeIsraeliPhone(c.phone)===phone);
    if(matches.length>1)throw new AgreementError("נמצאו מספר לקוחות עם אותו טלפון. יש לבחור לקוח משלם בכרטיסיית האירוע",409);
    customer=matches[0]||null;
    if(customer?.busy_operation_id)throw new AgreementError("לקוח עם טלפון זה נמצא בתהליך שמירת כרטיס או גבייה; יש להשלים אותו תחילה",409);
   }
   const old=await readAll(client.entities.EventAgreement,{event_id:body.eventId});
   if(old.some(a=>a.busy_operation&&a.id!==lockedId))throw new AgreementError("קיימת פעולה בהסכם קודם",409);
   let milestones;try{
    const rows=body.require_deposit===false&&Array.isArray(body.milestones)&&body.milestones.length>1&&Number(body.milestones[0].amount)>0
     ?body.milestones.map((m,i)=>i===0?{...m,amount:0}:i===1?{...m,amount:roundMoney(Number(m.amount)+Number(body.milestones[0].amount))}:m)
     :body.milestones;
    milestones=validateMilestones(rows,p.total);
    if(body.require_deposit!==false&&p.existing_deposit>0&&Math.abs(milestones[0].amount-p.existing_deposit)>0.01)throw new Error("התשלום הראשון שכבר נקלט הוא סכום המקדמה בהסכם");
    if(body.require_deposit===false&&milestones[0].amount>0)throw new Error("יש להגדיר אבן דרך נוספת כשמוותרים על מקדמה");
   }catch(e){throw new AgreementError(e.message);}
   const regular=roundMoney(body.regular_cap),exceptional=roundMoney(body.exceptional_cap);
   if(!Number.isFinite(regular)||!Number.isFinite(exceptional)||regular<0||exceptional<0)throw new AgreementError("תקרות חיוב לא תקינות");
   const baseVariant=p.translations[formLanguage];
   const clauses=closingClauses(baseVariant.clauses,!!body.require_token,!!body.require_deposit).map(c=>({...c,text:cleanText(body.clauses?.find(x=>x.code===c.code)?.text||c.text,12000)}));
   const terms=cleanText(body.terms||baseVariant.terms,60000);if(!terms)throw new AgreementError("יש להגדיר תנאי התקשרות לפני שליחה");
   const notification=notifications({...body.notifications,language:body.message_language},config);
   const translations=Object.fromEntries(Object.entries(p.translations).map(([lang,base])=>{
    const supplied=body.translations?.[lang]||{};
    return [lang,{...base,
     terms:lang===formLanguage?terms:cleanText(supplied.terms||base.terms,60000),
     clauses:lang===formLanguage?clauses:closingClauses(base.clauses,!!body.require_token,!!body.require_deposit).map(c=>({...c,text:cleanText(supplied.clauses?.find(x=>x.code===c.code)?.text||c.text,12000)})),
     milestones:milestones.map((m,i)=>({...m,label:cleanText(lang===formLanguage?m.label:(supplied.milestones?.[i]?.label||base.milestones[i]?.label),150)}))
    }];
   }));
   const snapshot={recipient_name:name,recipient_phone:phone,recipient_email:email,event_id:body.eventId,event_name:p.event.event_name,event_date:p.event.event_date,total:p.total,currency:p.currency,form_language:formLanguage,message_language:notification.language,translations,quote_text:baseVariant.quote_text,quote_summary:p.quote_summary,quote_file:p.quote_file,terms,clauses,milestones,
    deposit:milestones[0].amount,deposit_paid_at_creation:!!body.require_deposit&&p.existing_deposit>0,bank_details:p.bank_details,regular_cap:regular,regular_cap_paid_offset:p.existing_deposit>0?roundMoney(p.quote_summary.paid):0,exceptional_cap:exceptional,
    fee_config:Object.fromEntries(["processing_fee_enabled","processing_fee_type","processing_fee_value","processing_fee_label"].map(k=>[k,config[k]||""])),
    exceptional_notice:config.closing_exceptional_notice!=="false",exceptional_notice_days:Math.max(0,Number(config.closing_exceptional_notice_days)||0),
    require_token:!!body.require_token,require_deposit:!!body.require_deposit};
   const a=await client.entities.EventAgreement.create({
    event_id:body.eventId,version:Math.max(0,...old.map(x=>x.version))+1,state:"draft",active:false,revision:0,busy_operation:"",
    created_by_user_id:user.id,recipient_name:name,recipient_phone:phone,recipient_email:email,customer_id:customer?.id||"",
    snapshot,content_hash:await digest(canonical(snapshot)),require_token:!!body.require_token,require_deposit:!!body.require_deposit,
    send_copy:!!body.send_copy,copy_state:body.send_copy?"pending":"disabled",token_state:"pending",deposit_state:body.require_deposit?(p.existing_deposit?"paid":"pending"):"waived",deposit_received:p.existing_deposit||0,pdf_state:"not_signed",
    otp_sends:0,otp_attempts:0,closing_applied:false,notifications:notification
   });
   for(const m of milestones)await client.entities.PaymentMilestone.create({...m,agreement_id:a.id,event_id:body.eventId,state:"pending",message_state:"pending",
    notify_at:reminderTime(m.due_date,notification.days,notification.time),notification_enabled:notification.enabled,template:notification.template});
   const bound=await client.entities.Event.updateMany({id:body.eventId,updated_date:p.event.updated_date},{$set:{closing_agreement_id:a.id,closing_manual_override:false,closing_payment_only_approved:false,...(customer?{billing_customer_id:customer.id}:{})}});
   if(bound.updated!==1)throw new AgreementError("האירוע השתנה; הטיוטה לא הופעלה",409);
   for(const previous of old.filter(x=>x.active)){
    await client.entities.EventAgreement.update(previous.id,{active:false,link_hash:"",session_hash:""});
    await audit(client,previous,"superseded",user.id,{new_agreement_id:a.id});
   }
   await client.entities.EventAgreement.update(a.id,{active:true});
   await audit(client,a,"created",user.id,{require_token:a.require_token,require_deposit:a.require_deposit});
   return Response.json(publicAgreement({...a,active:true}));
   };
   const previous=p.event.closing_agreement_id?await client.entities.EventAgreement.get(p.event.closing_agreement_id):null;
   return previous?await lockAgreement(client,previous,"new_version",()=>executeCreate(previous.id)):await executeCreate(null);
  }
  let a=await client.entities.EventAgreement.get(body.agreementId);
  if(!a)throw new AgreementError("ההסכם לא נמצא",404);
  if(action==="recover_workflow"){
   if(!a.busy_operation||!a.busy_started_at||Date.parse(a.busy_started_at)>Date.now()-300000)throw new AgreementError("אין פעולה ישנה לשחרור; יש להמתין לפחות חמש דקות",409);
   if(a.busy_operation.startsWith("charge:"))throw new AgreementError("יש לברר את פעולת הגבייה דרך הכרטיס השמור",409);
   const cleared=await client.entities.EventAgreement.updateMany({id:a.id,busy_operation:a.busy_operation,busy_started_at:a.busy_started_at},{$set:{busy_operation:""}});
   if(cleared.updated!==1)throw new AgreementError("מצב הפעולה השתנה",409);
   await audit(client,a,"workflow_recovered",user.id,{operation:a.busy_operation.split(":")[0]});
   return Response.json({success:true});
  }
  return await lockAgreement(client,a,action,async current=>{
   a=current;
   if(action==="milestones_preview")return Response.json(await milestoneEditPreview(client,a,config));
   if(action==="milestones")return Response.json(await updateAgreementMilestones(client,a,body,user,config));
   if(action==="issue"){
    if(!a.active)throw new AgreementError("הסכם לא פעיל");
    const token=crypto.randomUUID()+crypto.randomUUID();
    const expiry=new Date(Date.now()+7*86400000).toISOString();
    a=await client.entities.EventAgreement.update(a.id,{link_hash:await digest(token),link_expires_at:expiry,otp_sends:0,otp_attempts:0,otp_hash:"",session_hash:"",state:a.signed_at?a.state:"issued"});
    const url=APP+"/EventClosing?id="+a.id+"#token="+token;
    await audit(client,a,"link_issued",user.id,{expires_at:expiry});
    if(body.send===true){
     try{await deliver(client,a,"invitation",a.id+":invitation:"+a.revision,renderClosingMessage(config,"invitation",a.notifications?.language||a.snapshot.message_language,{customer_name:a.recipient_name,event_name:a.snapshot.event_name,link:url}));await audit(client,a,"invitation_accepted",user.id);}
     catch(e){return Response.json({url,warning:e.message});}
    }
    return Response.json({url});
   }
   if(action==="cancel"){
    await client.entities.EventAgreement.update(a.id,{active:false,state:"cancelled",cancelled_at:new Date().toISOString(),link_hash:"",session_hash:""});
    await audit(client,a,"cancelled",user.id);return Response.json({success:true});
   }
   if(action==="pdf"){
    if(body.kind==="quote"){
     if(!a.snapshot.quote_file?.file_uri)throw new AgreementError("לא צורפה הצעת מחיר",404);
     const {signed_url}=await client.integrations.Core.CreateFileSignedUrl({file_uri:a.snapshot.quote_file.file_uri,expires_in:600});
     return Response.json({url:signed_url});
    }
    if(!a.signed_at)throw new AgreementError("ההסכם טרם נחתם");
    a=await finishDocument(client,a);
    if(!a.pdf_uri)throw new AgreementError("הפקת PDF נכשלה; ניתן לנסות שוב",503);
    const {signed_url}=await client.integrations.Core.CreateFileSignedUrl({file_uri:a.pdf_uri,expires_in:600});
    return Response.json({url:signed_url});
   }
   if(action==="notifications"){
    const n=notifications(body.notifications,config);
    await client.entities.EventAgreement.update(a.id,{notifications:n,send_copy:!!body.send_copy,...(body.send_copy&&a.copy_state==="disabled"?{copy_state:"pending"}:{})});
    for(const m of await readAll(client.entities.PaymentMilestone,{agreement_id:a.id})){
     if(m.message_state==="pending")await client.entities.PaymentMilestone.update(m.id,{notification_enabled:n.enabled,template:n.template,notify_at:reminderTime(m.due_date,n.days,n.time)});
    }
    await audit(client,a,"notification_settings_changed",user.id,{...n,send_copy:!!body.send_copy});
    if(body.send_copy&&a.signed_at)await finishDocument(client,await client.entities.EventAgreement.get(a.id));
    return Response.json({success:true});
   }
   if(action==="amendment"){
    if(!a.signed_at)throw new AgreementError("נדרש הסכם חתום");
    const description=cleanText(body.description,10000),channel=cleanText(body.channel,120),approvedBy=cleanText(body.approved_by,120);
    if(!description||!channel||!approvedBy||!Number.isFinite(Date.parse(body.approved_at)))throw new AgreementError("נדרשים תוכן השינוי, ערוץ, מאשר ומועד אישור");
    const row=await client.entities.AgreementAmendment.create({agreement_id:a.id,event_id:a.event_id,description,channel,approved_by:approvedBy,approved_at:body.approved_at,
     price_change:Number(body.price_change)||0,requires_resign:!!body.requires_resign,created_by_user_id:user.id,evidence_uri:cleanText(body.evidence_uri,500)});
    await audit(client,a,"amendment_recorded",user.id,{amendment_id:row.id,requires_resign:row.requires_resign});
    return Response.json({success:true});
   }
   throw new AgreementError("פעולה לא נתמכת");
  });
 }catch(e){
  return Response.json({error:(e instanceof AgreementError||e instanceof CardError)?e.message:"הפעולה לא הושלמה. יש לרענן ולבדוק את מצבה."},{status:(e instanceof AgreementError||e instanceof CardError)?e.status:500,headers:{"Cache-Control":"no-store"}});
 }
});