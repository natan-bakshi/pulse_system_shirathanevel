import { createClientFromRequest } from "npm:@base44/sdk@0.8.50";
import { convert } from "npm:html-to-text@9.0.5";
import { generateQuoteHtml } from "../../shared/quoteHtml.ts";
import { getEventContacts } from "../../shared/eventFields.js";
import { calculateAdvanceAmount, calculateProcessingFee, itemsToPipedFields } from "../../shared/eventBilling.ts";
import { beginSetup } from "../../shared/storedCardSetup.ts";
import { CardError, requireCards, reserveHostedPayment } from "../../shared/storedCards.ts";
import { providerCall, hasErrors, providerFailure } from "../../shared/storedCardProvider.ts";
import { secrets } from "base44:runtime";
import { normalizeIsraeliPhone } from "../../shared/whatsappSend.ts";
import { readAll } from "../../shared/eventReadiness.ts";
import { closingDefaults, canonical, digest, cleanText, defaultMilestones, validateMilestones, roundMoney } from "../../shared/agreementRules.ts";
import { AgreementError, audit, lockAgreement, settings, financials, deliver, reconcileAgreement } from "../../shared/agreementLifecycle.ts";
import { persistAgreementPdf } from "../../shared/agreementPdf.ts";

const APP="https://pulse-system.base44.app";
const textFromHtml=html=>convert(String(html||""),{wordwrap:false,selectors:[{selector:"img",format:"skip"},{selector:"a",options:{hideLinkHrefIfSameAsText:true}}]});
const bool=(v,def)=>v===undefined?def:!!v;
function publicAgreement(a){return {
 id:a.id,version:a.version,state:a.state,snapshot:a.snapshot,content_hash:a.content_hash,
 require_token:a.require_token,require_deposit:a.require_deposit,signed_at:a.signed_at,
 token_state:a.token_state,deposit_state:a.deposit_state,pdf_state:a.pdf_state,copy_state:a.copy_state,
 completed_at:a.completed_at,verified_at:a.verified_at,opened_at:a.opened_at,active:a.active,
 signature:a.signature?{name:a.signature.name,role:a.signature.role,strokes:a.signature.strokes,accepted:a.signature.accepted}:null
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
 days:Math.min(60,Math.max(0,Number(body?.days??config.closing_reminder_days??3))),
 time:/^([01]\d|2[0-3]):[0-5]\d$/.test(body?.time||"")?body.time:(config.closing_reminder_time||"09:00"),
 template:cleanText(body?.template||config.closing_message_template||closingDefaults.closing_message_template,4000),
 notify_admin:bool(body?.notify_admin,config.closing_notify_admin!=="false")};
}
// Jerusalem wall time -> UTC, including daylight saving changes.
function reminderTime(date,days,time){
 const d=new Date(date+"T12:00:00Z");d.setUTCDate(d.getUTCDate()-days);
 const local=d.toISOString().slice(0,10)+"T"+time+":00";
 let instant=Date.parse(local+"Z");
 for(let i=0;i<2;i++){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Jerusalem",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date(instant));
  const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  const actual=Date.parse(p.year+"-"+p.month+"-"+p.day+"T"+p.hour+":"+p.minute+":"+p.second+"Z");
  instant+=Date.parse(local+"Z")-actual;
 }
 return new Date(instant).toISOString();
}
async function preview(client,base44,eventId,config){
 const event=await client.entities.Event.get(eventId);
 if(!event)throw new AgreementError("האירוע לא נמצא",404);
 const f=await financials(client,event,config);
 if(f.finalTotal<=0||!event.event_date)throw new AgreementError("נדרש מחיר ותאריך לאירוע לפני יצירת הסכם");
 const {html}=await generateQuoteHtml(eventId,base44,{preloadedEvent:event,includeIntro:true,includePaymentTerms:false,includeSchedule:true,includeExternalServices:true});
 const templates=await readAll(client.entities.QuoteTemplate,{template_type:"agreement_disclaimer"});
 const terms=textFromHtml(templates.find(x=>x.identifier==="default")?.content||templates[0]?.content||"");
 const deposit=calculateAdvanceAmount(config,f.finalTotal);
 const quote=textFromHtml(html);
 const sourceHash=await digest(canonical({quote,total:f.finalTotal,currency:f.currency,event_date:event.event_date,terms}));
 return {event,sourceHash,quote,terms,total:f.finalTotal,currency:f.currency,deposit,contacts:getEventContacts(event).map(c=>({name:c.name||"",phone:c.phone||"",email:c.email||""})),
 milestones:defaultMilestones(f.finalTotal,deposit,event.event_date),
 regular_cap:roundMoney(f.finalTotal*Number(config.closing_regular_multiplier||1)),
 exceptional_cap:roundMoney(f.finalTotal*Number(config.closing_exceptional_multiplier||2)),
 clauses:[
 {code:"terms",label:"תנאי ההתקשרות והצעת המחיר",text:"קראתי ואני מאשר/ת את פרטי האירוע, הצעת המחיר ותנאי ההתקשרות המפורטים במסמך זה."},
 {code:"token",label:"שמירת כרטיס ושימוש בטוקן",text:"ככל שאמסור כרטיס, אני בעל/ת הכרטיס או מורשה/ית להשתמש בו, ומאשר/ת שמירת מזהה מאובטח של הכרטיס אצל ספק הסליקה ושימוש בו בהתאם להרשאות המפורטות כאן."},
 {code:"regular",label:"גבייה לפי אבני הדרך",text:config.closing_regular_text||closingDefaults.closing_regular_text},
 {code:"exceptional",label:"חיובים חריגים לפי ההסכם",text:config.closing_exceptional_text||closingDefaults.closing_exceptional_text},
 {code:"fee",label:"עמלת סליקה",text:config.processing_fee_enabled==="true"?"בתשלום באשראי תתווסף עלות סליקה לפי הגדרות הסליקה במועד הסכם זה: "+config.processing_fee_value+(config.processing_fee_type==="fixed"?" "+f.currency+" לכל חיוב.":"% מסכום החיוב."):"במועד הסכם זה לא מתווספת עמלת סליקה."},
 {code:"changes",label:"שינויים מוסכמים בהזמנה",text:config.closing_changes_text||closingDefaults.closing_changes_text}
 ], require_token:config.closing_token_required!=="false",require_deposit:config.closing_deposit_required!=="false",
 send_copy:config.closing_send_copy!=="false",notifications:notifications(null,config)};
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
 try{a=await persistAgreementPdf(client,a);}
 catch{return await client.entities.EventAgreement.update(a.id,{pdf_state:"failed"});}
 if(a.send_copy&&a.copy_state==="pending"){
  await client.entities.EventAgreement.update(a.id,{copy_state:"dispatching"});
  try{
   const {signed_url}=await client.integrations.Core.CreateFileSignedUrl({file_uri:a.pdf_uri,expires_in:3600});
   const d=await deliver(client,a,"signed_copy",a.id+":signed_copy","עותק ההסכם החתום עבור "+a.snapshot.event_name,{url:signed_url,name:"agreement-"+a.id+".pdf"});
   a=await client.entities.EventAgreement.update(a.id,{copy_state:d.state});
  }catch{a=await client.entities.EventAgreement.update(a.id,{copy_state:"unknown"});}
 }
 return a;
}
async function createDeposit(client,a,config){
 const event=await client.entities.Event.get(a.event_id),f=await financials(client,event,config);
 if(event.closing_agreement_id!==a.id||f.currency!==a.snapshot.currency||Math.abs(f.finalTotal-a.snapshot.total)>0.01)throw new AgreementError("פרטי ההזמנה השתנו; נדרשת גרסה מעודכנת");
 const amount=roundMoney(Math.max(0,a.snapshot.deposit-f.totalPaid));
 if(!amount)return {paid:true};
 const old=f.payments.find(p=>p.agreement_id===a.id&&p.payment_status==="pending");
 if(old){if(old.payment_link_url)return {redirectUrl:old.payment_link_url};throw new AgreementError("בקשת מקדמה בבירור. אין ליצור בקשה נוספת.",409);}
 const environment=config.invoice4u_env==="production"?"production":"qa";
 const key=secrets.get(environment==="qa"?"INVOICE4U_API_TOKEN_QA":"INVOICE4U_API_TOKEN");
 if(environment==="qa" && event.stored_card_qa_only!==true)throw new AgreementError("תשלום בדיקה מותר רק באירוע טסט",409);
 if(!Number(config.invoice4u_clearing_company_type))throw new AgreementError("חסר סוג חברת סליקה",503);
 if(!key)throw new AgreementError("לא הוגדר מפתח לסביבת התשלום",503);
 const fee=calculateProcessingFee(a.snapshot.fee_config,amount),total=roundMoney(amount+fee.amount),cb=crypto.randomUUID()+crypto.randomUUID();
 const payment=await reserveHostedPayment(client,event,config,amount,f.currency,()=>client.entities.Payment.create({
  event_id:event.id,agreement_id:a.id,agreement_environment:environment,agreement_verified:false,
  amount,currency:f.currency,payment_date:new Date().toISOString().slice(0,10),payment_method:"credit_card",payment_status:"pending",clearing_method:"hosted_page",charge_type:"advance",
  processing_fee_amount:fee.amount,payer_name:a.recipient_name,payer_phone:a.recipient_phone,payer_email:a.recipient_email||"",invoice4u_callback_token:cb,document_language:"he",is_payment_link:false,notes:"מקדמה לפי הסכם "+a.id
 }));
 const vat=Number(config.vat_rate)||18;
 try{
  const result=await providerCall({environment,key,purpose:"hosted"},"ProcessApiRequestV2",{request:{
   Invoice4UUserApiKey:key,Sum:total,Currency:f.currency==="ILS"?"NIS":f.currency,Type:1,CreditCardCompanyType:Number(config.invoice4u_clearing_company_type),
   FullName:a.recipient_name,Phone:a.recipient_phone,Email:a.recipient_email||"",Description:"מקדמה עבור "+event.event_name,
   OrderIdClientUsage:payment.id,IsDocCreate:true,IsManualDocCreationsWithParams:true,
   ...itemsToPipedFields([{name:"מקדמה עבור "+event.event_name,quantity:1,price:total/(1+vat/100)}],vat,total),
   Language:"he",IsQaMode:environment==="qa",Platform:"Pulse",
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
  if(req.method!=="POST")return Response.json({error:"Method not allowed"},{status:405});
  const raw=await req.text();if(raw.length>400000)throw new AgreementError("בקשה גדולה מדי",413);
  const body=JSON.parse(raw),action=body.action;
  const base44=createClientFromRequest(req),client=base44.asServiceRole;
  if(["open","otp","verify","view","sign","token","deposit","document"].includes(action)){
   let a=await requirePublic(client,body,!["open","otp","verify"].includes(action));
   return await lockAgreement(client,a,action,async current=>{
    a=current;
    if(action==="open"){
     if(!a.opened_at){await client.entities.EventAgreement.update(a.id,{opened_at:new Date().toISOString()});await audit(client,a,"opened","link");}
     return Response.json({id:a.id,phone:"••••"+a.recipient_phone.slice(-4),signed:!!a.signed_at});
    }
    if(action==="otp"){
     if((a.otp_sends||0)>=3||(a.otp_attempts||0)>=5)throw new AgreementError("מכסת האימות מוצתה. יש לבקש קישור חדש מהמנהל.",429);
     if(a.otp_sent_at&&Date.now()-Date.parse(a.otp_sent_at)<60000)throw new AgreementError("ניתן לשלוח קוד נוסף לאחר דקה",429);
     const n=crypto.getRandomValues(new Uint32Array(1))[0]%1000000,code=String(n).padStart(6,"0");
     await client.entities.EventAgreement.update(a.id,{otp_hash:await digest(a.id+":"+code),otp_sent_at:new Date().toISOString(),otp_expires_at:new Date(Date.now()+600000).toISOString(),otp_sends:(a.otp_sends||0)+1});
     await deliver(client,a,"verification",a.id+":otp:"+((a.otp_sends||0)+1),"קוד האימות שלך לחתימת הסכם עם שירת הנבל: "+code+". הקוד בתוקף ל-10 דקות. אין להעביר אותו לאחרים.");
     await audit(client,a,"verification_sent","customer");return Response.json({sent:true});
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
     if(a.signed_at)return Response.json(publicAgreement(a));
     if(body.contentHash!==a.content_hash)throw new AgreementError("נוסח ההסכם השתנה; יש לרענן",409);
     const sig=validateSignature(body);
     const accepted=Object.fromEntries(a.snapshot.clauses.map(c=>[c.code,body.accepted?.[c.code]===true]));
     if(Object.values(accepted).some(v=>!v))throw new AgreementError("נדרש אישור נפרד לכל סעיף");
     const signature={...sig,accepted,ip:cleanText(req.headers.get("x-forwarded-for")?.split(",")[0]||req.headers.get("x-real-ip"),100),user_agent:cleanText(req.headers.get("user-agent"),500),session_fingerprint:a.session_hash};
     const signedAt=new Date().toISOString();
     a=await client.entities.EventAgreement.update(a.id,{signature,signature_hash:await digest(canonical({signature,content_hash:a.content_hash,signed_at:signedAt})),signed_at:signedAt,state:"signed",link_hash:"",otp_hash:"",pdf_state:"pending"});
     for(const c of a.snapshot.clauses)await client.entities.ConsentClause.create({agreement_id:a.id,event_id:a.event_id,code:c.code,text:c.text,version:a.version,accepted_at:signedAt});
     await audit(client,a,"signed","customer",{content_hash:a.content_hash,signature_hash:a.signature_hash});
     a=await finishDocument(client,a);await reconcileAgreement(client,a.event_id);
     return Response.json(publicAgreement(await client.entities.EventAgreement.get(a.id)));
    }
    if(!a.signed_at)throw new AgreementError("יש לחתום לפני שמירת כרטיס או תשלום",409);
    if(action==="document"){
     a=await finishDocument(client,a);if(!a.pdf_uri)throw new AgreementError("החתימה נשמרה; הפקת המסמך ממתינה לטיפול",503);
     const {signed_url}=await client.integrations.Core.CreateFileSignedUrl({file_uri:a.pdf_uri,expires_in:600});
     return Response.json({url:signed_url});
    }
    const config=await settings(client);
    if(action==="deposit")return Response.json(await createDeposit(client,a,config));
    if(action==="token"){
     requireCards(config);
     if(!a.signature.accepted.token)throw new AgreementError("לא קיימת הרשאה לשמירת כרטיס",403);
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
  if(action==="preview"){
   const p=await preview(client,base44,body.eventId,config);
   return Response.json({...p,event:undefined});
  }
  if(action==="list"){
   await reconcileAgreement(client,body.eventId,config);
   const rows=await readAll(client.entities.EventAgreement,{event_id:body.eventId});
   rows.sort((a,b)=>b.version-a.version);
   const current=rows.find(a=>a.active);
   return Response.json({agreements:rows.map(publicAgreement),current:current?{...publicAgreement(current),notifications:current.notifications,send_copy:current.send_copy}:null,
    audit:current?await readAll(client.entities.AgreementAuditEvent,{agreement_id:current.id}):[],
    milestones:current?await readAll(client.entities.PaymentMilestone,{agreement_id:current.id}):[],
    deliveries:current?await readAll(client.entities.ClientMessageDelivery,{agreement_id:current.id}):[],
    amendments:current?await readAll(client.entities.AgreementAmendment,{agreement_id:current.id}):[]});
  }
  if(action==="create"){
   const p=await preview(client,base44,body.eventId,config);
   if(body.sourceHash!==p.sourceHash)throw new AgreementError("פרטי האירוע השתנו מאז התצוגה; יש לפתוח טיוטה מחדש",409);
   const name=cleanText(body.name,120),phone=normalizeIsraeliPhone(body.phone),email=cleanText(body.email,200);
   if(!name||!phone)throw new AgreementError("נדרשים שם וטלפון תקינים");
   let customer=null;
   if(p.event.billing_customer_id){
    customer=await client.entities.BillingCustomer.get(p.event.billing_customer_id);
    if(customer?.deleted_at||normalizeIsraeliPhone(customer?.phone)!==phone)throw new AgreementError("הטלפון חייב להתאים ללקוח המשלם המקושר. אפשר לנתק או לשנות את הלקוח באירוע.");
   }
   const old=await readAll(client.entities.EventAgreement,{event_id:body.eventId});
   if(old.some(a=>a.busy_operation))throw new AgreementError("קיימת פעולה בהסכם קודם",409);
   const milestones=validateMilestones(body.milestones,p.total);
   const regular=roundMoney(body.regular_cap),exceptional=roundMoney(body.exceptional_cap);
   if(!Number.isFinite(regular)||!Number.isFinite(exceptional)||regular<0||exceptional<0)throw new AgreementError("תקרות חיוב לא תקינות");
   const clauses=p.clauses.map(c=>({...c,text:cleanText(body.clauses?.find(x=>x.code===c.code)?.text||c.text,12000)}));
   const terms=cleanText(body.terms||p.terms,60000);if(!terms)throw new AgreementError("יש להגדיר תנאי התקשרות לפני שליחה");
   const notification=notifications(body.notifications,config);
   const snapshot={recipient_name:name,recipient_phone:phone,recipient_email:email,event_id:body.eventId,event_name:p.event.event_name,event_date:p.event.event_date,total:p.total,currency:p.currency,quote_text:p.quote,terms,clauses,milestones,
    deposit:milestones[0].amount,regular_cap:regular,exceptional_cap:exceptional,
    fee_config:Object.fromEntries(["processing_fee_enabled","processing_fee_type","processing_fee_value","processing_fee_label"].map(k=>[k,config[k]||""])),
    exceptional_notice:config.closing_exceptional_notice!=="false",exceptional_notice_days:Math.max(0,Number(config.closing_exceptional_notice_days)||0),
    require_token:!!body.require_token,require_deposit:!!body.require_deposit};
   const a=await client.entities.EventAgreement.create({
    event_id:body.eventId,version:Math.max(0,...old.map(x=>x.version))+1,state:"draft",active:false,revision:0,busy_operation:"",
    created_by_user_id:user.id,recipient_name:name,recipient_phone:phone,recipient_email:email,customer_id:customer?.id||"",
    snapshot,content_hash:await digest(canonical(snapshot)),require_token:!!body.require_token,require_deposit:!!body.require_deposit,
    send_copy:!!body.send_copy,copy_state:body.send_copy?"pending":"disabled",token_state:"pending",deposit_state:"pending",pdf_state:"not_signed",
    otp_sends:0,otp_attempts:0,closing_applied:false,notifications:notification
   });
   for(const m of milestones)await client.entities.PaymentMilestone.create({...m,agreement_id:a.id,event_id:body.eventId,state:"pending",message_state:"pending",
    notify_at:reminderTime(m.due_date,notification.days,notification.time),notification_enabled:notification.enabled,template:notification.template});
   const bound=await client.entities.Event.updateMany({id:body.eventId,updated_date:p.event.updated_date},{$set:{closing_agreement_id:a.id,closing_manual_override:false}});
   if(bound.updated!==1)throw new AgreementError("האירוע השתנה; הטיוטה לא הופעלה",409);
   for(const previous of old.filter(x=>x.active)){
    await client.entities.EventAgreement.update(previous.id,{active:false,link_hash:"",session_hash:""});
    await audit(client,previous,"superseded",user.id,{new_agreement_id:a.id});
   }
   await client.entities.EventAgreement.update(a.id,{active:true});
   await audit(client,a,"created",user.id,{require_token:a.require_token,require_deposit:a.require_deposit});
   return Response.json(publicAgreement({...a,active:true}));
  }
  let a=await client.entities.EventAgreement.get(body.agreementId);
  if(!a)throw new AgreementError("ההסכם לא נמצא",404);
  return await lockAgreement(client,a,action,async current=>{
   a=current;
   if(action==="issue"){
    if(!a.active)throw new AgreementError("הסכם לא פעיל");
    const token=crypto.randomUUID()+crypto.randomUUID();
    const expiry=new Date(Date.now()+7*86400000).toISOString();
    a=await client.entities.EventAgreement.update(a.id,{link_hash:await digest(token),link_expires_at:expiry,otp_sends:0,otp_attempts:0,otp_hash:"",session_hash:"",state:a.signed_at?a.state:"issued"});
    const url=APP+"/EventClosing?id="+a.id+"#token="+token;
    await audit(client,a,"link_issued",user.id,{expires_at:expiry});
    if(body.send===true){
     try{await deliver(client,a,"invitation",a.id+":invitation:"+a.revision,"שלום "+a.recipient_name+", לאישור פרטי האירוע, חתימה והשלמת נוהל הסגירה עם שירת הנבל:\n"+url);await audit(client,a,"invitation_accepted",user.id);}
     catch(e){return Response.json({url,warning:e.message});}
    }
    return Response.json({url});
   }
   if(action==="cancel"){
    await client.entities.EventAgreement.update(a.id,{active:false,state:"cancelled",cancelled_at:new Date().toISOString(),link_hash:"",session_hash:""});
    await audit(client,a,"cancelled",user.id);return Response.json({success:true});
   }
   if(action==="pdf"){
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
    await audit(client,a,"notification_settings_changed",user.id,{...n,send_copy:!!body.send_copy});return Response.json({success:true});
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
