import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createSignedWhatsAppAction,verifySignedWhatsAppAction} from '../base44/shared/whatsappSignedAction.ts';

const now=Date.parse('2026-10-26T12:00:00Z');
const secret='integration-test-secret-server-only-minimum-32-bytes';
const binding={
 companyId:'shirat_hanevel',eventServiceId:'service-123',
 supplierId:'supplier-123',revision:'r6',outboxJobId:'outbox-123',
 provider:'green',senderAccountId:'green-instance-1',
 action:'assignment_approve',expiresAt:new Date(now+86400000).toISOString()
};
const signed=(patch={})=>createSignedWhatsAppAction({
 binding:{...binding,...patch},secret,nonce:'nonce-abcdef1234567890',issuedAt:now
},webcrypto.subtle);
test('server signature binds exact scope and can be verified within expiry',async()=>{
 const token=await signed();
 const verified=await verifySignedWhatsAppAction({token,secret,now:now+1000},webcrypto.subtle);
 assert.equal(verified.companyId,'shirat_hanevel');
 assert.equal(verified.eventServiceId,'service-123');
 assert.equal(verified.supplierId,'supplier-123');
 assert.equal(verified.action,'assignment_approve');
 assert.equal(verified.provider,'green');
 assert.equal(verified.senderAccountId,'green-instance-1');
 assert.equal(verified.nonce,'nonce-abcdef1234567890');
 assert.equal(token.includes('integration-test-secret'),false);
 assert.equal(token.includes('97250'),false);
});
test('HMAC rejects tampering with payload, action, revision, sender account, or signature',async()=>{
 const token=await signed();
 const [version,body,signature]=token.split('.');
 const decoded=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
 for(const changed of [
  {...decoded,action:'assignment_reject'},
  {...decoded,companyId:'another-company'},
  {...decoded,revision:'r9'},
  {...decoded,senderAccountId:'another-instance'},
  {...decoded,eventServiceId:'service-other'},
  {...decoded,nonce:'nonce-changed1234567890'}
 ]){
  const otherBody=Buffer.from(JSON.stringify(changed)).toString('base64url');
  const verified=await verifySignedWhatsAppAction({
   token:version+'.'+otherBody+'.'+signature,secret,now:now+1000
  },webcrypto.subtle);
  assert.equal(verified,null);
 }
 const altered=token.slice(0,-1)+(token.endsWith('A')?'B':'A');
 assert.equal(await verifySignedWhatsAppAction({token:altered,secret,now:now+1000},webcrypto.subtle),null);
});
test('wrong server secret, expired nonce, invalid shapes and office link cannot authorize mutations',async()=>{
 const token=await signed();
 assert.equal(await verifySignedWhatsAppAction({token,secret:'different-secret-server-only-minimum-32-bytes',now},webcrypto.subtle),null);
 assert.equal(await verifySignedWhatsAppAction({token,secret,now:now+2*86400000},webcrypto.subtle),null);
 assert.equal(await verifySignedWhatsAppAction({token,secret,now:now-4*86400000},webcrypto.subtle),null);
 assert.equal(await verifySignedWhatsAppAction({token:'v1.abc.def',secret,now},webcrypto.subtle),null);
 await assert.rejects(signed({action:'contact_office'}));
 await assert.rejects(signed({expiresAt:new Date(now+8*86400000).toISOString()}));
 await assert.rejects(createSignedWhatsAppAction({
  binding,nonce:'short',secret,issuedAt:now
 },webcrypto.subtle));
});
test('distinct action tokens have independent authenticated nonces',async()=>{
 const first=await signed();
 const second=await createSignedWhatsAppAction({
  binding,nonce:'nonce-other9876543210',secret,issuedAt:now
 },webcrypto.subtle);
 assert.notEqual(first,second);
 assert.equal((await verifySignedWhatsAppAction({token:second,secret,now},webcrypto.subtle)).nonce,
  'nonce-other9876543210');
});
