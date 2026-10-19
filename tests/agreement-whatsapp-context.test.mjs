import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';
import {agreementDeliveryErrorCode,agreementDeliverySafeErrorLabel,agreementReceiptPatch} from '../base44/shared/agreementDeliverySafety.ts';

const code=esbuild.transformSync(fs.readFileSync('base44/shared/agreementLifecycle.ts','utf8'),{
  loader:'ts',format:'cjs',target:'es2022'
}).code;

function fixture({sendError=false,receiptWriteFails=false}={}){
  let seq=0,receiptUpdates=0;
  const rows=[],alerts=[],calls=[];
  const scoped={
    entities:{
      ClientMessageDelivery:{
        filter:async({key})=>rows.filter(r=>r.key===key),
        create:async data=>{const row={...data,id:'client-message-'+(++seq)};rows.push(row);return row;},
        update:async(id,patch)=>{
          if(receiptWriteFails&&patch.state==='queued'&&++receiptUpdates===1)throw Error('DB temporarily unavailable');
          const row=rows.find(r=>r.id===id);Object.assign(row,patch);return {...row};
        }
      },
      WhatsAppOutbox:{filter:async()=>[]},
      WhatsAppQueueControl:{filter:async()=>[{enabled:true}]},
      User:{get:async()=>({id:'admin1',role:'admin',email:'admin@localhost'})},
      InAppNotification:{
        filter:async filters=>alerts.filter(x=>x.user_id===filters.user_id&&
          x.related_event_id===filters.related_event_id&&x.template_type===filters.template_type&&
          x.title===filters.title&&x.is_resolved===false),
        create:async data=>{const row={...data,id:'alert-'+(++seq)};alerts.push(row);return row;}
      }
    }
  };
  const module={exports:{}};
  vm.runInNewContext(code,{
    exports:module.exports,module,console:{error:()=>{},warn:()=>{}}, 
    require:path=>{
      if(path.endsWith('agreementDeliverySafety.ts'))return {agreementDeliveryErrorCode,agreementDeliverySafeErrorLabel,agreementReceiptPatch};
      if(path.endsWith('whatsappSend.ts'))return {
        sendWhatsAppText:async(_phone,_msg,client,context)=>{
          assert.equal(client.asServiceRole,scoped,'Backend service-role must be wrapped in root context');
          calls.push({kind:'text',context});if(sendError)throw Error('Simulated pre-provider enqueue failure');
          return {queued:true,jobId:'wa-job-'+calls.length};
        },
        sendWhatsAppFileUri:async(_phone,_uri,_name,_caption,client,context)=>{
          assert.equal(client.asServiceRole,scoped);
          calls.push({kind:'file',context});if(sendError)throw Error('Simulated pre-provider enqueue failure');
          return {queued:true,jobId:'wa-job-'+calls.length};
        },
        sendWhatsAppFileByUrl:async(_phone,_url,_name,_caption,client,context)=>{
          assert.equal(client.asServiceRole,scoped);
          calls.push({kind:'url',context});return {queued:true,jobId:'wa-job-'+calls.length};
        }
      };
      return {};
    }
  });
  const agreement={id:'agreement-1',event_id:'event-1',recipient_phone:'0520000000',
    created_by_user_id:'admin1',link_expires_at:new Date(Date.now()+86400000).toISOString()};
  return {scoped,agreement,rows,alerts,calls,deliver:module.exports.deliver};
}
test('agreement invitation passes the privileged backend shape to WhatsApp and queues exactly once',async()=>{
  const f=fixture();
  const r=await f.deliver(f.scoped,f.agreement,'invitation','agreement-1:invite','message');
  assert.equal(r.state,'queued');
  assert.equal(r.queue_job_id,'wa-job-1');
  assert.equal(f.calls[0].context.clientMessageDeliveryId,r.id);
  const again=await f.deliver(f.scoped,f.agreement,'invitation','agreement-1:invite','message');
  assert.equal(again.id,r.id);
  assert.equal(f.calls.length,1);
  assert.equal(f.alerts.length,0);
});
test('agreement private PDF enqueues with service-role backend context, without expiring signed URLs',async()=>{
  const f=fixture();
  const r=await f.deliver(f.scoped,f.agreement,'signed_copy','agreement-1:signed-copy','signed',
    {uri:'private-file-uri',name:'agreement.pdf'});
  assert.equal(r.state,'queued');
  assert.equal(f.calls[0].kind,'file');
  assert.equal(f.calls[0].context.idempotencyKey,'agreement-1:signed-copy');
  assert.equal(f.alerts.length,0);
});
test('outbox enqueue rejection creates a real failed record and one actionable alert per event',async()=>{
  const f=fixture({sendError:true});
  await assert.rejects(f.deliver(f.scoped,f.agreement,'invitation','agreement-1:invite-a','message'));
  await assert.rejects(f.deliver(f.scoped,f.agreement,'invitation','agreement-1:invite-b','message'));
  assert.equal(f.rows.length,2);
  assert.equal(f.rows[0].state,'failed');
  assert.equal(f.alerts.length,1);
  const count=f.calls.length;
  const prev=await f.deliver(f.scoped,f.agreement,'invitation','agreement-1:invite-a','message');
  assert.equal(prev.state,'failed');
  assert.equal(f.calls.length,count,'Do not auto-retry previous failed messages after a code fix');
});
test('a failed status-record update after successful enqueue never creates a false failure alert',async()=>{
  const f=fixture({receiptWriteFails:true});
  const row=await f.deliver(f.scoped,f.agreement,'verification','agreement-1:otp:1','code');
  assert.equal(row.state,'queued');
  assert.equal(row.queue_job_id,'wa-job-1');
  assert.equal(f.rows[0].state,'dispatching');
  assert.equal(f.alerts.length,0);
});
test('card setup link sends with root backend context, not just service-role object',()=>{
  const code=fs.readFileSync('base44/functions/invoice4uStoredCards/entry.ts','utf8');
  assert.match(code,/sendWhatsAppText\(customer\.phone,[\s\S]{0,240}?,base44,\{sourceType:'card_setup'/);
});
