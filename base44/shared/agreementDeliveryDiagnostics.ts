import {agreementPhoneFormatEvidence,agreementDeliverySafeErrorLabel} from './agreementDeliverySafety.ts';
import {readWhatsAppQueueControl} from './whatsappOutbox.ts';
import {resolveWhatsAppProvider,hasSelectedWhatsAppProviderCredentials} from './whatsappProviderConfig.ts';

// An OWNER/ADMIN-only, explicitly requested READ-ONLY diagnostic. Never
// initiates a send, retries a failed message, regenerates a link token,
// or returns the recipient's phone number, agreement link or message content.
export async function inspectAgreementWhatsApp(client:any,backend:any,agreementId:string){
  if(!/^[A-Za-z0-9_-]{3,100}$/.test(String(agreementId||'')))throw new Error('Invalid agreement ID');
  const db=client.entities;
  const agreement=await db.EventAgreement.get(agreementId).catch(()=>null);
  if(!agreement)throw new Error('Agreement not found');
  const recipientFormat=agreementPhoneFormatEvidence(agreement.recipient_phone);
  let control:any=null,provider='',providerCredentialsReady=false;
  let controlError='';
  try{
    control=await readWhatsAppQueueControl(backend);
    provider=await resolveWhatsAppProvider(backend);
    providerCredentialsReady=await hasSelectedWhatsAppProviderCredentials(backend);
  }catch{
    controlError='QUEUE_CONTROL_UNAVAILABLE';
  }
  const rows=await db.ClientMessageDelivery.filter({agreement_id:agreementId},'-created_date',12,0,
    ['id','kind','key','state','error_code','attempted_at','queue_job_id','provider_message_id']);
  const selected=rows.filter((r:any)=>['invitation','verification','signed_copy','milestone'].includes(r.kind)).slice(0,8);
  const items=[];
  for(const row of selected){
    let queueStatus='',jobFound=false,historyComplete=true;
    try{
      const jobs=await db.WhatsAppOutbox.filter({idempotency_key:row.key},'-created_date',2,0,
        ['id','status']);
      if(jobs.length){jobFound=true;queueStatus=String(jobs[0].status||'');}
    }catch{historyComplete=false;}
    const errorCode=String(row.error_code||'');
    items.push({
      kind:String(row.kind),state:String(row.state||''),
      attempted_at:row.attempted_at||null,jobFound,queueStatus,
      errorCode:errorCode||((row.state==='failed'||row.state==='unknown')
        ?'HISTORIC_REASON_UNAVAILABLE':''),
      errorLabel:errorCode?agreementDeliverySafeErrorLabel(errorCode):
        (row.state==='failed'||row.state==='unknown')
        ?'ברשומה זו לא נשמרה סיבת הכשל המקורית. אין להסיק שהמספר או הספק שגויים.':'',
      historyComplete
    });
  }
  return {
    readOnly:true,messageSent:false,deliveryProven:false,
    recipientFormat,
    queue:{enabled:control?.enabled===true,paused:control?.paused===true,
      provider:provider||'unknown',credentialsConfigured:providerCredentialsReady,
      controlError},
    attempts:items,
    activeLink:{
      issued:agreement.active===true && Number.isFinite(Date.parse(agreement.link_expires_at||'')) &&
        Date.parse(agreement.link_expires_at)>Date.now(),
      expiresAt:agreement.active===true?agreement.link_expires_at||null:null,
      tokenRecoverable:false // Only a cryptographic hash is stored in DB.
    },
    safeNextStep:items.some(x=>['failed','unknown','dispatching'].includes(x.state))
      ?'Check provider history before a NEW send; if the old private URL was saved, it may be copied manually while its agreement is active. Otherwise new issue requires explicit review and rotates the old URL.'
      :'No historical send error found in the sampled invitation history.',
    limitations:'Provider acceptance is not proof of recipient delivery. Older failures have no classified cause.'
  };
}
