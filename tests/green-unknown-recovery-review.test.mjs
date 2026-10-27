import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fingerprintUnknownGreenCallback}
 from '../base44/shared/greenUnknownCallbackQuarantine.ts';
import {encryptUnknownGreenRecovery}
 from '../base44/shared/greenUnknownRecoveryEnvelope.ts';
import {inspectUnknownGreenRecoveryStructureReadOnly}
 from '../base44/shared/greenUnknownRecoveryReview.ts';
const NOW=Date.parse('2026-10-27T12:00:00.000Z');
const ACCOUNT='9903183013';
const SIGNING='synthetic-not-real-action-signing-secret-1122334455667788';
const KEY=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
const raw=()=>({
 typeWebhook:'incomingMessageReceived',idMessage:'3EB0NEWINTERACTIVEREPLY11223344',
 timestamp:Math.floor((NOW-3600000)/1000),
 instanceData:{idInstance:Number(ACCOUNT),typeInstance:'whatsapp'},
 senderData:{chatId:'972501234567@c.us',sender:'972501234567@c.us',
  senderName:'SECRET-SUPPLIER-SENDER'},
 messageData:{typeMessage:'futureInteractiveBetaReply',
  futureInteractiveBetaReply:{selectedId:'SECRET_APPROVE_ACTION',
   stanzaId:'SECRET_ORIGINAL_ASSIGNMENT_STANZA',text:'SECRET-SUPPLIER-TEXT'}}
});
async function fixture(){
 const event=raw();
 const identity=await fingerprintUnknownGreenCallback(event,{
  expectedInstanceId:ACCOUNT,fingerprintSecret:SIGNING,now:NOW
 });
 const envelope=await encryptUnknownGreenRecovery(event,identity,{
  encryptionKey:KEY,keyId:'v1-green-recovery',ownerRetentionApproved:true,now:NOW
 });
 const row={id:'q-private-record-1',...identity,...envelope,
  registered_at:new Date(NOW).toISOString()};
 const counts={reads:0,writes:0,providers:0};
 const client={asServiceRole:{entities:{WhatsAppInboundQuarantine:{
  get:async id=>{counts.reads++;return row.id===id?row:null;},
  updateMany:async()=>{counts.writes++;throw Error('No DB write allowed')}
 },WhatsAppOutbox:{
  filter:async()=>{counts.providers++;throw Error('No provider lookup allowed')}
 }}}};
 const request={id:row.id,reference:row.quarantine_key.slice(-12)};
 const opts={expectedInstanceId:ACCOUNT,
  fingerprintSecret:SIGNING,encryptionKey:KEY,
  keyId:'v1-green-recovery',now:NOW+1000};
 return {row,request,opts,client,counts};
}
test('owner reviewed AES-GCM callback exposes STRUCTURAL HINTS ONLY, never phone, button value, stanza or message',async()=>{
 const f=await fixture();
 const report=await inspectUnknownGreenRecoveryStructureReadOnly(
  f.client,f.request,f.opts);
 assert.deepEqual(report,{
  reference:f.request.reference,
  class:'interactive_like',
  hasSelectionIdentifierHint:true,
  hasOriginalMessageReferenceHint:true,
  formatRecognizedByCurrentParser:false,
  originalProviderIdentityReverified:true,
  encryptedPayloadIntegrityVerified:true,
  callbackReleasedToBrowser:false,containsPersonalData:false,
  onlyStructuralHintsReturned:true,
  neverApproveOrRejectSupplier:true,neverSendWhatsApp:true,
  neverReturn200ForUnknown:true,manualInvestigationRequired:true,
  noDatabaseWrites:true,noProviderCalls:true,liveInboundNotActivated:true
 });
 assert.deepEqual(f.counts,{reads:1,writes:0,providers:0});
 const serialized=JSON.stringify(report);
 for(const secret of ['SECRET-SUPPLIER-SENDER','SECRET_APPROVE_ACTION',
  'SECRET_ORIGINAL_ASSIGNMENT_STANZA','SECRET-SUPPLIER-TEXT',
  '972501234567',f.row.id,f.row.payload_mac,
  f.row.recovery_ciphertext,KEY])
  assert.equal(serialized.includes(secret),false,'leak '+secret);
});
test('invalid review id, suffix or unsupported token fails BEFORE any DB access',async()=>{
 const f=await fixture();
 for(const request of [
  {...f.request,id:'../private/record'},
  {...f.request,id:'x'},
  {...f.request,reference:'wrong-token!'},
  {...f.request,reference:'0'.repeat(12)},
  {id:''}
 ]){
  await assert.rejects(inspectUnknownGreenRecoveryStructureReadOnly(
   f.client,request,f.opts),
   err=>err.code==='green_recovery_review_unavailable');
 }
 // Mismatched-but-syntactically-valid suffix requires one exact row read;
 // malformed ID/reference do not touch the DB.
 assert.equal(f.counts.reads,1);
 assert.equal(f.counts.writes,0);
});
test('different Quarantine company, metadata-only row and mismatched source are denied',async()=>{
 const f=await fixture();
 for(const patch of [
  {company_id:'another_tenant'},
  {provider:'wasender'},
  {state:'applied'},
  {format_code:'unrecognized_incoming'},
  {recovery_status:'erased'},
  {recovery_version:'unknown'},
  {quarantine_key:'gq1_'+'c'.repeat(64)}
 ]){
  const saved={...f.row};
  Object.assign(f.row,patch);
  await assert.rejects(inspectUnknownGreenRecoveryStructureReadOnly(
   f.client,f.request,f.opts),err=>err.code==='green_recovery_review_unavailable');
  Object.assign(f.row,saved);
 }
 assert.equal(f.counts.writes,0);
});
test('wrong decryption key, expired period, key rotation without old key and tampering fail closed',async()=>{
 const f=await fixture();
 const other=Buffer.from(crypto.getRandomValues(new Uint8Array(32)))
  .toString('base64url');
 const options=[
  {...f.opts,encryptionKey:other},
  {...f.opts,keyId:'v2-green-recovery'},
  {...f.opts,now:NOW+48*3600000},
  {...f.opts,expectedInstanceId:'9000000000'},
  {...f.opts,fingerprintSecret:'wrong-but-valid-action-signing-secret'}
 ];
 for(const opts of options){
  await assert.rejects(inspectUnknownGreenRecoveryStructureReadOnly(
   f.client,f.request,opts),err=>err.code==='green_recovery_review_unavailable');
 }
 const original=f.row.payload_mac;
 f.row.payload_mac='0'.repeat(64);
 await assert.rejects(inspectUnknownGreenRecoveryStructureReadOnly(
  f.client,f.request,f.opts),err=>err.code==='green_recovery_review_unavailable');
 f.row.payload_mac=original;
 assert.equal(f.counts.writes,0);
});
test('read-only owner triage helper has no outbound operations and cannot be used from direct webhook',()=>{
 const code=fs.readFileSync('base44/shared/greenUnknownRecoveryReview.ts','utf8')
  .split('\n').filter(x=>!x.trim().startsWith('//')).join('\n');
 assert.doesNotMatch(code,/Deno\.serve|fetch\(|updateMany\(|\.create\(|\bResponse\(/);
 const staging=fs.readFileSync('base44/shared/greenInteractiveHttpStaging.ts','utf8');
 assert.doesNotMatch(staging,/inspectUnknownGreenRecoveryStructureReadOnly/);
});
