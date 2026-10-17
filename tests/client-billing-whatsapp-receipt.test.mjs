import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';
import {whatsappEnqueueReceiptState,isWhatsAppEnqueueConfirmed} from '../base44/shared/whatsappReceipt.ts';

const cases=[
 [{queued:true,status:'queued',success:true},'queued',true],
 [{queued:true,status:'retry_wait',success:true},'retry_wait',true],
 [{queued:false,status:'accepted',success:true},'accepted',true],
 [{queued:false,status:'unknown',success:true},'unknown',false],
 [{queued:true,status:'unknown',success:true},'unknown',false],
 [{queued:true,status:'failed',success:true},'failed',false],
 [{queued:false,status:'cancelled',success:true},'cancelled',false],
 [{queued:true,status:'garbled',success:true},'unverified',false],
 [{queued:true,status:'queued',success:false},'unverified',false],
 [{queued:true,success:true},'queued',true],
 [{legacyDirect:true,status:'accepted',messageId:'green-abc',success:true},'accepted',true],
 [null,'unverified',false]
];
test('one canonical receipt state is used by all WhatsApp producers',()=>{
 for(const [receipt,status,isConfirmed] of cases){
   assert.equal(whatsappEnqueueReceiptState(receipt),status);
   assert.equal(isWhatsAppEnqueueConfirmed(receipt),isConfirmed);
 }
});
function loadBilling(receipt,{emailFailure=false,transportFailure=null}={}){
 const code=esbuild.transformSync(fs.readFileSync('base44/shared/clientBillingMessages.ts','utf8'),{loader:'ts',format:'cjs',target:'es2022'}).code;
 let sent=0,sentEmail=0,lastContext=null;
 const module={exports:{}};
 vm.runInNewContext(code,{module,exports:module.exports,
   console:{warn:()=>{}},
   require:name=>{
     if(name.endsWith('whatsappSend.ts'))return {sendWhatsAppText:async(_phone,_body,_client,context)=>{
       sent++;lastContext=context;
       if(transportFailure)throw transportFailure;
       return receipt;
     }};
     if(name.endsWith('whatsappReceipt.ts'))return {whatsappEnqueueReceiptState,isWhatsAppEnqueueConfirmed};
     throw Error('Unexpected import '+name);
   }
 });
 const client={asServiceRole:{integrations:{Core:{SendEmail:async()=>{
   sentEmail++;if(emailFailure)throw Error('synthetic email unavailable');
   return {success:true};
 }}}}};
 return {
   send:(extra={})=>module.exports.sendClientMessage(client,{
     phone:'0501234567',email:'test@example.test',subject:'test',
     body:'A secure link',businessName:'Pulse',idempotencyKey:'payment-receipt:payment-abc123',
     ...extra
   }),
   get whatsappCalls(){return sent;},get emailCalls(){return sentEmail;},
   get context(){return lastContext;}
 };
}
test('billing receipt with queued Outbox saves the stable business key and does not email',async()=>{
 const x=loadBilling({queued:true,status:'queued',success:true,jobId:'queued-1'});
 const channels=await x.send();
 assert.deepEqual(Array.from(channels),['whatsapp']);
 assert.equal(x.whatsappCalls,1);assert.equal(x.emailCalls,0);
 assert.equal(x.context.idempotencyKey,'payment-receipt:payment-abc123');
});
test('billing callback repeat seeing accepted outbox does not email or enqueue second message',async()=>{
 const x=loadBilling({queued:false,status:'accepted',success:true,jobId:'old'});
 const channels=await x.send();
 assert.deepEqual(Array.from(channels),['whatsapp']);
 assert.equal(x.emailCalls,0);
});
test('billing unknown, resolved, cancelled outcomes do not silently email or mark reminder sent',async()=>{
 for(const status of ['unknown','resolved','cancelled','expired']){
   const x=loadBilling({queued:false,status,jobId:'provider-uncertain',success:true});
   await assert.rejects(x.send(),err=>err.deliveryUncertain===true&&err.queueStatus===status);
   assert.equal(x.emailCalls,0,status+' cannot generate a duplicate or a second channel');
 }
});
test('billing definite Outbox rejection falls back to existing customer email',async()=>{
 const x=loadBilling({queued:false,status:'failed',success:true});
 const channels=await x.send();
 assert.deepEqual(Array.from(channels),['email']);
 assert.equal(x.emailCalls,1);
});
test('billing provider network timeout does not automatically create duplicate email',async()=>{
 const x=loadBilling(null,{transportFailure:Object.assign(new Error('timeout'),{deliveryUncertain:true})});
 await assert.rejects(x.send(),e=>e.deliveryUncertain===true);
 assert.equal(x.emailCalls,0);
});
test('billing refuses false success if neither channel accepted it',async()=>{
 const x=loadBilling({queued:false,status:'failed'},{emailFailure:true});
 await assert.rejects(x.send(),/synthetic email unavailable/);
 const noContacts=loadBilling(null);
 await assert.rejects(noContacts.send({phone:'',email:''}),/Neither WhatsApp nor email accepted/);
});
test('scheduled payment receipt and payment reminder must pass source-specific keys',()=>{
 const receipt=fs.readFileSync('base44/functions/invoice4uClearingCallback/entry.ts','utf8');
 const reminder=fs.readFileSync('base44/functions/processPaymentLinkLifecycle/entry.ts','utf8');
 assert.match(receipt,/idempotencyKey:'payment-receipt:'\+payment\.id/);
 assert.match(reminder,/idempotencyKey:'payment-link-reminder:'\+payment\.id/);
});
