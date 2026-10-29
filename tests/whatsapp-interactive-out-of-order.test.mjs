import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createFutureInteractiveButtonSnapshot} from '../base44/shared/whatsappButtonBindings.ts';
import {processFutureGreenButtonCallback} from '../base44/shared/greenInteractiveCallbackCoordinator.ts';
import {stageFutureGreenInteractiveHttpCallback} from '../base44/shared/greenInteractiveHttpStaging.ts';

const instance='9903183013';
const secret='test-only-order-agnostic-button-signing-secret-012345';
const webhookSecret='test-only-provider-webhook-secret-abcdefgh123456';
const now=Date.parse('2026-10-26T12:00:00Z');
const chat='972501234567@c.us';
const supplierId='supplier-xyz';
const exactMatch=(row,query)=>Object.entries(query||{}).every(
 ([key,value])=>(row[key]??null)===(value??null));
async function fixture(){
 const counters={outboxReads:0,supplierWrites:0,receiptCreates:0,recalcs:[]};
 const rows={},services={},receipts=[];
 for(let k=1;k<=3;k++){
  const id='service-'+k,revision='r'+k;
  const row={id:'outbox-'+k,source_type:'assignment_new',
   requested_provider:'green',provider:'green',status:'queued',
   message_type:'text',message_text:'שיבוץ '+k,
   sender_account_id:instance,assignment_revision:revision,
   event_service_id:id,supplier_id:supplierId,chat_id:chat,
   provider_message_id:'3EB0ORIGINAL'+k+'98765XYZ'};
  row.interactive_button_bindings_json=await createFutureInteractiveButtonSnapshot({
   job:row,signingSecret:secret,issuedAt:now,
   policy:{enabled:true,quoteAssignment:false,buttons:[
    {action:'assignment_approve',label:'מאשר'},
    {action:'assignment_reject',label:'דוחה'}]}
  },webcrypto.subtle);
  row.status='accepted';
  rows[id]=row;
  services[id]={
   id,event_id:'event-'+k,is_external:false,
   supplier_ids:JSON.stringify([supplierId]),supplier_statuses:JSON.stringify({[supplierId]:'pending'}),
   declined_suppliers:'[]',assignment_intent_mode:'durable_v1',
   assignment_notification_intents:JSON.stringify([{
    supplier_id:supplierId,revision:k,state:'accepted',
    key:'assignment:'+id+':'+supplierId+':r'+k+':SUPPLIER_NEW_ASSIGNMENT'
   }])
  };
 }
 const control={id:'control-queue',control_key:'global',inbound_guard_key:'',
  inbound_create_owner:'',inbound_create_until:'',enabled:true,paused:false,
  lease_owner:'',enqueue_owner:''};
 const supplier={id:supplierId,phone:'0501234567',is_active:true};
 const db={
  WhatsAppOutbox:{
   filter:async(query)=>{
    counters.outboxReads++;
    return Object.values(rows).filter(row=>exactMatch(row,query)).map(row=>structuredClone(row));
   },
   get:async(id)=>{
    counters.outboxReads++;
    return Object.values(rows).find(r=>r.id===id)||null;
   }
  },
  Supplier:{get:async(id)=>id===supplierId?supplier:null},
  EventService:{
   get:async(id)=>services[id]||null,
   updateMany:async(query,patch)=>{
    const matching=Object.values(services).filter(row=>exactMatch(row,query));
    for(const row of matching)Object.assign(row,patch.$set);
    counters.supplierWrites+=matching.length;
    return {updated:matching.length};
   }
  },
  WhatsAppQueueControl:{
   filter:async(q)=>exactMatch(control,q)?[control]:[],
   updateMany:async(q,patch)=>{
    if(!exactMatch(control,q))return {updated:0};
    Object.assign(control,patch.$set);return {updated:1};
   }
  },
  WhatsAppInboundReceipt:{
   filter:async(q)=>receipts.filter(row=>exactMatch(row,q)),
   get:async(id)=>receipts.find(row=>row.id===id)||null,
   create:async(fields)=>{
    const row={...fields,id:'receipt-'+(receipts.length+1)};
    receipts.push(row);counters.receiptCreates++;
    return {...row};
   },
   updateMany:async(q,patch)=>{
    const matching=receipts.filter(row=>exactMatch(row,q));
    for(const row of matching)Object.assign(row,patch.$set);
    return {updated:matching.length};
   }
  }
 };
 const client={asServiceRole:{entities:db}};
 function callback(serviceNo,which,eventNo){
  const row=rows['service-'+serviceNo];
  const saved=JSON.parse(row.interactive_button_bindings_json);
  const chosen=saved.buttons.find(b=>b.action===which);
  const body={typeWebhook:'incomingMessageReceived',
   idMessage:'CALLBACK'+eventNo+'123456789ABCDEF',
   instanceData:{idInstance:Number(instance),typeInstance:'whatsapp'},
   timestamp:Math.floor(now/1000),
   senderData:{chatId:chat,sender:chat},
   messageData:{typeMessage:'templateButtonsReplyMessage',
    templateButtonReplyMessage:{stanzaId:row.provider_message_id,
     selectedId:chosen.buttonId,selectedDisplayText:'Text is not authority'}}
  };
  return body;
 }
 function run(raw){
  return processFutureGreenButtonCallback({
   client,headers:{Authorization:'Bearer '+webhookSecret},
   rawCallback:raw,callbackByteLength:JSON.stringify(raw).length,
   expectedInstanceId:instance,webhookSecret,actionSigningSecret:secret,
   trustedRolloutEnabled:true,accountCapabilityVerified:true,
   claimOwner:'test-click-order-worker-xyz',
   recalculateEventStatus:async(id)=>{counters.recalcs.push(id);},
   now,subtle:webcrypto.subtle
  });
 }
 return {client,rows,services,receipts,counters,callback,run};
}
test('three assignments in SAME CHAT resolve by exact original id even when B,C,A pressed out of order',async()=>{
 const f=await fixture();
 const actions=[
  [2,'assignment_reject','B'],[3,'assignment_approve','C'],
  [1,'assignment_approve','A']
 ];
 const results=[];
 for(const [no,action,event] of actions){
  results.push(await f.run(f.callback(no,action,event)));
 }
 assert.deepEqual(results.map(r=>r.status),['applied','applied','applied'],JSON.stringify(results));
 assert.equal(f.counters.supplierWrites,3);
 assert.equal(f.counters.receiptCreates,3);
 assert.deepEqual(f.counters.recalcs,['event-2','event-3','event-1']);
 const current=no=>JSON.parse(f.services['service-'+no].supplier_statuses)[supplierId];
 assert.deepEqual([current(1),current(2),current(3)],['confirmed','rejected','confirmed']);
 assert.deepEqual(f.receipts.map(r=>r.state),['applied','applied','applied']);
});
test('reordered duplicate provider event and a different later click never modify an earlier decision',async()=>{
 const f=await fixture();
 const first=f.callback(1,'assignment_approve','A');
 const firstResult=await f.run(first);
 assert.equal(firstResult.status,'applied',JSON.stringify(firstResult));
 const repeated=await f.run(first);
 assert.equal(repeated.status,'duplicate');
 assert.equal(repeated.terminalReceiptVerified,true);
 const newClick=f.callback(1,'assignment_reject','X');
 const late=await f.run(newClick);
 assert.equal(late.status,'rejected');
 assert.equal(late.reason,'business_conflict');
 assert.equal(late.supplierWritesAuthorized,false);
 assert.equal(f.counters.supplierWrites,1);
 assert.equal(f.counters.receiptCreates,2,
  'separate provider event must have its own durable terminal receipt');
 assert.equal(f.receipts[1].state,'rejected');
 assert.equal(JSON.parse(f.services['service-1'].supplier_statuses)[supplierId],'confirmed');
 assert.equal((await f.run(newClick)).status,'duplicate');
 assert.equal(f.counters.supplierWrites,1);
 assert.equal(f.counters.receiptCreates,2);
});
test('a button token from message A cannot apply to message B, even for same supplier and chat',async()=>{
 const f=await fixture();
 const forged=f.callback(1,'assignment_approve','F');
 forged.messageData.templateButtonReplyMessage.stanzaId=f.rows['service-2'].provider_message_id;
 const outcome=await f.run(forged);
 assert.equal(outcome.status,'refused');
 assert.equal(f.counters.supplierWrites,0);
 assert.equal(f.counters.receiptCreates,0);
});
test('mismatched original provider stanzaId is never replaced by the newest assignment',async()=>{
 const f=await fixture();
 const wrong=f.callback(1,'assignment_approve','A');
 wrong.messageData.templateButtonReplyMessage.stanzaId='3EB0NOTEXIST987654';
 assert.equal((await f.run(wrong)).status,'refused');
 assert.equal(f.counters.supplierWrites,0);
 assert.equal(f.counters.receiptCreates,0);
});
test('regular text, normal quoted reply, voice and unrelated outbound statuses do NOT consume DB calls or mutate status',async()=>{
 for(const type of ['textMessage','extendedTextMessage','audioMessage','quotedMessage']){
  const f=await fixture();
  const normal={
   typeWebhook:'incomingMessageReceived',
   idMessage:'CALLBACKTEXT123456789ABCDE',
   instanceData:{idInstance:Number(instance),typeInstance:'whatsapp'},
   timestamp:Math.floor(now/1000),
   senderData:{chatId:chat,sender:chat},
   messageData:{typeMessage:type,textMessageData:{textMessage:'מאשר'},
    extendedTextMessageData:{text:'מאשר',stanzaId:f.rows['service-1'].provider_message_id}}
  };
  const req=new Request('https://invalid.example.test/callback',{
   method:'POST',headers:{'content-type':'application/json',
    Authorization:'Bearer '+webhookSecret},body:JSON.stringify(normal)
  });
  const result=await stageFutureGreenInteractiveHttpCallback(req,{
   client:f.client,rolloutAuthorized:true,accountCapabilityVerified:true,
   webhookSecret,actionSigningSecret:secret,expectedInstanceId:instance,
   claimOwner:'test-click-order-worker-xyz',now,subtle:webcrypto.subtle,
   recalculateEventStatus:async()=>{throw Error('not an action')}
  });
  assert.equal(result.stage,'ignored_non_button',type);
  assert.equal(result.reason,'owner_approved_buttons_only_filter',type);
  assert.equal(result.noDatabaseCalls,true,type);
  assert.equal(f.counters.outboxReads,0,type);
  assert.equal(f.counters.supplierWrites,0,type);
  assert.equal(f.counters.receiptCreates,0,type);
 }
});
