import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
 verifyGreenQuoteJournal,quoteCandidateFromAcceptedAssignment,
 chooseVerifiedGreenNativeQuote,findCandidateForSupplierQuote
} from '../base44/shared/greenVerifiedQuotePlanner.ts';

const reply={
 companyId:'shirat_hanevel',eventServiceId:'service-12345',
 supplierId:'supplier-12345',revision:'r3',
 chatId:'972501234567@c.us',provider:'green',senderAccountId:'9903183013'
};
const origin={
 id:'job-12345',source_type:'assignment_new',status:'accepted',
 provider:'green',requested_provider:'green',
 company_id:'shirat_hanevel',sender_account_id:'9903183013',
 chat_id:'972501234567@c.us',event_service_id:'service-12345',
 supplier_id:'supplier-12345',assignment_revision:'r3',
 provider_message_id:'3EB0OLDASSIGNMENT123456789'
};
const journal={
 chatId:origin.chat_id,idMessage:origin.provider_message_id,
 type:'outgoing',sendByApi:true,statusMessage:'delivered',
 isDeleted:false,deletedMessageId:''
};
test('green quote requires exact real accepted assignment and verified journal in same chat',()=>{
 const q=chooseVerifiedGreenNativeQuote({
  origin,reply,journal,targetMethod:'sendMessage'
 });
 assert.deepEqual(q,{quotedMessageId:origin.provider_message_id,
  reason:'verified_text_quote'});
 assert.equal(verifyGreenQuoteJournal(journal,{
  chatId:origin.chat_id,idMessage:origin.provider_message_id
 }).verified,true);
});
test('quote refuses stale revision, foreign sender, provider, recipient, chat, company and unproven receipt',()=>{
 for(const [key,value] of Object.entries({
  status:'unknown',provider:'wasender',requested_provider:'wasender',
  company_id:'another_company',sender_account_id:'9903183014',
  chat_id:'972509999999@c.us',event_service_id:'service-else',
  supplier_id:'supplier-else',assignment_revision:'r2',
  provider_message_id:''
 })){
  const r=quoteCandidateFromAcceptedAssignment({...origin,[key]:value},reply);
  assert.equal(r.origin,null,key);
 }
 for(const [key,value] of Object.entries({
  chatId:'972509999999@c.us',idMessage:'3EB0FAKE',
  type:'incoming',sendByApi:false,statusMessage:'pending',isDeleted:true,
  deletedMessageId:'3EB0DELETED'
 })){
  assert.equal(verifyGreenQuoteJournal({...journal,[key]:value},{
   chatId:origin.chat_id,idMessage:origin.provider_message_id
  }).verified,false,key);
 }
});
test('quote only for plain text; Green interactive buttons cannot receive undocumented quote fields',()=>{
 for(const method of ['sendInteractiveButtons','sendInteractiveButtonsReply','sendFileByUrl']){
  const result=chooseVerifiedGreenNativeQuote({
   origin,reply,journal,targetMethod:method
  });
  assert.equal(result.quotedMessageId,null,method);
  assert.equal(result.reason,'interactive_quote_not_documented');
 }
 const nullJournal=chooseVerifiedGreenNativeQuote({
  origin,reply,journal:null,targetMethod:'sendMessage'
 });
 assert.equal(nullJournal.quotedMessageId,null);
});
test('quote origin lookup bounded to latest accepted assignment, never falls back to stale older revision',async()=>{
 const reads=[];
 const newest={...origin,assignment_revision:'r4'};
 const client={asServiceRole:{entities:{WhatsAppOutbox:{
  filter:async(...args)=>{reads.push(args);return [newest,origin]}
 }}}};
 const r=await findCandidateForSupplierQuote(client,reply);
 assert.equal(r.origin,null);
 assert.equal(r.reason,'stale_revision');
 assert.equal(reads.length,1);
 assert.equal(reads[0][2],3);
 assert.equal(reads[0][0].event_service_id,reply.eventServiceId);
 assert.equal(reads[0][0].supplier_id,reply.supplierId);
 assert.equal(reads[0][0].status,'accepted');
 assert.equal(reads[0][0].source_type,'assignment_new');
 assert.equal((await findCandidateForSupplierQuote(client,{
  ...reply,chatId:'invalid'})).origin,null);
 assert.equal(reads.length,1,'invalid scope makes no database call');
});
test('quote planner is passive; existing provider transport remains unchanged and no getMessage cost yet',()=>{
 const src=fs.readFileSync('base44/shared/greenVerifiedQuotePlanner.ts','utf8');
 const transport=fs.readFileSync('base44/shared/whatsappSend.ts','utf8');
 assert.doesNotMatch(src,/fetch\(|Deno\.serve|setInterval\(|\.create\(|\.update\(/);
 assert.doesNotMatch(transport,/greenVerifiedQuotePlanner|quotedMessageId/);
 assert.match(src,/targetMethod!=='sendMessage'/);
 assert.match(src,/sendByApi!==true/);
});
