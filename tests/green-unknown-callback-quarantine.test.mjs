import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fingerprintUnknownGreenCallback,isEligibleUnknownGreenCallback,
 registerUnknownGreenCallbackQuarantine,inspectUnknownGreenQuarantineReadOnly}
 from '../base44/shared/greenUnknownCallbackQuarantine.ts';
import {stageFutureGreenInteractiveHttpCallback}
 from '../base44/shared/greenInteractiveHttpStaging.ts';
import {decryptUnknownGreenRecovery,encryptUnknownGreenRecovery,
 canonicalGreenCallbackJson,UNKNOWN_RECOVERY_TTL_HOURS}
 from '../base44/shared/greenUnknownRecoveryEnvelope.ts';
import {planFutureGreenWebhookAck} from '../base44/shared/greenWebhookAckPlanning.ts';
import {planFutureGreenWebhookHttpContract} from '../base44/shared/greenWebhookHttpContract.ts';
const NOW=Date.parse('2026-10-26T12:00:00.000Z');
const ACCOUNT='9903183013';
const SECRET='synthetic-only-not-a-live-action-signing-secret-0123456789';
const WEBHOOK_SECRET='synthetic-only-green-webhook-secret-123456789';
function raw(){
 return {typeWebhook:'incomingMessageReceived',
  idMessage:'3EB0UNKNOWNBUTTONAABBCCDD99887766',
  timestamp:Math.floor(NOW/1000),
  instanceData:{idInstance:Number(ACCOUNT),typeInstance:'whatsapp'},
  senderData:{chatId:'972501234567@c.us',sender:'972501234567@c.us',
   senderName:'PRIVATE-SUPPLIER-NAME'},
  messageData:{typeMessage:'futureInteractiveBetaReply',
   futureInteractiveBetaReply:{
    selectedId:'PRIVATE-BUTTON-ACTION',stanzaId:'PRIVATE-ORIGINAL-STANZA',
    text:'PRIVATE-SUPPLIER-QUESTION',phone:'+972501234567'
   }}
 };
}
const same=(row,query)=>Object.entries(query||{}).every(([key,v])=>
 (row[key]??null)===(v??null));
