import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {cardSetupWhatsAppOutcome} from '../base44/shared/cardSetupWhatsAppReceipt.ts';
import {syncWhatsAppStatus,reconcileCardSetupWhatsAppMirrors} from '../base44/shared/whatsappQueueWorker.ts';

test('card setup receipt NEVER treats old deduplicated UNKNOWN or FAILED as accepted',()=>{
 for(const kind of ['unknown','failed','cancelled','expired','resolved']){
  const result=cardSetupWhatsAppOutcome({success:true,queued:false,status:kind,
    jobId:'job-existing',messageId:'',deduplicated:true});
  assert.equal(result.sent,false,kind);
  assert.equal(result.queued,false,kind);
  assert.equal(result.manualReviewRequired,true,kind);
  assert.equal(result.jobId,'job-existing');
  assert.equal(result.deliveryState,kind);
 }
 assert.equal(cardSetupWhatsAppOutcome({success:true,queued:true,status:'unknown'}).sent,false,
   'Stale queued flag can never override a terminal state');
});

test('card setup receipt distinguishes new queued vs accepted by provider',()=>{
 const queued=cardSetupWhatsAppOutcome({success:true,queued:true,status:'queued',jobId:'job-queued'});
 assert.deepEqual(queued,{deliveryState:'queued',linkState:'queued',sent:false,queued:true,
  manualReviewRequired:false,jobId:'job-queued',messageId:''});
 const accepted=cardSetupWhatsAppOutcome({success:true,queued:false,status:'accepted',
   jobId:'job-existing',messageId:'provider-123',deduplicated:true});
 assert.deepEqual(accepted,{deliveryState:'accepted',linkState:'accepted',sent:true,queued:false,
  manualReviewRequired:false,jobId:'job-existing',messageId:'provider-123'});
 const unverified=cardSetupWhatsAppOutcome({success:false,queued:true,status:'queued'});
 assert.equal(unverified.sent,false);
 assert.equal(unverified.manualReviewRequired,true);
});

function fixture({initialStatus='accepted',fails=1}={}){
 const job={id:'job-1',status:initialStatus,card_setup_request_id:'card-setup-1',
  provider_message_id:initialStatus==='accepted'?'provider-123':'',
  card_mirror_sync_pending:false};
 const card={id:'card-setup-1',link_message_state:'queued',link_message_id:'job-1'};
 let unavailable=fails;
 const calls={mirror:0,repair:0,provider:0};
 const client={asServiceRole:{entities:{
  WhatsAppOutbox:{
    filter:async(q,_sort,limit)=>{
      assert.equal(q.card_mirror_sync_pending,true);
      assert.ok(q.status.$in.includes('accepted'));
      return job.card_mirror_sync_pending&&q.status.$in.includes(job.status)?[{...job}].slice(0,limit):[];
    },
    updateMany:async(q,p)=>{
      calls.repair++;
      if(q.id!==job.id||q.status && q.status!==job.status ||
        q.card_mirror_sync_pending!==undefined&&q.card_mirror_sync_pending!==job.card_mirror_sync_pending)
        return {updated:0};
      Object.assign(job,p.$set);return {updated:1};
    }
  },
  CardSetupRequest:{
    update:async(id,patch)=>{
      calls.mirror++;
      assert.equal(id,card.id);
      if(unavailable-->0)throw Error('Synthetic card source unavailable');
      Object.assign(card,patch);
      return {...card};
    }
  }
 }}};
 return {client,job,card,calls};
}

test('accepted Green receipt survives card DB failure and is repaired without a second WhatsApp',async()=>{
 const x=fixture();
 await syncWhatsAppStatus(x.client,{...x.job},'accepted','provider-123');
 assert.equal(x.job.status,'accepted');
 assert.equal(x.job.card_mirror_sync_pending,true);
 assert.equal(x.card.link_message_state,'queued');
 const recovered=await reconcileCardSetupWhatsAppMirrors(x.client);
 assert.deepEqual(recovered,{examined:1,repaired:1,failed:0});
 assert.equal(x.job.status,'accepted');
 assert.equal(x.card.link_message_state,'accepted');
 assert.equal(x.card.link_message_id,'provider-123');
 assert.equal(x.job.card_mirror_sync_pending,false);
 assert.equal(x.calls.provider,0);
 assert.equal((await reconcileCardSetupWhatsAppMirrors(x.client)).examined,0);
});

test('provider UNKNOWN stays UNKNOWN after card-state recovery, never becomes accepted',async()=>{
 const x=fixture({initialStatus:'unknown'});
 await syncWhatsAppStatus(x.client,{...x.job},'unknown','');
 assert.equal(x.job.card_mirror_sync_pending,true);
 await reconcileCardSetupWhatsAppMirrors(x.client);
 assert.equal(x.job.status,'unknown');
 assert.equal(x.card.link_message_state,'unknown');
 assert.equal(x.card.link_message_id,'job-1','Original job linkage remains available for review');
 assert.equal(x.calls.provider,0);
});

test('still unavailable card DB leaves repair flag set for next watchdog without retrying WhatsApp',async()=>{
 const x=fixture({fails:6});
 await syncWhatsAppStatus(x.client,{...x.job},'accepted','provider-123');
 const next=await reconcileCardSetupWhatsAppMirrors(x.client);
 assert.equal(next.examined,1);
 assert.equal(next.repaired,0);
 assert.equal(next.failed,1);
 assert.equal(x.job.card_mirror_sync_pending,true);
 assert.equal(x.calls.provider,0);
});

test('card mirror watchdog is bounded and only operates on terminal Outbox jobs',async()=>{
 const x=fixture({initialStatus:'queued',fails:0});
 x.job.card_mirror_sync_pending=true;
 const result=await reconcileCardSetupWhatsAppMirrors(x.client,1000);
 assert.deepEqual(result,{examined:0,repaired:0,failed:0});
 assert.equal(x.card.link_message_state,'queued');
 assert.equal(x.calls.provider,0);
 const worker=fs.readFileSync('base44/functions/processWhatsAppOutbox/entry.ts','utf8');
 assert.match(worker,/reconcileCardSetupWhatsAppMirrors\(client,10\)/);
});

test('card setup producer guards source state by CAS and separates send from mirror persistence',()=>{
 const source=fs.readFileSync('base44/functions/invoice4uStoredCards/entry.ts','utf8');
 const ui=fs.readFileSync('src/components/billing/StoredCards.jsx','utf8');
 assert.match(source,/cardSetupWhatsAppOutcome\(receipt\)/);
 assert.match(source,/link_message_state:"dispatching"\s*\}\s*,\{\$set:/);
 assert.doesNotMatch(source,/sent\.queued\?"queued":"accepted"/);
 assert.doesNotMatch(source,/לא בוצעה שליחה\./);
 assert.match(ui,/מסירה ללקוח טרם אומתה/);
 assert.match(ui,/ממתין בתור WhatsApp/);
});

test('payment request producer separates queued, accepted and unknown results',()=>{
 const source=fs.readFileSync('base44/functions/invoice4uCreateClearingRequest/entry.ts','utf8');
 assert.match(source,/whatsappEnqueueReceiptState\(receipt\)/);
 assert.match(source,/isWhatsAppEnqueueConfirmed\(receipt\)/);
 assert.match(source,/manualReviewVia\.push\('whatsapp'\)/);
 assert.match(source,/manual_review_required:manualReviewVia\.length>0/);
 assert.doesNotMatch(source,/if\(receipt\.queued\)queuedVia\.push\('whatsapp'\)/);
});
