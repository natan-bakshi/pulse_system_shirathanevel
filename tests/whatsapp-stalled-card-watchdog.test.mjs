import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {reconcileStalledCardSetupEnqueues} from '../base44/shared/cardSetupQueueReconciler.ts';

const now=Date.parse('2026-10-20T09:00:00Z');
function fixture({status='',minutesOld=8,sourceRace=false,lookupFailure=false,createdByAdmin=true}={}){
 const row={id:'setup-01',event_id:'event-01',created_by_user_id:'admin-01',
  state:'pending',link_message_state:'dispatching',
  link_send_started_at:new Date(now-minutesOld*60_000).toISOString()};
 const jobs=status?[{id:'outbox-01',status,idempotency_key:'card-setup:'+row.id,
   provider_message_id:status==='accepted'?'provider-verified':''}]:[];
 const alerts=[];let providerCalls=0,outboxQueries=0,sourceWrites=0;
 const db={
  CardSetupRequest:{
   filter:async q=>{
    if(row.state!==q.state||row.link_message_state!==q.link_message_state||
      row.link_send_started_at>q.link_send_started_at.$lte)return [];
    return [{...row}];
   },
   updateMany:async(q,p)=>{
    sourceWrites++;
    if(sourceRace){row.link_message_state='accepted';return {updated:0};}
    if(row.id!==q.id||row.link_message_state!==q.link_message_state||
      row.state!==q.state||row.link_send_started_at!==q.link_send_started_at)return {updated:0};
    Object.assign(row,p.$set);return {updated:1};
   }
  },
  WhatsAppOutbox:{
   filter:async q=>{
    outboxQueries++;
    if(lookupFailure)throw Error('Synthetic database query outage');
    return jobs.filter(j=>j.idempotency_key===q.idempotency_key);
   }
  },
  User:{get:async()=>({id:'admin-01',role:createdByAdmin?'admin':'supplier',email:'qa@example.test'})},
  InAppNotification:{
   filter:async q=>alerts.filter(a=>a.title===q.title&&!a.is_resolved),
   create:async p=>{alerts.push(p);return {...p,id:'notice-'+alerts.length}}
  }
 };
 return {client:{asServiceRole:{entities:db}},row,jobs,alerts,
  get providerCalls(){return providerCalls},
  get outboxQueries(){return outboxQueries},
  get sourceWrites(){return sourceWrites}
 };
}

test('stale card link with no Outbox becomes UNKNOWN and alerts owner once without resending',async()=>{
 const x=fixture();
 const r=await reconcileStalledCardSetupEnqueues(x.client,8,now);
 assert.deepEqual(r,{examined:1,linked:0,unverified:1,alerts:1,errors:0});
 assert.equal(x.row.link_message_state,'unknown');
 assert.equal(x.alerts.length,1);
 assert.equal(x.jobs.length,0);
 assert.equal(x.providerCalls,0);
 assert.equal((await reconcileStalledCardSetupEnqueues(x.client,8,now)).examined,0);
 assert.equal(x.alerts.length,1);
 assert.equal(JSON.stringify(x.alerts).includes('pay.'),false);
});
test('stalled card source is linked to existing queued job without sending another message',async()=>{
 const x=fixture({status:'queued'});
 const r=await reconcileStalledCardSetupEnqueues(x.client,8,now);
 assert.equal(r.linked,1);
 assert.equal(x.row.link_message_state,'queued');
 assert.equal(x.row.link_message_id,'outbox-01');
 assert.equal(x.alerts.length,0);
 assert.equal(x.providerCalls,0);
});
test('provider accepted before source mirror commit is linked to original accepted receipt',async()=>{
 const x=fixture({status:'accepted'});
 await reconcileStalledCardSetupEnqueues(x.client,8,now);
 assert.equal(x.row.link_message_state,'accepted');
 assert.equal(x.row.link_message_id,'provider-verified');
 assert.equal(x.jobs.length,1);
 assert.equal(x.alerts.length,0);
});
test('provider UNKNOWN or definite failure remains visible and never counts as sent',async()=>{
 for(const [provider,expected]of [['unknown','unknown'],['failed','rejected'],
   ['expired','cancelled'],['resolved','cancelled']]){
  const x=fixture({status:provider});
  const r=await reconcileStalledCardSetupEnqueues(x.client,8,now);
  assert.equal(r.linked,1);
  assert.equal(x.row.link_message_state,expected);
  assert.equal(x.jobs.length,1);
  assert.equal(x.providerCalls,0);
  if(['unknown','failed'].includes(provider))assert.equal(x.alerts.length,1);
 }
});
test('recent in-flight request is NEVER considered abandoned',async()=>{
 const x=fixture({minutesOld:1});
 const r=await reconcileStalledCardSetupEnqueues(x.client,8,now);
 assert.equal(r.examined,0);
 assert.equal(x.row.link_message_state,'dispatching');
 assert.equal(x.outboxQueries,0);
 assert.equal(x.providerCalls,0);
});
test('source CAS refuses to overwrite a concurrently accepted provider result',async()=>{
 const x=fixture({status:'unknown',sourceRace:true});
 await reconcileStalledCardSetupEnqueues(x.client,8,now);
 assert.equal(x.row.link_message_state,'accepted');
 assert.equal(x.alerts.length,0);
});
test('Outbox query unavailable keeps source in dispatching instead of declaring definite failure',async()=>{
 const x=fixture({lookupFailure:true});
 const r=await reconcileStalledCardSetupEnqueues(x.client,8,now);
 assert.equal(r.errors,1);
 assert.equal(x.row.link_message_state,'dispatching');
 assert.equal(x.alerts.length,0);
});
test('non-admin source owner receives no invented in-app admin alert',async()=>{
 const x=fixture({createdByAdmin:false});
 await reconcileStalledCardSetupEnqueues(x.client,8,now);
 assert.equal(x.row.link_message_state,'unknown');
 assert.equal(x.alerts.length,0);
});
test('producer writes an explicit attempt time and watchdog only uses existing schedule',()=>{
 const producer=fs.readFileSync('base44/functions/invoice4uStoredCards/entry.ts','utf8');
 const worker=fs.readFileSync('base44/functions/processWhatsAppOutbox/entry.ts','utf8');
 assert.match(producer,/link_send_started_at:new Date\(\)\.toISOString\(\)/);
 assert.match(worker,/reconcileStalledCardSetupEnqueues\(client,8\)/);
 const entity=JSON.parse(fs.readFileSync('base44/entities/CardSetupRequest.jsonc','utf8'));
 assert.equal(entity.properties.link_send_started_at.type,'string');
});
