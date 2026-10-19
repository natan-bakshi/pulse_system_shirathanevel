import {agreementDeliverySafeErrorLabel} from './agreementDeliverySafety.ts';

// An exception from the enqueue SDK is not proof that NO WhatsApp message
// was committed: storage might have accepted a job but the HTTP response was
// lost. Build invitation UI feedback from the persisted delivery attempt,
// not from the mere existence of a caught exception.
export async function invitationFailureView(db:any,key:string,url:string){
  let state='unknown',code='',phase='';
  try{
    const rows=await db.ClientMessageDelivery.filter({key},'-created_date',2,0,
      ['state','error_code','failure_phase','queue_job_id']);
    const row=rows[0];
    if(row){
      const raw=String(row.state||'');
      state=['queued','accepted','unknown','failed','cancelled','expired'].includes(raw)?raw:'unknown';
      code=String(row.error_code||'');
      phase=String(row.failure_phase||'');
    }
  }catch{}
  // A classified, provably pre-enqueue FAILED attempt is distinct from
  // UNKNOWN. Historic failures with no reason cannot be treated as proven
  // safe for replay merely because the snapshot lacks an Outbox job.
  const definite=new Set(['INVALID_PHONE_FORMAT','EMPTY_MESSAGE','QUEUE_DISABLED',
    'QUEUE_PAUSED','QUEUE_LOCK_BUSY','QUEUE_CONTROL_UNAVAILABLE',
    'PROVIDER_CONFIG_UNAVAILABLE','QUEUE_PERMISSION_DENIED','QUEUE_SCHEMA_REJECTED']);
  if(state==='failed' && !(phase==='enqueue_not_confirmed'&&definite.has(code))){
    state='unknown'; // Preserve uncertainty rather than a false "not sent".
  }
  const warning=state==='failed'
    ?agreementDeliverySafeErrorLabel(code)+' ההודעה לא נקלטה בתור; ניתן לבדוק ולתקן את ההגדרות.'
    :state==='queued'
    ?'ההודעה נמצאת בתור WhatsApp. המסירה טרם אומתה; אין לשלוח שוב באופן אוטומטי.'
    :state==='accepted'
    ?'ספק WhatsApp קיבל את ההודעה. המסירה לנמען טרם אומתה.'
    :'תוצאת הודעת WhatsApp אינה ודאית או אינה מתועדת במלואה. בדוק את היסטוריית הספק לפני שליחה נוספת.';
  return {url,delivery_state:state,warning,manual_review_required:state==='unknown'};
}

// An old UNKNOWN/unclassified failure on this SAME agreement might have
// reached WhatsApp via a direct mode or an enqueue with lost response. The
// event-closing UI may not silently issue another token and a NEW business
// key until the administrator has explicitly reviewed it.
export async function hasUnresolvedAgreementInvitation(db:any,agreementId:string){
  const rows=await db.ClientMessageDelivery.filter({agreement_id:agreementId,kind:'invitation'},
    '-created_date',20,0,['state','error_code','failure_phase','key','attempted_at']);
  return rows.some((row:any)=>{
    const s=String(row.state||'');
    if(s==='dispatching'||s==='unknown')return true;
    if(s==='failed'){
      const phase=String(row.failure_phase||'');
      const code=String(row.error_code||'');
      return !(phase==='enqueue_not_confirmed'&&
        ['INVALID_PHONE_FORMAT','EMPTY_MESSAGE','QUEUE_DISABLED','QUEUE_PAUSED',
          'QUEUE_LOCK_BUSY','QUEUE_CONTROL_UNAVAILABLE','PROVIDER_CONFIG_UNAVAILABLE',
          'QUEUE_PERMISSION_DENIED','QUEUE_SCHEMA_REJECTED'].includes(code));
    }
    return false;
  });
}
