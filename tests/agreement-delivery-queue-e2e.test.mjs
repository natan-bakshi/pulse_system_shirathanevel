import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';
import {webcrypto} from 'node:crypto';
import {sendWhatsAppText,normalizeIsraeliPhone,toChatId} from '../base44/shared/whatsappSend.ts';
import {agreementDeliveryStatus,agreementDeliverySafeErrorLabel,agreementDeliveryErrorCode,
  agreementReceiptPatch,agreementPhoneFormatEvidence} from '../base44/shared/agreementDeliverySafety.ts';
import {inspectAgreementWhatsApp} from '../base44/shared/agreementDeliveryDiagnostics.ts';

globalThis.crypto||=webcrypto;
const previousDeno=globalThis.Deno;
globalThis.Deno={env:{get:k=>({GREEN_API_INSTANCE_ID:'fake-qa',GREEN_API_TOKEN:'fake-qa'})[k]||''}};
test.after(()=>{if(previousDeno===undefined)delete globalThis.Deno;else globalThis.Deno=previousDeno;});

function fixture({phone='15165551234',createMode='normal',lookupFails=false}={}){
 const agreements=[{id:'agreement-aa123',event_id:'event-aa123',recipient_phone:phone,
   created_by_user_id:'admin-aa123',link_expires_at:'2026-10-26T12:00:00Z'}];
 const control={id:'control-aa123',control_key:'global',enabled:true,paused:false,enqueue_owner:'',enqueue_until:''};
 const outbox=[],deliveries=[],alerts=[];
 let serial=0,sendFailures=0,createAttempts=0;
 const entities={
   WhatsAppQueueControl:{
     filter:async()=>[control],
     updateMany:async(q,p)=>{
       if(q.id!==control.id||q.enqueue_owner!==control.enqueue_owner)return {updated:0};
       Object.assign(control,p.$set);return {updated:1};
     }
   },
   WhatsAppOutbox:{
     filter:async(q)=>{
       if(lookupFails)throw Error('synthetic lookup network failure');
       return outbox.filter(j=>j.idempotency_key===q.idempotency_key);
     },
     create:async data=>{
       createAttempts++;
       if(createMode==='before_definite')throw Error('Central WhatsApp queue has not been activated');
       if(createMode==='before')throw Error('synthetic storage create failure');
       const job={...data,id:'outbox-'+(++serial)};
       outbox.push(job);
       if(createMode==='after')throw Error('synthetic response lost AFTER Outbox create');
       return job;
     }
   },
   AppSettings:{filter:async()=>[{setting_key:'whatsapp_default_provider',setting_value:'green'}]},
   ClientMessageDelivery:{
     filter:async(q)=>deliveries.filter(d=>(q.key?d.key===q.key:d.agreement_id===q.agreement_id)),
     create:async data=>{const row={...data,id:'delivery-'+(++serial)};deliveries.push(row);return {...row};},
     update:async(id,patch)=>{const item=deliveries.find(d=>d.id===id);Object.assign(item,patch);return {...item};}
   },
   EventAgreement:{get:async id=>agreements.find(a=>a.id===id)||null},
   User:{get:async()=>({id:'admin-aa123',email:'admin@example.test',role:'admin'})},
   InAppNotification:{
     filter:async()=>alerts.filter(a=>a.is_resolved===false),
     create:async data=>{const row={...data,id:'alert-'+(++serial)};alerts.push(row);return row;}
   }
 };
 const scoped={entities},root={asServiceRole:scoped};
 const source=esbuild.transformSync(fs.readFileSync('base44/shared/agreementLifecycle.ts','utf8'),{
   loader:'ts',format:'cjs',target:'es2022'
 }).code;
 const m={exports:{}};
 vm.runInNewContext(source,{
   module:m,exports:m.exports,console:{warn:()=>{},error:()=>{}},
   require:p=>{
     if(p.endsWith('whatsappSend.ts'))return {sendWhatsAppText,
       sendWhatsAppFileUri:async()=>{sendFailures++;throw Error('Unexpected file send')},
       sendWhatsAppFileByUrl:async()=>{sendFailures++;throw Error('Unexpected URL send')}
     };
     if(p.endsWith('agreementDeliverySafety.ts'))return {
       agreementDeliveryStatus,agreementDeliverySafeErrorLabel,agreementDeliveryErrorCode,agreementReceiptPatch
     };
     return {};
   }
 });
 return {
   root,scoped,agreements,outbox,deliveries,alerts,
   get createAttempts(){return createAttempts},get sendFailures(){return sendFailures},
   deliver:(key='agreement-aa123:invitation:1')=>m.exports.deliver(scoped,agreements[0],
     'invitation',key,'Synthetic closing invitation. No real URLs.',null,{},root)
 };
}
test('US/foreign E.164 number is accepted into SAME central Outbox without provider HTTP',async()=>{
 const x=fixture({phone:'+1 (516) 555-1234'});
 assert.equal(normalizeIsraeliPhone('+1 (516) 555-1234'),'15165551234');
 assert.equal(toChatId('+1 (516) 555-1234'),'15165551234@c.us');
 const a=await x.deliver();
 assert.equal(a.state,'queued');
 assert.equal(a.queue_job_id,x.outbox[0].id);
 assert.equal(x.outbox[0].chat_id,'15165551234@c.us');
 assert.equal(x.outbox[0].requested_provider,'green');
 assert.equal(x.createAttempts,1);
 assert.equal(x.sendFailures,0);
 const again=await x.deliver();
 assert.equal(again.id,a.id);
 assert.equal(x.createAttempts,1,'No second job for the same agreement invitation');
});
test('Israeli format also reaches the same central Outbox',async()=>{
 for(const phone of ['0501234567','972501234567','0052501234567']){
   const x=fixture({phone:phone==='0052501234567'?'0050-1234567':phone});
   const row=await x.deliver();
   assert.equal(row.state,'queued');
   assert.equal(x.outbox.length,1);
 }
});
test('provider UNKNOWN is never mislabeled accepted when idempotency finds old Outbox row',async()=>{
 const x=fixture();
 x.outbox.push({id:'outbox-uncertain',idempotency_key:'agreement-aa123:invitation:1',
   status:'unknown',provider_message_id:''});
 const row=await x.deliver();
 assert.equal(row.state,'unknown');
 assert.equal(row.queue_job_id,'outbox-uncertain');
 assert.equal(x.createAttempts,0);
 const again=await x.deliver();
 assert.equal(again.state,'unknown');
 assert.equal(x.createAttempts,0);
 assert.equal(x.alerts.length,1,'One actionable alert; no automatic retry');
});
test('Outbox committed but response lost is recovered by SAME key, not sent twice',async()=>{
 const x=fixture({createMode:'after'});
 const result=await x.deliver();
 assert.equal(result.state,'queued');
 assert.equal(result.queue_job_id,x.outbox[0].id);
 assert.equal(x.createAttempts,1);
 await x.deliver();
 assert.equal(x.createAttempts,1);
});
test('ambiguous database enqueue failure is UNKNOWN without leaking customer content',async()=>{
 const x=fixture({createMode:'before'});
 await assert.rejects(x.deliver(),/אינה ודאית/);
 assert.equal(x.outbox.length,0);
 assert.equal(x.deliveries[0].state,'unknown');
 assert.equal(x.deliveries[0].error_code,'QUEUE_ENQUEUE_UNVERIFIED');
 assert.equal(x.deliveries[0].failure_phase,'unverified');
 assert.equal(x.alerts.length,1);
 const safe=JSON.stringify(x.deliveries[0]);
 assert.ok(!safe.includes('15165551234'));
 assert.ok(!safe.includes('Synthetic closing invitation'));
});
test('provider configuration outage records a safe precise enqueue phase',async()=>{
 const x=fixture();
 x.entities.AppSettings.filter=async()=>{throw Error('synthetic config failure');};
 await assert.rejects(x.deliver(),/אינה ודאית/);
 assert.equal(x.deliveries[0].failure_phase,'provider_config');
 assert.equal(x.deliveries[0].state,'unknown');
 assert.equal(x.outbox.length,0);
 assert.equal(x.createAttempts,0);
});
test('idempotency lookup outage records a safe precise enqueue phase',async()=>{
 const x=fixture({lookupFails:true});
 await assert.rejects(x.deliver(),/אינה ודאית/);
 assert.equal(x.deliveries[0].failure_phase,'dedupe_lookup');
 assert.equal(x.deliveries[0].error_code,'QUEUE_LOOKUP_UNAVAILABLE');
 assert.equal(x.outbox.length,0);
 assert.equal(x.createAttempts,0);
});
test('definite pre-create validation rejects safely with FAILED, not UNKNOWN',async()=>{
 const x=fixture({createMode:'before_definite'});
 await assert.rejects(x.deliver(),/אינו פעיל/);
 assert.equal(x.deliveries[0].state,'failed');
 assert.equal(x.deliveries[0].error_code,'QUEUE_DISABLED');
 assert.equal(x.deliveries[0].failure_phase,'enqueue_not_confirmed');
 assert.equal(x.outbox.length,0);
});
test('if Outbox status cannot be checked, no failed/not-sent claim is permitted',async()=>{
 const x=fixture({createMode:'before',lookupFails:true});
 await assert.rejects(x.deliver(),/אינה ודאית/);
 assert.equal(x.deliveries[0].state,'unknown');
 assert.equal(x.deliveries[0].error_code,'QUEUE_LOOKUP_UNAVAILABLE');
});
test('readonly agreement diagnosis never sends a WhatsApp or leaks customer phone',async()=>{
 const x=fixture();
 x.deliveries.push({id:'delivery-existing',agreement_id:'agreement-aa123',kind:'invitation',
   key:'agreement-aa123:invitation:1',state:'failed',
   attempted_at:'2026-10-19T12:28:54Z',error_code:''});
 const result=await inspectAgreementWhatsApp(x.scoped,x.root,'agreement-aa123');
 assert.equal(result.readOnly,true);
 assert.equal(result.messageSent,false);
 assert.equal(result.recipientFormat.valid,true);
 assert.equal(result.recipientFormat.countryHint,'NANP');
 assert.equal(result.queue.enabled,true);
 assert.equal(result.queue.provider,'green');
 assert.equal(result.queue.credentialsConfigured,true);
 assert.equal(result.attempts.length,1);
 assert.equal(result.attempts[0].errorCode,'HISTORIC_REASON_UNAVAILABLE');
 assert.equal(x.createAttempts,0);
 assert.equal(x.outbox.length,0);
 const output=JSON.stringify(result);
 assert.ok(!output.includes('15165551234'));
 assert.ok(!output.includes('Synthetic closing invitation'));
});
test('read-only diagnosis explains active private token cannot be reconstructed from the stored hash',async()=>{
 const x=fixture({phone:'+1 (516) 555-1234'});
 x.agreements[0].active=true;
 x.agreements[0].link_expires_at=new Date(Date.now()+86400_000).toISOString();
 x.deliveries.push({id:'failed-previous',agreement_id:'agreement-aa123',kind:'invitation',
   state:'failed',key:'agreement-aa123:invitation:1'});
 const report=await inspectAgreementWhatsApp(x.scoped,x.root,'agreement-aa123');
 assert.equal(report.activeLink.issued,true);
 assert.equal(report.activeLink.tokenRecoverable,false);
 assert.ok(report.activeLink.expiresAt);
 assert.equal(report.messageSent,false);
 const safe=JSON.stringify(report);
 assert.ok(!safe.includes('15165551234'));
});
test('classification covers invalid foreign number and queue states without exposing input',()=>{
 for(const [error,code] of [
   [new Error('Invalid WhatsApp phone number: +15551234567'), 'INVALID_PHONE_FORMAT'],
   [new Error('WhatsApp is paused by the administrator'), 'QUEUE_PAUSED'],
   [new Error('Central WhatsApp queue has not been activated'), 'QUEUE_DISABLED'],
   [new Error('WhatsApp outbox enqueue lock unavailable; message not queued'), 'QUEUE_LOCK_BUSY']
 ])assert.equal(agreementDeliveryErrorCode(error),code);
 assert.equal(agreementPhoneFormatEvidence('15165551234').international,true);
 assert.equal(agreementPhoneFormatEvidence('972501234567').international,false);
 assert.equal(agreementPhoneFormatEvidence('123456789012345678').valid,false);
});
test('event closing UI has explicit READ ONLY diagnosis action',()=>{
 const backend=fs.readFileSync('base44/functions/eventAgreement/entry.ts','utf8');
 const ui=fs.readFileSync('src/components/billing/EventClosingPanel.jsx','utf8');
 assert.match(backend,/if\(action==="delivery_health"\)return Response\.json\(await inspectAgreementWhatsApp/);
 assert.match(ui,/agreementAction\("delivery_health"/);
 assert.match(ui,/בדוק WhatsApp ללא שליחה/);
});
