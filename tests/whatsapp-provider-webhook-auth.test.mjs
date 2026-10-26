import test from 'node:test';
import assert from 'node:assert/strict';
import {authenticateWhatsAppProviderCallback} from '../base44/shared/whatsappProviderWebhookAuth.ts';
const greenSecret='green-qa-webhook-authorization-secret-01234';
const wasenderSecret='wasender-qa-webhook-signature-secret-4567';
function auth(provider,headers,webhookSecret){
 return authenticateWhatsAppProviderCallback({provider,headers,webhookSecret});
}
test('GREEN API Webhook URL Token uses exact Bearer authorization, not a guessed HMAC',()=>{
 assert.equal(auth('green',{Authorization:'Bearer '+greenSecret},greenSecret),true);
 assert.equal(auth('green',{'authorization':'Bearer '+greenSecret},greenSecret),true);
 assert.equal(auth('green',new Headers({'Authorization':'Bearer '+greenSecret}),greenSecret),true);
 for(const header of [
  '',greenSecret,'Basic '+greenSecret,'Bearer '+greenSecret+'more',
  'Bearer '+greenSecret.slice(0,-1),'Bearer  '+greenSecret,'Bearer '+greenSecret+',other'
 ])assert.equal(auth('green',{Authorization:header},greenSecret),false);
});
test('Wasender X-Webhook-Signature is exact shared secret, NOT hex HMAC',()=>{
 assert.equal(auth('wasender',{'X-Webhook-Signature':wasenderSecret},wasenderSecret),true);
 assert.equal(auth('wasender',new Headers({'x-webhook-signature':wasenderSecret}),wasenderSecret),true);
 for(const header of [
  '','Bearer '+wasenderSecret,wasenderSecret+'0',wasenderSecret.slice(1),
  '0'.repeat(64),wasenderSecret+',other'
 ])assert.equal(auth('wasender',{'X-Webhook-Signature':header},wasenderSecret),false);
});
test('cross-provider credentials, missing secret, unknown provider and short secrets fail closed',()=>{
 assert.equal(auth('green',{'X-Webhook-Signature':wasenderSecret},greenSecret),false);
 assert.equal(auth('wasender',{Authorization:'Bearer '+greenSecret},wasenderSecret),false);
 assert.equal(auth('wasender',{'X-Webhook-Signature':wasenderSecret},''),false);
 assert.equal(auth('wasender',{'X-Webhook-Signature':wasenderSecret},'short'),false);
 assert.equal(auth('wasender',{'X-Webhook-Signature':wasenderSecret+'\n'},wasenderSecret),false);
 assert.equal(auth('other',{'Authorization':'Bearer '+greenSecret},greenSecret),false);
});
