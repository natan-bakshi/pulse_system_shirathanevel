import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGreenButtonSelection} from '../base44/shared/greenInteractiveCallback.ts';
const now=Date.parse('2026-10-26T12:00:00Z');
const baseline={
 typeWebhook:'incomingMessageReceived',
 instanceData:{idInstance:9903183013,wid:'972599999999@c.us',typeInstance:'whatsapp'},
 timestamp:Math.floor(now/1000),
 idMessage:'C0CD39BB261589D5C98412D255CD000B',
 senderData:{chatId:'972501234567@c.us',sender:'972501234567@c.us',senderName:'Untrusted'},
 messageData:{typeMessage:'interactiveButtonsResponse',quotedMessage:{stanzaId:'3EB0A5815E6EBF7DE71DE3'},
  interactiveButtonsResponse:{stanzaId:'3EB0A5815E6EBF7DE71DE3',selectedIndex:0,
   selectedId:'wa1_abc123xyz',selectedDisplayText:'אישור שיבוץ'}}
};
const expected='9903183013';
const parse=raw=>parseGreenButtonSelection(raw,expected,now);
test('Green beta interactiveButtonsResponse uses stanzaId and selectedId, ignores display text',()=>{
 const response=parse(baseline);
 assert.equal(response.provider,'green');
 assert.equal(response.providerEventId,baseline.idMessage);
 assert.equal(response.originalProviderMessageId,'3EB0A5815E6EBF7DE71DE3');
 assert.equal(response.senderAccountId,expected);
 assert.equal(response.buttonId,'wa1_abc123xyz');
 assert.equal(response.senderChatId,'972501234567@c.us');
 assert.equal(JSON.stringify(response).includes('Untrusted'),false);
 assert.equal(JSON.stringify(response).includes('אישור שיבוץ'),false);
});
test('legacy simple and template selection formats are accepted only with documented fields',()=>{
 const old={...baseline,messageData:{typeMessage:'buttonsResponseMessage',
  buttonsResponseMessage:{selectedButtonId:'wa1_old456',stanzaId:'BAE53AFDD5F0C137',
   selectedButtonText:'not an action'}}};
 assert.equal(parse(old).buttonId,'wa1_old456');
 const template={...baseline,messageData:{typeMessage:'templateButtonsReplyMessage',
  templateButtonReplyMessage:{selectedId:'wa1_template',stanzaId:'BAE53AFDD5F0C137',
   selectedDisplayText:'not an action'}}};
 assert.equal(parse(template).originalProviderMessageId,'BAE53AFDD5F0C137');
 // Green official docs list plural in the parameter table but give a
 // singular typeMessage in the actual webhook example. Both must work.
 const singular={...template,messageData:{...template.messageData,
  typeMessage:'templateButtonReplyMessage'}};
 assert.equal(parse(singular).originalProviderMessageId,'BAE53AFDD5F0C137');
 assert.equal(parse(singular).buttonId,'wa1_template');
});
test('wrong Green instance and invalid sender or group callback fail closed',()=>{
 const changes=[
  {instanceData:{...baseline.instanceData,idInstance:1234567890}},
  {instanceData:{...baseline.instanceData,typeInstance:'different'}},
  {senderData:{...baseline.senderData,chatId:'972501234567@g.us'}},
  {senderData:{...baseline.senderData,sender:'972508888888@c.us'}},
  {idMessage:''},{typeWebhook:'outgoingMessageStatus'},
  {timestamp:Math.floor((now-72*3600000)/1000)},
  {timestamp:Math.floor((now+3600000)/1000)}
 ];
 for(const patch of changes)
  assert.equal(parse({...baseline,...patch}),null,JSON.stringify(patch));
});
test('unknown beta formats, changed stanza, missing IDs, malicious button text and oversized ID are rejected',()=>{
 for(const changedMessageData of [
  {typeMessage:'textMessage',textMessage:{textMessage:'yes'}},
  {typeMessage:'interactiveButtonsReply',interactiveButtonsReply:{}},
  {typeMessage:'interactiveButtonsResponse',interactiveButtonsResponse:{
   stanzaId:'different-stanza',selectedId:'wa1_abc123xyz'},
   quotedMessage:{stanzaId:'BAE53AFDD5F0C137'}},
  {typeMessage:'buttonsResponseMessage',buttonsResponseMessage:{
   stanzaId:'3EB0A5815E6EBF7DE71DE3',selectedButtonId:'a'.repeat(129)}},
  {typeMessage:'templateButtonsReplyMessage',templateButtonReplyMessage:{
   stanzaId:'3EB0A5815E6EBF7DE71DE3',selectedId:'delete_service\n'}},
  {typeMessage:'buttonsResponseMessage',buttonsResponseMessage:{
   selectedButtonId:'wa1_abc123xyz'}}
 ]){
  assert.equal(parse({...baseline,messageData:changedMessageData}),null);
 }
});
