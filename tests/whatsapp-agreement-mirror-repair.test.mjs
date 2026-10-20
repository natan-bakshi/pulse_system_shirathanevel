import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {syncWhatsAppStatus,reconcileAgreementWhatsAppMirrors} from '../base44/shared/whatsappQueueWorker.ts';

function fixture({status='accepted',failDelivery=1,failCopy=0,kind='invitation'}={}){
 const job={id:'job-1',status,provider_message_id:status==='accepted'?'provider-1':'',
  client_message_delivery_id:'delivery-1',delivery_mirror_sync_pending:false};
 const delivery={id:'delivery-1',kind,agreement_id:'agreement-1',state:'queued'};
 const state={copy_state:'queued'},writes=[],sends=[];
 let deliveryFailures=failDelivery,copyFailures=failCopy;
 const outbox={
  filter:async(q,_sort,limit)=>{
   assert.equal(q.delivery_mirror_sync_pending,true);
   assert.deepEqual(q.status.$in,['accepted','unknown','failed','cancelled','expired','resolved']);
   return job.delivery_mirror_sync_pending&&q.status.$in.includes(job.status)?[{...job}].slice(0,limit):[];
  },
  updateMany:async(q,p)=>{
   writes.push({q,p});
   if(q.id!==job.id||q.status&&q.status!==job.status ||
     q.delivery_mirror_sync_pending!==undefined&&q.delivery_mirror_sync_pending!==job.delivery_mirror_sync_pending)return {updated:0};
   Object.assign(job,p.$set);return {updated:1};
  }
 };
 const client={asServiceRole:{entities:{
  WhatsAppOutbox:outbox,
  ClientMessageDelivery:{
   update:async(id,p)=>{assert.equal(id,delivery.id);if(deliveryFailures-- >0)throw Error('Synthetic source DB issue');Object.assign(delivery,p);return {...delivery};},
   get:async()=>({...delivery})
  },
  EventAgreement:{updateMany:async(q,p)=>{assert.equal(q.id,'agreement-1');
    if(copyFailures-->0)throw Error('Synthetic agreement DB issue');
    Object.assign(state,p.$set);return {updated:1};}}
 }}};
 return {client,job,delivery,state,writes,sends};
}
test('accepted provider receipt survives failed ClientMessageDelivery write and is repaired without WhatsApp resend',async()=>{
 const x=fixture();
 await syncWhatsAppStatus(x.client,{...x.job},'accepted','provider-1');
 assert.equal(x.job.status,'accepted');
 assert.equal(x.job.delivery_mirror_sync_pending,true);
 assert.equal(x.delivery.state,'queued');
 const r=await reconcileAgreementWhatsAppMirrors(x.client);
 assert.deepEqual(r,{examined:1,repaired:1,failed:0});
 assert.equal(x.delivery.state,'accepted');
 assert.equal(x.delivery.provider_message_id,'provider-1');
 assert.equal(x.job.delivery_mirror_sync_pending,false);
 assert.equal((await reconcileAgreementWhatsAppMirrors(x.client)).examined,0);
 assert.equal(x.sends.length,0);
});
test('provider UNKNOWN stays UNKNOWN when repaired; no replay or fake acceptance',async()=>{
 const x=fixture({status:'unknown'});
 await syncWhatsAppStatus(x.client,{...x.job},'unknown','');
 assert.equal(x.job.delivery_mirror_sync_pending,true);
 await reconcileAgreementWhatsAppMirrors(x.client);
 assert.equal(x.job.status,'unknown');
 assert.equal(x.delivery.state,'unknown');
 assert.equal(x.delivery.provider_message_id,'');
 assert.equal(x.sends.length,0);
});
test('failed agreement-PDF copy mirror gets retried without regenerating a PDF or re-sending',async()=>{
 const x=fixture({failDelivery:0,failCopy:1,kind:'signed_copy'});
 await syncWhatsAppStatus(x.client,{...x.job},'accepted','provider-1');
 assert.equal(x.delivery.state,'accepted','Source accepted before copy-state failure');
 assert.equal(x.job.delivery_mirror_sync_pending,true);
 await reconcileAgreementWhatsAppMirrors(x.client);
 assert.equal(x.state.copy_state,'accepted');
 assert.equal(x.job.delivery_mirror_sync_pending,false);
 assert.equal(x.sends.length,0);
});
test('if source database remains unavailable watchdog leaves marker for later',async()=>{
 const x=fixture({status:'failed',failDelivery:3});
 await syncWhatsAppStatus(x.client,{...x.job},'failed','');
 const r=await reconcileAgreementWhatsAppMirrors(x.client);
 assert.deepEqual(r,{examined:1,repaired:0,failed:1});
 assert.equal(x.job.status,'failed');
 assert.equal(x.job.delivery_mirror_sync_pending,true);
});
test('recovery uses existing scheduled watchdog even while dispatch is paused',()=>{
 const worker=fs.readFileSync('base44/functions/processWhatsAppOutbox/entry.ts','utf8');
 assert.match(worker,/reconcileAgreementWhatsAppMirrors\(client,10\)/);
 assert.ok(worker.indexOf('reconcileAgreementWhatsAppMirrors(client,10)')<
   worker.indexOf("if(!controlRows[0].enabled || controlRows[0].paused)"),
   'Mirrors should be repaired during a paused queue, with no provider activity');
});
