import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {attachOutboxInAppReceipt} from '../base44/shared/whatsappOutbox.ts';

function setup(status='queued',linked='',{
    claimRace=false,providerMessageId='provider-confirmation'
  }={}){
  const row={id:'outbox-1',status,in_app_notification_id:linked,
    provider_message_id:providerMessageId};
  const mirrors=[],queries=[];let reads=0,casCalls=0;
  const client={asServiceRole:{entities:{
    WhatsAppOutbox:{
      get:async()=>{reads++;return {...row}},
      updateMany:async(query,patch)=>{
        casCalls++;queries.push(query);
        if(claimRace){row.in_app_notification_id='inapp-other';return {updated:0};}
        if(row.id===query.id && row.in_app_notification_id===query.in_app_notification_id){
          Object.assign(row,patch.$set);return {updated:1};
        }
        return {updated:0};
      }
    },
    InAppNotification:{
      update:async(id,patch)=>{mirrors.push({id,patch});return {id,...patch};}
    }
  }}};
  return {client,row,mirrors,queries,
    get reads(){return reads},get casCalls(){return casCalls}
  };
}
test('queued Outbox links to new InApp without falsely claiming API acceptance',async()=>{
 const x=setup('queued');
 const result=await attachOutboxInAppReceipt(x.client,{success:true,queued:true,status:'queued',jobId:'outbox-1'},'inapp-first');
 assert.equal(result.linked,true);
 assert.equal(result.providerAccepted,false);
 assert.equal(x.row.in_app_notification_id,'inapp-first');
 assert.equal(x.mirrors.length,0);
 assert.equal(x.casCalls,1);
});
test('deduplicated ACCEPTED with queued=false links and repairs only the provider-accepted mirror',async()=>{
 const x=setup('accepted');
 const res=await attachOutboxInAppReceipt(x.client,{
  success:true,queued:false,status:'accepted',jobId:'outbox-1',deduplicated:true
 },'inapp-first');
 assert.equal(res.linked,true);
 assert.equal(res.providerAccepted,true);
 assert.equal(x.row.in_app_notification_id,'inapp-first');
 assert.deepEqual(x.mirrors,[{
   id:'inapp-first',patch:{whatsapp_sent:true,whatsapp_message_id:'provider-confirmation'}
 }]);
});
test('UNKNOWN/FAILED never link to InApp or imply delivery',async()=>{
 for(const status of ['unknown','failed','cancelled','resolved','expired']){
  const x=setup(status);
  const r=await attachOutboxInAppReceipt(x.client,{
   success:true,queued:false,status,jobId:'outbox-1'
  },'inapp-new');
  assert.equal(r.linked,false,status);
  assert.equal(x.reads,0);
  assert.equal(x.casCalls,0);
  assert.deepEqual(x.mirrors,[]);
 }
});
test('deduplicated job already linked to an older InApp cannot have its mirror stolen',async()=>{
 const x=setup('accepted','inapp-original');
 const r=await attachOutboxInAppReceipt(x.client,{
  success:true,queued:false,status:'accepted',jobId:'outbox-1'
 },'inapp-later');
 assert.equal(r.linked,false);
 assert.equal(r.reason,'outbox_already_linked');
 assert.equal(x.casCalls,0);
 assert.equal(x.row.in_app_notification_id,'inapp-original');
 assert.deepEqual(x.mirrors,[]);
});
test('concurrent competing InApp CAS claim never overwrites an existing link',async()=>{
 const x=setup('accepted','',{claimRace:true});
 const r=await attachOutboxInAppReceipt(x.client,{
  success:true,queued:true,status:'queued',jobId:'outbox-1'
 },'inapp-later');
 assert.equal(r.linked,false);
 assert.equal(r.reason,'outbox_link_race');
 assert.equal(x.row.in_app_notification_id,'inapp-other');
 assert.deepEqual(x.mirrors,[]);
});
test('delayed InApp producers call attach helper even for deduplicated accepted receipts',()=>{
 for(const p of ['sendEventReminders','checkAutomatedTriggers']){
   const src=fs.readFileSync('base44/functions/'+p+'/entry.ts','utf8');
   assert.match(src,/if\(whatsAppResult\?\.jobId\) await attachOutboxInAppReceipt/);
   assert.doesNotMatch(src,/if\(whatsAppResult\?\.queued\) await attachOutboxInAppReceipt/);
 }
});
