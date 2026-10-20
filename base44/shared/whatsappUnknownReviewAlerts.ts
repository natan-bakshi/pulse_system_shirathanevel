// Escalate unresolved UNKNOWN WhatsApp provider outcomes using ONLY the
// existing five-minute watchdog. Never fetch message contents, phone numbers,
// file URLs or contact information; NEVER call a WhatsApp provider or enqueue.
//
// Reservation uses an Outbox compare-and-swap to prevent concurrent watchdogs
// producing duplicate notifications. If InApp creation commits but its HTTP
// acknowledgement is lost, a retry first checks the stable notice identity.
const OWNER_EMAIL='natib8000@gmail.com';
const TEMPLATE='WHATSAPP_OUTBOX_REVIEW';
const MIN_AGE_MS=90_000;
const CLAIM_MS=10*60_000;
const LOOKBACK_MS=30*24*60*60_000;

export function unknownWhatsAppReviewTitle(jobId:string):string {
  const id=String(jobId||'');
  if(!/^[a-zA-Z0-9_-]{3,128}$/.test(id))throw new Error('Invalid Outbox review ID');
  return 'WhatsApp: תוצאה לא ידועה · '+id;
}

export async function alertUnknownWhatsAppOutcomes(client:any,options:any={}){
  const db=client?.asServiceRole?.entities;
  if(!db)throw new Error('Service backend required');
  const now=Number.isFinite(options.now)?options.now:Date.now();
  const batch=Number.isInteger(options.limit)?Math.min(10,Math.max(1,options.limit)):8;
  const rows=await db.WhatsAppOutbox.filter({
    status:'unknown'
  },'-last_status_at',Math.max(20,batch*3),0,
  ['id','status','source_type','created_date','last_status_at','completed_at',
   'archived','review_alert_claim_until','review_alert_sent_at','event_service_id']);
  const eligible=rows.filter(row=>{
    if(row.status!=='unknown'||row.archived===true||row.review_alert_sent_at)return false;
    const statusAt=Date.parse(String(row.last_status_at||row.completed_at||row.created_date||''));
    return Number.isFinite(statusAt) && now-statusAt>=MIN_AGE_MS &&
      now-statusAt<=LOOKBACK_MS;
  }).slice(0,batch);
  if(!eligible.length)return {examined:rows.length,eligible:0,created:0,
    existing:0,busy:0,failed:0,noMessagesSent:true};
  // Only the same system owner allowed to manage WhatsAppQueueAdmin receives
  // these operational alerts. Never fan out customer data to other admins.
  const owners=await db.User.filter({email:OWNER_EMAIL},'-created_date',2,0,['id','email','role']);
  if(owners.length!==1||owners[0].role!=='admin')
    return {examined:rows.length,eligible:eligible.length,created:0,
      existing:0,busy:0,failed:eligible.length,ownerUnavailable:true,noMessagesSent:true};
  const owner=owners[0],counter={created:0,existing:0,busy:0,failed:0};
  for(const row of eligible){
    let title;
    try{title=unknownWhatsAppReviewTitle(row.id);}
    catch{counter.failed++;continue;}
    const lastClaim=String(row.review_alert_claim_until||'');
    if(lastClaim && Date.parse(lastClaim)>now){counter.busy++;continue;}
    const until=new Date(now+CLAIM_MS).toISOString();
    // Existing records may not yet have the new fields. In MongoDB $in
    // with null matches a field that is not present; value CAS protects
    // a simultaneous watchdog which has already taken the reservation.
    const claim=lastClaim?lastClaim:{$in:[null,'']};
    let reserved=false;
    try{
      const changed=await db.WhatsAppOutbox.updateMany({
        id:row.id,status:'unknown',review_alert_sent_at:{$in:[null,'']},
        review_alert_claim_until:claim
      },{$set:{review_alert_claim_until:until}});
      reserved=changed?.updated===1;
    }catch{
      console.error('[WhatsAppReview] atomic owner-alert reservation unavailable');
      counter.failed++;continue;
    }
    if(!reserved){counter.busy++;continue;}
    const identity={user_id:owner.id,template_type:TEMPLATE,title};
    try{
      const notices=await db.InAppNotification.filter(identity,'-created_date',1,0,['id']);
      if(!notices.length){
        await db.InAppNotification.create({
          user_id:owner.id,user_email:owner.email||'',title,
          template_type:TEMPLATE,is_read:false,is_resolved:false,
          related_event_service_id:row.event_service_id||'',
          link:'/SettingsPage?whatsappQueue=review#whatsapp-queue',
          message:'למסר WhatsApp יש תוצאה לא ידועה אצל ספק התקשורת. בדוק את הודעת התור לפי המזהה שבכותרת ואת היסטוריית הספק. אין לשלוח מחדש ללא אימות שהמסר לא נשלח.'
        });
        counter.created++;
      }else counter.existing++;
      const recorded=await db.WhatsAppOutbox.updateMany({
        id:row.id,status:'unknown',review_alert_claim_until:until
      },{$set:{review_alert_sent_at:new Date(now).toISOString(),
        review_alert_claim_until:''}});
      if(recorded?.updated!==1)counter.failed++;
    }catch{
      // The notice might ALREADY have committed; let the reservation expire,
      // then check for an existing notice rather than creating a duplicate.
      console.error('[WhatsAppReview] owner notice commit/acknowledgement unavailable');
      counter.failed++;
    }
  }
  return {examined:rows.length,eligible:eligible.length,...counter,
    noMessagesSent:true};
}
