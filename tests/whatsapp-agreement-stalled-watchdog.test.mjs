import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {reconcileStalledAgreementEnqueues} from '../base44/shared/agreementQueueReconciler.ts';

const now=Date.parse('2026-10-20T08:00:00Z');
function fixture({job=null,minutesOld=8,updateRace=false,lookupError=false,kind='invitation'}={}){
  const delivery={id:'delivery-1',key:'agreement-1:invitation:2',
    agreement_id:'agreement-1',event_id:'event-1',kind,state:'dispatching',
    attempted_at:new Date(now-minutesOld*60_000).toISOString()};
  const jobs=job?[{...job,id:'job-1',idempotency_key:delivery.key,
    client_message_delivery_id:'delivery-1'}]:[];
  const alerts=[],outboxWrites=[],deliveryWrites=[];
  const matches=(row,q)=>Object.entries(q).every(([k,v])=>{
    if(k==='attempted_at')return row.attempted_at<=v.$lte;
    return row[k]===v;
  });
  const db={
    ClientMessageDelivery:{
      filter:async q=>matches(delivery,q)?[{...delivery}]:[],
      updateMany:async(q,p)=>{
        deliveryWrites.push({q,p});
        if(updateRace){delivery.state='accepted';return {updated:0};}
        if(!matches(delivery,q))return {updated:0};
        Object.assign(delivery,p.$set);return {updated:1};
      }
    },
    WhatsAppOutbox:{
      filter:async q=>{
        if(lookupError)throw Error('Synthetic Outbox lookup outage');
        return jobs.filter(j=>j.idempotency_key===q.idempotency_key);
      },
      updateMany:async(q,p)=>{outboxWrites.push({q,p});const j=jobs.find(x=>x.id===q.id&&x.status===q.status);
        if(!j)return {updated:0};Object.assign(j,p.$set);return {updated:1};}
    },
    EventAgreement:{get:async()=>({id:'agreement-1',created_by_user_id:'admin-1'})},
    User:{get:async()=>({id:'admin-1',email:'qa@example.test',role:'admin'})},
    InAppNotification:{
      filter:async()=>alerts.filter(a=>!a.is_resolved),
      create:async x=>{alerts.push(x);return {...x,id:'alert-'+alerts.length}}
    }
  };
  return {client:{asServiceRole:{entities:db}},delivery,jobs,alerts,outboxWrites,deliveryWrites};
}
test('stale invitation without Outbox is not replayed, becomes UNKNOWN and raises one owner alert',async()=>{
 const x=fixture();
 const result=await reconcileStalledAgreementEnqueues(x.client,8,now);
 assert.deepEqual(result,{examined:1,linked:0,unverified:1,alerts:1,errors:0});
 assert.equal(x.delivery.state,'unknown');
 assert.equal(x.delivery.error_code,'QUEUE_ENQUEUE_UNVERIFIED');
 assert.equal(x.alerts.length,1);
 assert.equal(x.jobs.length,0);
 const second=await reconcileStalledAgreementEnqueues(x.client,8,now);
 assert.equal(second.examined,0);
 assert.equal(x.alerts.length,1);
 assert.equal(JSON.stringify(x.alerts).includes('token='),false);
});
test('crash after Outbox creation but before journal mirror recovers original accepted receipt',async()=>{
 const x=fixture({job:{status:'accepted',provider_message_id:'green-accepted-123'}});
 const result=await reconcileStalledAgreementEnqueues(x.client,8,now);
 assert.equal(result.linked,1);
 assert.equal(x.delivery.state,'accepted');
 assert.equal(x.delivery.queue_job_id,'job-1');
 assert.equal(x.delivery.provider_message_id,'green-accepted-123');
 assert.equal(x.alerts.length,0);
 assert.equal(x.jobs.length,1);
});
test('queued Outbox is linked without falsely claiming delivery or contacting provider',async()=>{
 const x=fixture({job:{status:'retry_wait',provider_message_id:''}});
 await reconcileStalledAgreementEnqueues(x.client,8,now);
 assert.equal(x.delivery.state,'queued');
 assert.equal(x.delivery.queue_job_id,'job-1');
 assert.equal(x.delivery.sent_at,undefined);
 assert.equal(x.alerts.length,0);
});
test('persisted UNKNOWN receipt is not retried and gets a manager action alert',async()=>{
 const x=fixture({job:{status:'unknown',provider_message_id:''}});
 await reconcileStalledAgreementEnqueues(x.client,8,now);
 assert.equal(x.delivery.state,'unknown');
 assert.equal(x.delivery.queue_job_id,'job-1');
 assert.equal(x.jobs[0].status,'unknown');
 assert.equal(x.alerts.length,1);
});
test('fresh concurrent issue is ignored and a source updated by worker cannot be overwritten',async()=>{
 const fresh=fixture({minutesOld:1});
 assert.equal((await reconcileStalledAgreementEnqueues(fresh.client,8,now)).examined,0);
 const race=fixture({job:{status:'queued'},updateRace:true});
 await reconcileStalledAgreementEnqueues(race.client,8,now);
 assert.equal(race.delivery.state,'accepted');
 assert.equal(race.alerts.length,0);
});
test('temporary Outbox lookup error does not mark failed or fabricate no-send proof',async()=>{
 const x=fixture({lookupError:true});
 const result=await reconcileStalledAgreementEnqueues(x.client,8,now);
 assert.equal(result.errors,1);
 assert.equal(x.delivery.state,'dispatching');
 assert.equal(x.alerts.length,0);
});
test('recovered signed PDF copy marks a mirror-only repair without creating a new Outbox',async()=>{
 const x=fixture({job:{status:'accepted',provider_message_id:'green-copy'},kind:'signed_copy'});
 await reconcileStalledAgreementEnqueues(x.client,8,now);
 assert.equal(x.delivery.state,'accepted');
 assert.equal(x.outboxWrites.length,1);
 assert.equal(x.jobs[0].delivery_mirror_sync_pending,true);
});
test('fallback alert on invitation enqueue exception also covers failure before journal record exists',()=>{
 const endpoint=fs.readFileSync('base44/functions/eventAgreement/entry.ts','utf8');
 assert.match(endpoint,/await notifyAgreementAdmin\(client,a,"נדרשת בדיקת תור הודעות לקוח"/);
 assert.match(endpoint,/invitationFailureView\(client\.entities/);
});
