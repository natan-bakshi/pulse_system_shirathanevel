// Recover a CardSetup WhatsApp *source* stranded after an enqueue process
// crashed. No credit-card processing, no provider HTTP, no sending messages,
// and no replay of a possibly accepted WhatsApp request.
function linkStateFromOutbox(job:any){
 const state=String(job?.status||'');
 if(!job)return 'unknown';
 if(state==='accepted')return String(job.provider_message_id||'').trim()?'accepted':'unknown';
 if(['queued','sending','retry_wait'].includes(state))return 'queued';
 if(state==='failed')return 'rejected';
 if(['cancelled','expired','resolved'].includes(state))return 'cancelled';
 return 'unknown';
}
async function warnOwner(db:any,row:any){
 try{
  if(!row.created_by_user_id)return false;
  const admin=await db.User.get(row.created_by_user_id);
  if(admin?.role!=='admin')return false;
  const title='בדיקת WhatsApp לקישור כרטיס: '+String(row.id||'').slice(-8);
  const match={user_id:admin.id,title,template_type:'CARD_SETUP',is_resolved:false};
  const existing=await db.InAppNotification.filter(match,'-created_date',1,0,['id']);
  if(existing.length)return false;
  await db.InAppNotification.create({
   user_id:admin.id,user_email:admin.email||'',title,
   template_type:'CARD_SETUP',is_read:false,is_resolved:false,
   related_event_id:row.event_id||'',
   link:row.event_id?'/EventDetails?id='+row.event_id:'/BillingDashboard',
   message:'קליטת הודעת קישור אשראי ל־WhatsApp אינה מאומתת. בדוק את התור והספק לפני שליחה חוזרת.'
  });
  return true;
 }catch{
  console.error('[CardSetupQueueWatchdog] admin notification unavailable');
  return false;
 }
}
export async function reconcileStalledCardSetupEnqueues(client:any,maxRows=8,now=Date.now()){
 const db=client.asServiceRole.entities;
 const cutoff=new Date(now-5*60_000).toISOString();
 // Explicit claim timestamp prevents incorrectly declaring a very old card
 // setup failed while a NEW, still-running enqueue is in progress.
 const rows=await db.CardSetupRequest.filter({
  state:'pending',link_message_state:'dispatching',
  link_send_started_at:{$lte:cutoff}
 },'link_send_started_at',Math.min(10,Math.max(1,maxRows)),0,
 ['id','event_id','state','created_by_user_id','link_message_state','link_send_started_at']);
 let linked=0,unverified=0,alerts=0,errors=0;
 for(const row of rows){
  try{
   const jobs=await db.WhatsAppOutbox.filter({idempotency_key:'card-setup:'+row.id},
     '-created_date',2,0,['id','status','provider_message_id','card_setup_request_id']);
   const job=jobs[0]||null;
   const targetState=linkStateFromOutbox(job);
   const patch:any={link_message_state:targetState,
    ...(job?{link_message_id:targetState==='accepted'?job.provider_message_id:job.id}:{})
   };
   // Worker/producer may have updated this source while the watchdog read.
   const changed=await db.CardSetupRequest.updateMany({
    id:row.id,state:'pending',link_message_state:'dispatching',
    link_send_started_at:row.link_send_started_at
   },{$set:patch});
   if(changed?.updated!==1)continue;
   if(job)linked++;else unverified++;
   if(['unknown','rejected'].includes(targetState))
    if(await warnOwner(db,row))alerts++;
  }catch{
   errors++;
   console.error('[CardSetupQueueWatchdog] queue/source reconciliation unavailable');
  }
 }
 return {examined:rows.length,linked,unverified,alerts,errors};
}
