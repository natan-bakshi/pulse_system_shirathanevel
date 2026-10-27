// Owner-triggered, bounded scrub of EXPIRED optional encrypted unknown-button
// recovery payloads. No timer, scheduler, webhook, provider call or retry loop.
// This is an ACTIVE-ENTITY redaction of ciphertext+nonce ONLY; not a claim
// that underlying database backups or exports have been cryptographically
// erased. Live retention enforcement still needs independent owner approval.
//
// Oldest encrypted records first, at most 20 projected rows per click.
// No raw callback data is read back to the owner. All writes use exact CAS;
// uncertain writes are reported as unverified, NEVER as erased.
const LIMIT=20;
const COMPANY='shirat_hanevel';
const projected=[
 'id','provider','company_id','recovery_status','recovery_version',
 'recovery_key_id','recovery_nonce','recovery_ciphertext','recovery_expires_at'
];
const deny=()=>Object.assign(new Error('unknown_recovery_cleanup_unavailable'),
 {code:'unknown_recovery_cleanup_unavailable'});
export async function scrubExpiredUnknownGreenRecoveryOnDemand(client:any,opts:{
 now?:number
}={}){
 const now=opts.now??Date.now();
 if(!Number.isSafeInteger(now)||now<0)throw deny();
 const db=client?.asServiceRole?.entities?.WhatsAppInboundQuarantine;
 if(!db?.filter||!db?.updateMany||!db?.get)throw deny();
 const rows=await db.filter({
  provider:'green',company_id:COMPANY,recovery_status:'encrypted'
 },'created_date',LIMIT,0,projected);
 if(!Array.isArray(rows)||rows.length>LIMIT)throw deny();
 let scrubbed=0,expiredCandidates=0,unverified=0;
 for(const row of rows){
  if(!row||typeof row.id!=='string'||row.provider!=='green'||
   row.company_id!==COMPANY||row.recovery_status!=='encrypted'){
   unverified++;continue;
  }
  const expiration=Date.parse(row.recovery_expires_at||'');
  if(!Number.isFinite(expiration)){
   unverified++;continue;
  }
  if(expiration>now)continue;
  expiredCandidates++;
  if(typeof row.recovery_ciphertext!=='string'||
   typeof row.recovery_nonce!=='string'||
   row.recovery_ciphertext.length<20||
   row.recovery_nonce.length<10){
   unverified++;continue;
  }
  const matching={
   id:row.id,provider:'green',company_id:COMPANY,
   recovery_status:'encrypted',recovery_version:row.recovery_version,
   recovery_key_id:row.recovery_key_id,
   recovery_ciphertext:row.recovery_ciphertext,
   recovery_nonce:row.recovery_nonce,
   recovery_expires_at:row.recovery_expires_at
  };
  try{
   // An UPDATE might commit despite the SDK throwing. Never retry it blindly.
   await db.updateMany(matching,{$set:{
    recovery_status:'erased',recovery_ciphertext:'',
    recovery_nonce:'',recovery_key_id:''
   }});
   const verified=await db.get(row.id);
   if(verified?.recovery_status==='erased'&&
    verified.recovery_ciphertext===''&&verified.recovery_nonce===''&&
    verified.recovery_key_id==='')scrubbed++;
   else unverified++;
  }catch{
   // Post-timeout state is unknown. No second write and no false success.
   unverified++;
  }
 }
 return {
  scanned:rows.length,expiredCandidates,scrubbed,
  unverified,incomplete:unverified>0||rows.length===LIMIT,
  moreMayRemain:rows.length===LIMIT,
  activeEntityFieldsScrubbedOnly:true,
  backupPhysicalErasureNotVerified:true,
  noProviderCalls:true,noMessagesSent:true,noSupplierWrites:true,
  runOnlyOnOwnerClick:true,
  retentionAutomaticallyEnforced:false
 };
}
