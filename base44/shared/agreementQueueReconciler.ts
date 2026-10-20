// Watchdog for a function crash AFTER ClientMessageDelivery creation and BEFORE
// a persisted queue receipt. Observe/reconcile by the SAME business key only.
// No replay, no token regeneration, no provider API call, no user data in logs.
const TERMINAL=new Set(['accepted','unknown','failed','cancelled','expired','resolved']);
function sourceState(outboxStatus:string):string {
  return ['queued','retry_wait','sending'].includes(outboxStatus)?'queued'
    :TERMINAL.has(outboxStatus)?outboxStatus:'unknown';
}
async function notifyAdministrator(db:any,row:any){
  try{
    const agreement=await db.EventAgreement.get(row.agreement_id);
    if(!agreement?.created_by_user_id)return false;
    const owner=await db.User.get(agreement.created_by_user_id);
    if(owner?.role!=='admin')return false;
    const title='נדרשת בדיקת תור הודעות לקוח';
    const match={user_id:owner.id,related_event_id:row.event_id,
      template_type:'EVENT_AGREEMENT',title,is_resolved:false};
    const existing=await db.InAppNotification.filter(match,'-created_date',1,0,['id']);
    if(existing.length)return false;
    await db.InAppNotification.create({user_id:owner.id,user_email:owner.email||'',title,
      message:'ניסיון WhatsApp לא הסתיים באישור שמירה בתור. בדוק את היסטוריית ההודעות לפני שליחה חוזרת.',
      template_type:'EVENT_AGREEMENT',is_read:false,is_resolved:false,
      link:'/EventDetails?id='+row.event_id,related_event_id:row.event_id});
    return true;
  }catch{
    console.error('[AgreementQueueWatchdog] admin alert unavailable');
    return false;
  }
}
export async function reconcileStalledAgreementEnqueues(client:any,maxRows=8,now=Date.now()){
  const db=client.asServiceRole.entities;
  // Five minutes exceeds the normal synchronous enqueue/lock upper bound.
  // Never inspect a still-running fresh issue as abandoned.
  const cutoff=new Date(now-5*60_000).toISOString();
  const rows=await db.ClientMessageDelivery.filter({
    state:'dispatching',attempted_at:{$lte:cutoff}
  },'attempted_at',Math.min(10,Math.max(1,maxRows)),0,
  ['id','agreement_id','event_id','kind','key','state','attempted_at']);
  let linked=0,unverified=0,alerts=0,errors=0;
  for(const row of rows){
    try{
      const jobs=row.key?await db.WhatsAppOutbox.filter({
        idempotency_key:row.key
      },'-created_date',2,0,
      ['id','status','provider_message_id','client_message_delivery_id','completed_at']):[];
      const job=jobs[0]||null;
      const state=job?sourceState(String(job.status||'')):'unknown';
      const patch:any={
        state,
        ...(job?{queue_job_id:job.id,provider_message_id:state==='accepted'?job.provider_message_id||'':''}:{}),
        ...(state==='accepted'&&Number.isFinite(Date.parse(String(job?.completed_at||'')))
          ?{sent_at:job.completed_at}:{}),
        ...(['failed','unknown','cancelled','expired','resolved'].includes(state)
          ?{error_code:job?(state==='unknown'?'UNKNOWN_OUTBOX_STATE':'OUTBOX_TERMINAL'):'QUEUE_ENQUEUE_UNVERIFIED',
            failure_phase:job?'provider_or_queue_terminal':'unverified',
            error:job?'יש לבדוק את תוצאת הודעת WhatsApp בתור לפני שליחה חוזרת.'
              :'אין אישור שנוצרה הודעת WhatsApp בתור; אין לשלוח שוב לפני בירור.'}
          :{})
      };
      // A simultaneous producer/worker may have settled the record. The
      // compare-and-swap prevents overwriting a newly ACCEPTED source status.
      const changed=await db.ClientMessageDelivery.updateMany({
        id:row.id,state:'dispatching'
      },{$set:patch});
      if(changed?.updated!==1)continue;
      if(job)linked++;
      else unverified++;
      if(['unknown','failed'].includes(state)){
        if(await notifyAdministrator(db,row))alerts++;
      }
      if(job && TERMINAL.has(state) && row.kind==='signed_copy' &&
         job.client_message_delivery_id===row.id){
        // Existing mirror-only reconciler will also repair the PDF copy-state;
        // do not generate a second signed copy or touch a provider.
        await db.WhatsAppOutbox.updateMany({id:job.id,status:job.status},{$set:{
          delivery_mirror_sync_pending:true
        }});
      }
    }catch{
      errors++;
      console.error('[AgreementQueueWatchdog] source reconciliation unavailable');
    }
  }
  return {examined:rows.length,linked,unverified,alerts,errors};
}
