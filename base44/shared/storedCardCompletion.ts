import { CardError } from "./storedCards.ts";
import { providerAccess, verifyLog, verifiedLogs, matchClearingLog } from "./storedCardProvider.ts";
import { afterAgreementChange } from "./agreementLifecycle.ts";
async function notifyCardSaved(client, setup, customer, suffix) {
  try {
    const admin = await client.entities.User.get(setup.created_by_user_id);
    if (!admin || admin.role !== "admin") return;
    const baseLink = setup.event_id ? "/EventDetails?id=" + encodeURIComponent(setup.event_id) : "/BillingDashboard?tab=cards";
    const link = baseLink + (baseLink.includes("?") ? "&" : "?") + "card=" + encodeURIComponent(setup.card_id);
    const existing = await client.entities.InAppNotification.filter({
      user_id: admin.id, template_type: "STORED_CARD_SAVED", link
    }, "id", 1);
    if (existing.length) return;
    await client.entities.InAppNotification.create({
      user_id: admin.id, user_email: admin.email || "", title: "הכרטיס נשמר בהצלחה",
      message: "הטוקן של " + customer.name + " אומת ונשמר. כרטיס המסתיים ב-" + suffix + ".",
      template_type: "STORED_CARD_SAVED", is_read: false, is_resolved: false,
      link, related_event_id: setup.event_id || ""
    });
  } catch { console.warn("[stored-cards] success notification pending"); }
}
// Idempotent local completion: no capture/charge is retried by this routine.
export async function completeSetup(client, setup, card, suffix, brand = "", expires = "") {
  const customer = await client.entities.BillingCustomer.get(setup.customer_id);
  const owner = "setup:" + setup.id;
  if (customer.active_card_id !== card.id) {
    if (customer.busy_operation_id !== owner) throw new CardError("בקשת השמירה אינה פעילה עוד", 409);
    await client.entities.StoredCard.update(card.id, { state: "active", card_suffix: suffix, brand, expires });
    const switched = await client.entities.BillingCustomer.updateMany(
      { id: customer.id, busy_operation_id: owner, active_card_id: customer.active_card_id || "" },
      { $set: { active_card_id: card.id, busy_operation_id: "" } }
    );
    if (switched.updated !== 1) {
      const latest = await client.entities.BillingCustomer.get(customer.id);
      if (latest.active_card_id !== card.id) throw new CardError("מצב הכרטיס השתנה", 409);
    }
  }
  await client.entities.CardSetupRequest.update(setup.id, { state: "verified", redirect_url: "", failure_code: "" });
  if (setup.provisional_customer) await client.entities.BillingCustomer.update(customer.id, { provisional: false });
  // Only scrub the old generation after the authoritative pointer has switched successfully.
  if (customer.active_card_id && customer.active_card_id !== card.id) {
    await client.entities.StoredCard.update(customer.active_card_id, {
      state: "removed", provider_customer_id: "", card_suffix: "", brand: "", expires: "", cleanup_pending: false,
      removed_at: new Date().toISOString(), removed_by: "replacement", removal_reason: "replaced"
    });
  }
  await notifyCardSaved(client, setup, customer, suffix);
  await afterAgreementChange(client, setup.event_id);
  return { received: true };
}



export async function recoverCardSetup(client, setup, config) {
 if(setup.state==="verified")return {received:true};
 if(!["pending","verifying"].includes(setup.state))throw new CardError("בקשת הכרטיס אינה פעילה",409);
 const card=await client.entities.StoredCard.get(setup.card_id);
 const customer=await client.entities.BillingCustomer.get(setup.customer_id);
 if(!card||card.customer_id!==setup.customer_id||customer?.busy_operation_id!=="setup:"+setup.id)
  throw new CardError("שיוך בקשת הכרטיס השתנה",409);
 const access=providerAccess(config,setup.environment,"capture");
 let log;
 if(setup.provider_payment_id||setup.provider_trace_id){
  log=await verifyLog(access,{paymentId:setup.provider_payment_id,traceId:setup.provider_trace_id,type:1,amount:0},setup.created_date);
 }else{
  // No matching by name, amount or time alone. Exact provider order AND customer are required.
  const rows=await verifiedLogs(access,setup.created_date);
  const found=rows.filter(row=>String(row.OrderIdClientUsage||"")===setup.id&&
   String(row.CustomerId||"")===String(setup.provider_customer_id)&&
   matchClearingLog(row,{paymentId:row.PaymentId,traceId:row.ClearingTraceId,type:1,amount:0}));
  if(found.length!==1)throw new CardError("טרם התקבל אישור ספק שניתן לשייך בבטחה לבקשת הכרטיס. אין ליצור בקשה נוספת; נדרש בירור הקולבק מול Invoice4U.",409);
  log=found[0];
 }
 const suffix=String(log.CreditNumber||"").slice(-4);
 if(!/^\d{4}$/.test(suffix))throw new CardError("לא ניתן לאמת את הכרטיס מול הספק",409);
 const claim=await client.entities.CardSetupRequest.updateMany({id:setup.id,state:setup.state},{$set:{
  state:"verifying",provider_payment_id:String(log.PaymentId||setup.provider_payment_id||""),provider_trace_id:String(log.ClearingTraceId||setup.provider_trace_id||"")
 }});
 if(claim.updated!==1)throw new CardError("אימות כרטיס כבר בטיפול; יש לרענן",409);
 try{return await completeSetup(client,setup,card,suffix,card.brand||"",card.expires||"");}
 catch(e){await client.entities.CardSetupRequest.updateMany({id:setup.id,state:"verifying"},{$set:{state:"pending"}});throw e;}
}