function fixture(){
 const control={id:'control-1',control_key:'global',
  enabled:true,paused:false,unknown_create_owner:'',
  unknown_create_until:'',unknown_guard_key:'',
  inbound_rate_count:0,inbound_rate_window_started_at:''};
 const rows=[];
 const counts={controlReads:0,controlWrites:0,quarantineReads:0,
  quarantineCreates:0,supplierWrites:0,providerCalls:0};
 let timeoutAfterCreate=false,failOnReread=false,failOnRelease=false;
 const entities={
  WhatsAppQueueControl:{
   filter:async(query)=>{counts.controlReads++;return same(control,query)?[structuredClone(control)]:[];},
   updateMany:async(query,update)=>{
    counts.controlWrites++;
    if(!same(control,query))return {updated:0};
    if(failOnRelease&&update?.$set?.unknown_create_owner==='')
     throw Error('ambiguous release');
    Object.assign(control,update.$set);return {updated:1};
   }
  },
  WhatsAppInboundQuarantine:{
   filter:async(query)=>{
    counts.quarantineReads++;
    if(failOnReread&&rows.length)throw Error('database read uncertain');
    return rows.filter(row=>same(row,query)).map(row=>structuredClone(row));
   },
   create:async(data)=>{
    counts.quarantineCreates++;
    const row={id:'q-'+(rows.length+1),...structuredClone(data)};
    rows.push(row);
    if(timeoutAfterCreate)throw Error('SDK timeout AFTER COMMIT');
    return structuredClone(row);
   },
   list:async(_sort,limit,offset,fields)=>{
    counts.quarantineReads++;
    return rows.slice(offset,offset+limit).map(row=>
     Object.fromEntries(fields.map(name=>[name,row[name]])));
   }
  },
  EventService:{updateMany:async()=>{counts.supplierWrites++;throw Error('never mutate supplier');}},
  WhatsAppOutbox:{filter:async()=>{counts.providerCalls++;throw Error('never query outbox for unknown')}}
 };
 const client={asServiceRole:{entities}};
 function callback(value=raw()){
  return new Request('https://invalid.test/green',{
   method:'POST',headers:{'content-type':'application/json',
    Authorization:'Bearer '+WEBHOOK_SECRET},body:JSON.stringify(value)
  });
 }
 const opts={client,rolloutAuthorized:true,accountCapabilityVerified:true,
  webhookSecret:WEBHOOK_SECRET,actionSigningSecret:SECRET,
  expectedInstanceId:ACCOUNT,claimOwner:'quarantine-test-worker',
  now:NOW,recalculateEventStatus:async()=>{throw Error('never recalc')}
 };
 return {client,entities,control,rows,counts,callback,opts,
  setTimeoutAfterCreate:v=>timeoutAfterCreate=v,
  setFailOnReread:v=>failOnReread=v,
  setFailOnRelease:v=>failOnRelease=v};
}
test('HMAC fingerprints are stable per provider event without exposing payload or phone',async()=>{
 const event=raw();
 assert.equal(isEligibleUnknownGreenCallback(event,ACCOUNT,NOW),true);
 const identity=await fingerprintUnknownGreenCallback(event,{
  expectedInstanceId:ACCOUNT,fingerprintSecret:SECRET,now:NOW
 });
 assert.match(identity.quarantine_key,/^gq1_[a-f0-9]{64}$/);
 assert.match(identity.payload_mac,/^[a-f0-9]{64}$/);
 assert.equal(identity.format_code,'unrecognized_interactive');
 assert.equal(identity.state,'needs_review');
 const encoded=JSON.stringify(identity);
 for(const hidden of ['PRIVATE-SUPPLIER-NAME','PRIVATE-ORIGINAL-STANZA',
  'PRIVATE-BUTTON-ACTION','PRIVATE-SUPPLIER-QUESTION','972501234567',
  '3EB0UNKNOWNBUTTONAABBCCDD99887766',SECRET])
  assert.equal(encoded.includes(hidden),false,hidden);
 const sameIdentity=await fingerprintUnknownGreenCallback(event,{
  expectedInstanceId:ACCOUNT,fingerprintSecret:SECRET,now:NOW
 });
 assert.deepEqual(identity,sameIdentity);
});
test('actual dormant HTTP staging quarantines ONE unknown Beta callback and never ACKs it',async()=>{
 const f=fixture(),first=await stageFutureGreenInteractiveHttpCallback(
  f.callback(),f.opts);
 assert.equal(first.stage,'quarantined_unknown');
 assert.equal(first.quarantineRecorded,true);
 assert.equal(first.quarantineKind,'stored');
 assert.equal(first.manualReviewRequired,true);
 assert.equal(first.canAcknowledge,false);
 assert.equal(f.rows.length,1);
 assert.equal(f.rows[0].state,'needs_review');
 assert.equal(f.rows[0].format_code,'unrecognized_interactive');
 assert.equal(f.control.unknown_guard_key,'');
 assert.equal(f.counts.quarantineCreates,1);
 assert.equal(f.counts.supplierWrites,0);
 assert.equal(f.counts.providerCalls,0);
 assert.equal(planFutureGreenWebhookAck(first).mayRespond200AfterProviderQa,false);
 assert.equal(planFutureGreenWebhookHttpContract(first).plannedHttpStatus,503);
 const record=JSON.stringify(f.rows);
 for(const hidden of ['PRIVATE-SUPPLIER-NAME','PRIVATE-ORIGINAL-STANZA',
  'PRIVATE-BUTTON-ACTION','PRIVATE-SUPPLIER-QUESTION','972501234567',
  '3EB0UNKNOWNBUTTONAABBCCDD99887766'])
  assert.equal(record.includes(hidden),false,hidden);
 const repeated=await stageFutureGreenInteractiveHttpCallback(f.callback(),f.opts);
 assert.equal(repeated.stage,'quarantined_unknown');
 assert.equal(repeated.quarantineKind,'duplicate');
 assert.equal(f.counts.quarantineCreates,1,'retries must not create another record');
 assert.equal(f.counts.supplierWrites,0);
 assert.equal(planFutureGreenWebhookHttpContract(repeated).plannedHttpStatus,503,
  'privacy-only metadata is not a recoverable button action');
});
test('same Green provider event ID with DIFFERENT payload cannot be mistaken as same callback',async()=>{
 const f=fixture(),event=raw();
 assert.equal((await stageFutureGreenInteractiveHttpCallback(
  f.callback(event),f.opts)).stage,'quarantined_unknown');
 const changed=structuredClone(event);
 changed.messageData.futureInteractiveBetaReply.selectedId='DIFFERENT-REPLY';
 const result=await stageFutureGreenInteractiveHttpCallback(f.callback(changed),f.opts);
 assert.equal(result.stage,'quarantine_unavailable');
 assert.equal(result.manualReviewRequired,true);
 assert.equal(f.counts.quarantineCreates,1);
 assert.equal(f.rows.length,1);
 assert.equal(f.counts.supplierWrites,0);
});
test('ambiguous CREATE after commit leaves persistent manual guard; NO duplicate writes',async()=>{
 const f=fixture();
 f.setTimeoutAfterCreate(true);
 const one=await stageFutureGreenInteractiveHttpCallback(f.callback(),f.opts);
 assert.equal(one.stage,'quarantine_unavailable');
 assert.equal(f.rows.length,1,'create may already have committed');
 assert.notEqual(f.control.unknown_guard_key,'');
 assert.equal(f.counts.quarantineCreates,1);
 f.setTimeoutAfterCreate(false);
 f.control.unknown_create_until='2000-01-01T00:00:00.000Z';
 const two=await stageFutureGreenInteractiveHttpCallback(f.callback(),f.opts);
 assert.equal(two.stage,'quarantine_unavailable');
 assert.equal(f.counts.quarantineCreates,1);
 assert.equal(f.rows.length,1);
 assert.equal(f.counts.supplierWrites,0);
});
test('ambiguous reread or release remains fail closed; no ACK and no supplier status change',async()=>{
 for(const fault of ['reread','release']){
  const f=fixture();
  if(fault==='reread')f.setFailOnReread(true);
  else f.setFailOnRelease(true);
  const result=await stageFutureGreenInteractiveHttpCallback(f.callback(),f.opts);
  assert.equal(result.stage,'quarantine_unavailable',fault);
  assert.equal(planFutureGreenWebhookHttpContract(result).plannedHttpStatus,503);
  assert.equal(f.rows.length,1);
  assert.equal(f.counts.quarantineCreates,1);
  assert.notEqual(f.control.unknown_guard_key,'',
   'guard stays for owner review after ambiguous persisted record');
  assert.equal(f.counts.supplierWrites,0);
 }
});
test('two concurrent unknown Green deliveries cannot create duplicate quarantine records',async()=>{
 const f=fixture();
 const first=stageFutureGreenInteractiveHttpCallback(f.callback(),f.opts);
 const second=stageFutureGreenInteractiveHttpCallback(f.callback(),f.opts);
 const results=await Promise.all([first,second]);
 assert.equal(f.rows.length,1);
 assert.equal(f.counts.quarantineCreates,1);
 assert.equal(f.counts.supplierWrites,0);
 assert.ok(results.some(x=>x.stage==='quarantined_unknown'));
 for(const result of results){
  assert.notEqual(result.canAcknowledge,true);
  assert.equal(planFutureGreenWebhookAck(result).mayRespond200AfterProviderQa,false);
 }
});
test('unknown metadata lock is ISOLATED from known signed-button receipt registration guard',async()=>{
 const f=fixture();
 f.control.inbound_guard_key='known-receipt-persistent-guard-stays-untouched';
 const result=await stageFutureGreenInteractiveHttpCallback(f.callback(),f.opts);
 assert.equal(result.stage,'quarantined_unknown');
 assert.equal(f.control.inbound_guard_key,
  'known-receipt-persistent-guard-stays-untouched');
 assert.equal(f.control.unknown_guard_key,'');
 const knownCode=fs.readFileSync('base44/shared/whatsappInboundInbox.ts','utf8');
 assert.doesNotMatch(knownCode,/unknown_guard_key|unknown_create_owner/);
});
test('invalid/foreign/expired provider callbacks never reach unknown quarantine or DB',async()=>{
 const bad=[
  {...raw(),timestamp:Math.floor((NOW-72*3600000)/1000)},
  {...raw(),timestamp:Math.floor((NOW+3600000)/1000)},
  {...raw(),instanceData:{idInstance:123456789,typeInstance:'whatsapp'}},
  {...raw(),senderData:{chatId:'972501234567@c.us',sender:'972000000000@c.us'}},
  {...raw(),senderData:{chatId:'PRIVATE@group.us',sender:'PRIVATE@group.us'}},
  {...raw(),idMessage:'invalid id \n'},
  {...raw(),typeWebhook:'otherMessage'}
 ];
 for(const entry of bad){
  assert.equal(isEligibleUnknownGreenCallback(entry,ACCOUNT,NOW),false);
  const f=fixture();
  const result=await stageFutureGreenInteractiveHttpCallback(f.callback(entry),f.opts);
  assert.notEqual(result.stage,'quarantined_unknown');
  assert.equal(f.counts.quarantineCreates,0);
  assert.equal(f.counts.supplierWrites,0);
  assert.equal(planFutureGreenWebhookHttpContract(result).acknowledgeCandidate,false);
 }
});
test('owner audit is bounded on demand and exposes ONLY short fingerprints and statuses',async()=>{
 const f=fixture();
 await registerUnknownGreenCallbackQuarantine(f.client,raw(),{
  expectedInstanceId:ACCOUNT,fingerprintSecret:SECRET,now:NOW
 });
 const previous=f.counts.quarantineReads;
 const report=await inspectUnknownGreenQuarantineReadOnly(f.client);
 assert.equal(f.counts.quarantineReads,previous+1);
 assert.equal(report.pendingReview,1);
 assert.equal(report.sampleCount,1);
 assert.equal(report.noRawMessagesStored,true);
 assert.equal(report.unknownButtonsNeverAutoApproved,true);
 assert.match(report.list[0].reference,/^[a-f0-9]{12}$/);
 assert.equal(report.list[0].mayChangeSupplier,false);
 const serialized=JSON.stringify(report);
 for(const secret of ['PRIVATE-SUPPLIER-NAME','PRIVATE-ORIGINAL-STANZA',
  'PRIVATE-SUPPLIER-QUESTION','972501234567','gq1_','3EB0UNKNOWN'])
  assert.equal(serialized.includes(secret),false,secret);
});
test('canonical provider JSON ignores harmless nested key order changes on Green retries',async()=>{
 const source=raw(),reordered={};
 for(const key of Object.keys(source).reverse()){
  const value=source[key];
  reordered[key]=key==='messageData'
   ?Object.fromEntries(Object.entries(value).reverse()):value;
 }
 assert.equal(canonicalGreenCallbackJson(source),canonicalGreenCallbackJson(reordered));
 const f=fixture();
 assert.equal((await stageFutureGreenInteractiveHttpCallback(
  f.callback(source),f.opts)).stage,'quarantined_unknown');
 const second=await stageFutureGreenInteractiveHttpCallback(f.callback(reordered),f.opts);
 assert.equal(second.stage,'quarantined_unknown');
 assert.equal(second.quarantineKind,'duplicate');
 assert.equal(f.rows.length,1);
 assert.equal(f.counts.quarantineCreates,1);
});
test('default OFF: unknown callback stores ONLY HMAC, no recovery material',async()=>{
 const f=fixture();
 const result=await stageFutureGreenInteractiveHttpCallback(f.callback(),f.opts);
 assert.equal(result.encryptedRecoveryRecorded,false);
 const stored=JSON.stringify(f.rows);
 assert.equal(stored.includes('recovery_ciphertext'),false);
 assert.equal(stored.includes('recovery_nonce'),false);
 assert.equal(stored.includes('PRIVATE-SUPPLIER-QUESTION'),false);
 assert.equal(f.counts.supplierWrites,0);
});
test('approved AES-256-GCM recovery round trip is possible privately, but NEVER auto ACKs or applies',async()=>{
 const f=fixture(),keyBytes=crypto.getRandomValues(new Uint8Array(32));
 const key=Buffer.from(keyBytes).toString('base64url');
 const approval={ownerRetentionApproved:true,encryptionKey:key,keyId:'v1-green-recovery'};
 const event=raw();
 const first=await stageFutureGreenInteractiveHttpCallback(f.callback(event),{
  ...f.opts,encryptedUnknownRecovery:approval
 });
 assert.equal(first.stage,'quarantined_unknown');
 assert.equal(first.encryptedRecoveryRecorded,true);
 assert.equal(first.canAcknowledge,false);
 assert.equal(planFutureGreenWebhookHttpContract(first).plannedHttpStatus,503);
 assert.equal(f.rows.length,1);
 const row=f.rows[0];
 assert.equal(row.recovery_status,'encrypted');
 assert.equal(row.recovery_version,'aes256gcm-v1');
 assert.equal(row.recovery_key_id,'v1-green-recovery');
 assert.equal(UNKNOWN_RECOVERY_TTL_HOURS,48);
 assert.equal(Date.parse(row.recovery_expires_at),NOW+48*3600000);
 const serialized=JSON.stringify(row);
 for(const secret of ['PRIVATE-SUPPLIER-QUESTION','PRIVATE-SUPPLIER-NAME',
  'PRIVATE-ORIGINAL-STANZA','PRIVATE-BUTTON-ACTION','972501234567',key])
  assert.equal(serialized.includes(secret),false,secret);
 const result=await decryptUnknownGreenRecovery(row,{
  encryptionKey:key,keyId:'v1-green-recovery',now:NOW+1000
 });
 assert.equal(result.recoveredForManualReviewOnly,true);
 assert.equal(result.neverApplySupplierAutomatically,true);
 assert.equal(result.providerVerificationStillRequired,true);
 assert.equal(result.callback.messageData.futureInteractiveBetaReply.selectedId,
  'PRIVATE-BUTTON-ACTION');
 assert.equal(result.callback.senderData.chatId,'972501234567@c.us');
 assert.equal(result.callback.senderData.senderName,undefined,
  'unnecessary display name excluded BEFORE encryption');
 assert.equal(f.counts.supplierWrites,0);
 const report=await inspectUnknownGreenQuarantineReadOnly(f.client);
 assert.equal(report.list[0].encryptedRecoveryRecorded,true);
 assert.equal(report.list[0].encryptedRecoveryExpiresAt,row.recovery_expires_at);
 assert.equal(JSON.stringify(report).includes('recovery_ciphertext'),false);
 assert.equal(JSON.stringify(report).includes(row.recovery_nonce),false);
 assert.equal(JSON.stringify(report).includes(row.recovery_ciphertext),false);
 assert.equal(JSON.stringify(first).includes('recovery_ciphertext'),false);
});
test('AES-GCM recovery rejects wrong key, changed nonce, changed ciphertext, changed identity and expired access',async()=>{
 const f=fixture(),key=Buffer.from(crypto.getRandomValues(new Uint8Array(32)))
  .toString('base64url');
 await stageFutureGreenInteractiveHttpCallback(f.callback(),{
  ...f.opts,encryptedUnknownRecovery:{
   ownerRetentionApproved:true,encryptionKey:key,keyId:'v1-green-recovery'}
 });
 const row=f.rows[0];
 const options={encryptionKey:key,keyId:'v1-green-recovery',now:NOW+1000};
 const badKey=Buffer.from(crypto.getRandomValues(new Uint8Array(32)))
  .toString('base64url');
 for(const [changed,opts] of [
  [row,{...options,encryptionKey:badKey}],
  [{...row,recovery_nonce:'AAAAAAAAAAAAAAAA'},options],
  [{...row,recovery_ciphertext:'AAAAAAAAAAAAAAAAAAAAAA'},options],
  [{...row,quarantine_key:'gq1_'+'f'.repeat(64)},options],
  [{...row,payload_mac:'f'.repeat(64)},options],
  [{...row,recovery_expires_at:new Date(NOW+49*3600000).toISOString()},options],
  [row,{...options,now:NOW+48*3600000}],
  [row,{...options,keyId:'v2-green-recovery'}]
 ]){
  await assert.rejects(decryptUnknownGreenRecovery(changed,opts),
   err=>err.code==='encrypted_unknown_recovery_unavailable');
 }
});
test('without explicit owner approval, invalid key and generic unknown shape cannot be encrypted or ACKed',async()=>{
 const f=fixture();
 const key=Buffer.from(crypto.getRandomValues(new Uint8Array(32)))
  .toString('base64url');
 for(const config of [
  {ownerRetentionApproved:false,encryptionKey:key,keyId:'v1-green-recovery'},
  {ownerRetentionApproved:true,encryptionKey:'wrong-length',keyId:'v1-green-recovery'},
  {ownerRetentionApproved:true,encryptionKey:key,keyId:'invalid-key-id'}
 ]){
  const result=await stageFutureGreenInteractiveHttpCallback(f.callback(),{
   ...f.opts,encryptedUnknownRecovery:config
  });
  assert.equal(result.stage,'quarantine_unavailable');
  assert.equal(f.rows.length,0);
  assert.equal(f.control.unknown_guard_key,'');
  assert.equal(planFutureGreenWebhookHttpContract(result).plannedHttpStatus,503);
 }
 const generic=raw();generic.messageData={typeMessage:'newOrdinaryUnknown',
  newOrdinaryUnknown:{text:'PRIVATE-NORMAL-CHAT'}};
 const result=await stageFutureGreenInteractiveHttpCallback(f.callback(generic),{
  ...f.opts,encryptedUnknownRecovery:{
   ownerRetentionApproved:true,encryptionKey:key,keyId:'v1-green-recovery'}
 });
 assert.equal(result.stage,'quarantined_unknown');
 assert.equal(result.encryptedRecoveryRecorded,false);
 assert.equal(f.rows.length,1,'record only the HMAC of new plain-chat format');
 assert.equal('recovery_ciphertext' in f.rows[0],false);
 assert.equal(planFutureGreenWebhookHttpContract(result).plannedHttpStatus,503);
});
test('encrypted duplicate never rewrites nonce, extends retention or stores a second payload',async()=>{
 const f=fixture(),key=Buffer.from(crypto.getRandomValues(new Uint8Array(32)))
  .toString('base64url');
 const approval={ownerRetentionApproved:true,encryptionKey:key,keyId:'v1-green-recovery'};
 const first=await stageFutureGreenInteractiveHttpCallback(f.callback(),{
  ...f.opts,encryptedUnknownRecovery:approval
 });
 const nonce=f.rows[0].recovery_nonce;
 const expiry=f.rows[0].recovery_expires_at;
 const second=await stageFutureGreenInteractiveHttpCallback(f.callback(),{
  ...f.opts,now:NOW+3500000,encryptedUnknownRecovery:approval
 });
 assert.equal(first.quarantineKind,'stored');
 assert.equal(second.quarantineKind,'duplicate');
 assert.equal(second.encryptedRecoveryRecorded,true);
 assert.equal(f.rows[0].recovery_nonce,nonce);
 assert.equal(f.rows[0].recovery_expires_at,expiry);
 assert.equal(f.counts.quarantineCreates,1);
});
test('encrypted quarantine entity is SERVICE ROLE ONLY: direct client RLS denies every operation',()=>{
 const schema=JSON.parse(fs.readFileSync(
  'base44/entities/WhatsAppInboundQuarantine.jsonc','utf8'));
 for(const operation of ['read','create','update','delete'])
  assert.equal(schema.rls[operation],false,
   'admin-role client SDK must NEVER read encrypted personal callbacks directly');
 const owner=fs.readFileSync('base44/functions/WhatsAppQueueAdmin/entry.ts','utf8');
 assert.match(owner,/inspectUnknownGreenRecoveryStructureReadOnly\(client/);
 assert.match(owner,/actor\.role!=='admin'/);
 assert.match(owner,/OWNER_EMAIL/);
});
test('quarantine schema contains metadata ONLY and is not a public webhook handler',()=>{
 const schema=JSON.parse(fs.readFileSync(
  'base44/entities/WhatsAppInboundQuarantine.jsonc','utf8'));
 const fields=Object.keys(schema.properties).join(' ');
 assert.doesNotMatch(fields,/phone|chat|raw|payload_body|stanza|sender|message_text|selected_id|encrypted_blob/i);
 assert.equal(schema.properties.state.default,'needs_review');
 const code=fs.readFileSync('base44/shared/greenUnknownCallbackQuarantine.ts','utf8');
 assert.doesNotMatch(code,/^\s*Deno\.serve\(/m);
 assert.doesNotMatch(code,/fetch\(/);
});
