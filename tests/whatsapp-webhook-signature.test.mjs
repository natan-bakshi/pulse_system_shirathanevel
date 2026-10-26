import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {hmacSha256Hex,verifyWebhookHmac,constantTimeHexEqual} from '../base44/shared/whatsappWebhookSignature.ts';
const secret='sample-qa-secret-longer-than-24-bytes';
const time=Date.parse('2026-10-26T12:00:00Z');
const stamp=Math.floor(time/1000);
test('HMAC accepts raw unchanged signed body only within replay window',async()=>{
 const body='{"action":"assignment_approve"}';
 const signature=await hmacSha256Hex(secret,`${stamp}.${body}`,webcrypto.subtle);
 const args={secret,rawBody:body,signature,timestampSeconds:stamp};
 assert.equal(await verifyWebhookHmac(args,time,webcrypto.subtle),true);
 assert.equal(await verifyWebhookHmac({...args,rawBody:body+' '},time,webcrypto.subtle),false);
 assert.equal(await verifyWebhookHmac(args,time+301000,webcrypto.subtle),false);
 assert.equal(await verifyWebhookHmac({...args,timestampSeconds:stamp+1000},time,webcrypto.subtle),false);
});
test('reject malformed signature and oversize bodies',async()=>{
 assert.equal(constantTimeHexEqual('bad','bad'),false);
 assert.equal(await verifyWebhookHmac({secret,rawBody:'x',signature:'x',timestampSeconds:stamp},time,webcrypto.subtle),false);
 assert.equal(await verifyWebhookHmac({secret,rawBody:'x'.repeat(100001),signature:'0'.repeat(64),timestampSeconds:stamp},time,webcrypto.subtle),false);
});
