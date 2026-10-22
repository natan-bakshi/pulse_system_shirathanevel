import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';
import {whatsappEnqueueReceiptState,isWhatsAppEnqueueConfirmed} from '../base44/shared/whatsappReceipt.ts';
function setup(send){
 let emails=0;
 const code=esbuild.transformSync(fs.readFileSync('base44/shared/clientBillingMessages.ts','utf8'),{loader:'ts',format:'cjs',target:'es2022'}).code;
 const module={exports:{}};
 vm.runInNewContext(code,{module,exports:module.exports,console:{warn:()=>{}},require:path=>{
  if(path.endsWith('whatsappSend.ts'))return {sendWhatsAppText:send};
  if(path.endsWith('whatsappReceipt.ts'))return {whatsappEnqueueReceiptState,isWhatsAppEnqueueConfirmed};
  throw Error('Unexpected import');
 }});
 const client={asServiceRole:{integrations:{Core:{SendEmail:async()=>{emails++;}}}}};
 return {send:()=>module.exports.sendClientMessage(client,{phone:'0501234567',email:'qa@example.test',subject:'test',body:'test',businessName:'QA',idempotencyKey:'qa'}),get emails(){return emails}};
}
test('ambiguous Outbox CREATE never triggers duplicate email fallback',async()=>{
 const x=setup(async()=>{throw Object.assign(new Error('lost response'),{queuePhase:'outbox_create'});});
 await assert.rejects(x.send(),e=>e.deliveryUncertain===true);
 assert.equal(x.emails,0);
});
test('ambiguous dedupe lookup never triggers email fallback',async()=>{
 const x=setup(async()=>{throw Object.assign(new Error('lookup timeout'),{queuePhase:'dedupe_lookup'});});
 await assert.rejects(x.send(),e=>e.deliveryUncertain===true);
 assert.equal(x.emails,0);
});
test('definite WhatsApp input rejection retains existing email fallback',async()=>{
 const x=setup(async()=>{throw Error('Invalid phone');});
 assert.deepEqual(Array.from(await x.send()),['email']);
 assert.equal(x.emails,1);
});
