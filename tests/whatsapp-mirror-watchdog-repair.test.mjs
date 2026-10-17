import test from 'node:test';
import assert from 'node:assert/strict';
import {syncWhatsAppStatus,reconcileAcceptedWhatsAppMirrors} from '../base44/shared/whatsappQueueWorker.ts';

function fixture({inAppFailCount=1,status='accepted'}={}){
 const job={id:'outbox-test',status,in_app_notification_id:'inapp-test',
  provider_message_id:'green-id-1',mirror_sync_pending:false};
 const writes=[],mirrors=[],providerCalls=[];
 let failRemaining=inAppFailCount;
 const client={asServiceRole:{entities:{
  WhatsAppOutbox:{
   filter:async(query,_sort,limit)=>{
     assert.equal(query.status,'accepted');
     assert.equal(query.mirror_sync_pending,true);
     return job.status==='accepted'&&job.mirror_sync_pending?[{...job}].slice(0,limit):[];
   },
   updateMany:async(query,patch)=>{
     writes.push({query,patch});
     if(query.id!==job.id || (query.status && query.status!==job.status) ||
        (query.mirror_sync_pending!==undefined&&query.mirror_sync_pending!==job.mirror_sync_pending)){
        return {updated:0};
     }
     Object.assign(job,patch.$set);return {updated:1};
   }
  },
  InAppNotification:{update:async(id,patch)=>{
    mirrors.push({id,patch});
    if(failRemaining>0){failRemaining--;throw Error('Synthetic InApp DB outage');}
    return {id,...patch};
  }}
 }}};
 return {client,job,writes,mirrors,providerCalls};
}
test('accepted WhatsApp with a failed InApp update gets a durable mirror-only retry flag',async()=>{
 const x=fixture();
 await syncWhatsAppStatus(x.client,{...x.job},'accepted','green-id-1');
 assert.equal(x.job.status,'accepted','Never demote provider acceptance because of a mirror write');
 assert.equal(x.job.mirror_sync_pending,true);
 assert.equal(x.writes.length,1);
 assert.equal(x.mirrors.length,1);
});
test('existing watchdog fixes accepted InApp mirror without contacting WhatsApp again',async()=>{
 const x=fixture();
 await syncWhatsAppStatus(x.client,{...x.job},'accepted','green-id-1');
 const r=await reconcileAcceptedWhatsAppMirrors(x.client,10);
 assert.equal(r.examined,1);
 assert.equal(r.repaired,1);
 assert.equal(r.failed,0);
 assert.equal(x.job.mirror_sync_pending,false);
 assert.equal(x.mirrors.length,2);
 assert.equal(x.mirrors[1].id,'inapp-test');
 assert.deepEqual(x.mirrors[1].patch,{whatsapp_sent:true,whatsapp_message_id:'green-id-1'});
 assert.equal(x.providerCalls.length,0);
 const again=await reconcileAcceptedWhatsAppMirrors(x.client,10);
 assert.equal(again.examined,0);
});
test('a still-unavailable InApp target remains pending for the NEXT watchdog, no retry of provider',async()=>{
 const x=fixture({inAppFailCount:3});
 await syncWhatsAppStatus(x.client,{...x.job},'accepted','green-id-1');
 const r=await reconcileAcceptedWhatsAppMirrors(x.client,10);
 assert.equal(r.repaired,0);
 assert.equal(r.failed,1);
 assert.equal(x.job.mirror_sync_pending,true);
 assert.equal(x.providerCalls.length,0);
});
test('watchdog never replays an UNKNOWN message even if its mirror flag is stale',async()=>{
 const x=fixture({inAppFailCount:0,status:'unknown'});
 x.job.mirror_sync_pending=true;
 const r=await reconcileAcceptedWhatsAppMirrors(x.client,10);
 assert.equal(r.examined,0);
 assert.equal(r.repaired,0);
 assert.equal(x.mirrors.length,0);
 assert.equal(x.writes.length,0);
});
test('repair only runs on filtered accepted jobs and imposes max batch of ten',async()=>{
 const x=fixture({inAppFailCount:0});
 x.job.mirror_sync_pending=true;
 await reconcileAcceptedWhatsAppMirrors(x.client,500);
 assert.equal(x.job.mirror_sync_pending,false);
 assert.equal(x.providerCalls.length,0);
});
