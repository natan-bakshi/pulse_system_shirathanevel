import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';
import {
  detectSupplierEventChanges,supplierEventChangeSnapshot,
  supplierEventAffectedService,eventChangeFingerprint,
  parseSupplierEventChange,eventInformationNoticeKey
} from '../base44/shared/supplierEventChange.ts';
import {
  planEventChangeReconfirmation,closeSupersededAssignmentIntents
} from '../base44/shared/eventChangeReconfirmation.ts';
import {assignmentTransitionWhatsAppKey} from '../base44/shared/assignmentTransitionWhatsApp.ts';
import {isWhatsAppEnqueueConfirmed} from '../base44/shared/whatsappReceipt.ts';

const LOCATION = 'Jerusalem Old City';
const EVENT_ID='event-choice-test';
const SERVICE_ID='service-choice-test';
const SUPPLIER_ID='supplier-choice-test';
const TEMPLATE_ID='template-choice-test';

function fixture(){
  const event={
    id:EVENT_ID,event_date:'2026-11-10',event_time:'10:00',
    location:LOCATION,concept:'Classic',
    date_change_pending_action:true,
    supplier_event_change_context:JSON.stringify({
      version:1,fields:['location'],
      before:{location:'Mamilla'},after:{location:LOCATION}
    }),
    previous_event_date:'2026-11-10',previous_event_time:'10:00'
  };
  const service={
    id:SERVICE_ID,event_id:EVENT_ID,service_id:'service-catalog-test',
    supplier_ids:JSON.stringify([SUPPLIER_ID]),
    supplier_statuses:JSON.stringify({[SUPPLIER_ID]:'confirmed'}),
    supplier_arrival_time:'09:30',supplier_notes:'{}',
    is_external:false
  };
  const supplier={id:SUPPLIER_ID,phone:'0501234567',whatsapp_enabled:true,
    supplier_name:'Synthetic supplier',contact_emails:[]};
  const recorded={statuses:[],events:[],messages:[],recalc:0};
  const db={
    Event:{get:async()=>event,update:async(_,patch)=>{
      recorded.events.push(patch);Object.assign(event,patch);return event;
    }},
    EventService:{filter:async()=>[service],update:async(_,patch)=>{
      recorded.statuses.push(patch);Object.assign(service,patch);return service;
    }},
    Supplier:{get:async()=>supplier},
    Service:{get:async()=>({service_name:'Sample band'})},
    NotificationTemplate:{filter:async()=>[{
      id:TEMPLATE_ID,type:'SUPPLIER_ASSIGNMENT_UPDATE',
      target_audiences:['supplier'],allowed_channels:['whatsapp'],
      body_template:'New event details',whatsapp_body_template:'New event details'
    }]},
    User:{filter:async()=>[]}
  };
  const client={auth:{me:async()=>({role:'admin'})},
    asServiceRole:{entities:db}};
  return {event,service,db,client,recorded};
}
function compileEndpoint(file,fixtures){
  const code=esbuild.transformSync(
    fs.readFileSync('base44/functions/'+file+'/entry.ts','utf8'),
    {loader:'ts',format:'cjs',target:'es2022'}).code;
  let handler;
  const {recorded,client}=fixtures;
  vm.runInNewContext(code,{
    Deno:{serve:fn=>handler=fn,env:{get:()=>''}},
    Response:{json:(body,options={})=>({body,status:options.status||200})},
    console:{log:()=>{},warn:()=>{},error:()=>{}},
    module:{exports:{}},exports:{},
    require:path=>{
      if(path.startsWith('npm:@base44/sdk'))return {
        createClientFromRequest:()=>client
      };
      if(path.endsWith('eventFields.js'))return {
        getClientContacts:()=>[],getEventContacts:()=>[]
      };
      if(path.endsWith('eventContacts.ts'))return {formatEventContacts:()=>''};
      if(path.endsWith('eventReadiness.ts'))return {
        recalculateEventStatus:async()=>{recorded.recalc++;}
      };
      if(path.endsWith('notificationCore.ts'))return {
        createNotificationCore:async()=>({success:true})
      };
      if(path.endsWith('eventChangeReconfirmation.ts'))return {
        planEventChangeReconfirmation,closeSupersededAssignmentIntents
      };
      if(path.endsWith('supplierEventChange.ts'))return {
        detectSupplierEventChanges,supplierEventChangeSnapshot,
        parseSupplierEventChange,supplierEventAffectedService,
        eventChangeFingerprint,eventInformationNoticeKey
      };
      if(path.endsWith('whatsappReceipt.ts'))return {
        isWhatsAppEnqueueConfirmed
      };
      if(path.endsWith('whatsappSend.ts'))return {
        toChatId:()=> '972501234567@c.us',
        sendWhatsAppText:async(_phone,_message,_client,metadata)=>{
          recorded.messages.push(metadata);
          return {success:true,status:'queued',queued:true,jobId:'outbox-choice-1'};
        },
        sendWhatsAppToChat:async()=>{throw Error('Unexpected notification');}
      };
      if(path.endsWith('assignmentTransitionWhatsApp.ts'))return {
        enqueueAssignmentTransitionWhatsApp:async(_client,_phone,_message,identity,sourceType)=>{
          recorded.messages.push({...identity,sourceType,idempotencyKey:
            await assignmentTransitionWhatsAppKey(identity)});
          return {success:true,status:'queued',jobId:'outbox-choice-1'};
        }
      };
      if(path.endsWith('greenButtonQaFixture.ts'))return {
        isGreenButtonQaFixtureEventPayload:()=>false,
        isGreenButtonQaFixtureServicePayload:()=>false
      };
      if(path.endsWith('whatsappOutbox.ts'))return {
        readWhatsAppQueueControl:async()=>({
          enabled:true,paused:false,interactive_outbound_live_enabled:true,
          interactive_assignment_production_enabled:true
        })
      };
      if(path.endsWith('whatsappProviderConfig.ts'))return {
        resolveWhatsAppProvider:async()=> 'green'
      };
      if(path.endsWith('supplierPortalLink.ts'))return {
        productionAssignmentPrivateTarget:()=>({chatId:'972501234567@c.us'})
      };
      if(path.endsWith('assignmentWhatsApp.ts'))return {};
      if(path.endsWith('quietHours.ts'))return {
        resolveNotificationDelay:()=>({shouldDelay:false})
      };
      if(path.endsWith('entityTriggerWhatsApp.ts'))return {
        entityTriggerWhatsAppContext:()=>({})
      };
      if(path.endsWith('assignmentReminderTiming.ts'))return {
        shouldScheduleAssignmentReplyReminder:()=>false,
        pendingApprovalReminderSupplierIds:()=>[]
      };
      throw Error('Unexpected dependency '+path);
    }
  });
  return handler;
}
test('event change detection includes erased location and maps affected service correctly',()=>{
  const old={event_date:'2026-11-10',event_time:'10:00',location:'A',concept:'B'};
  const newRow={...old,location:''};
  assert.deepEqual([...detectSupplierEventChanges(old,newRow)],['location']);
  const change=supplierEventChangeSnapshot(old,newRow);
  const service=fixture().service;
  assert.equal(change.before.location,'A');
  assert.equal(change.after.location,'');
  assert.equal(supplierEventAffectedService(service,change),true,
    'location impacts suppliers with fixed arrival');
  const timeOnly={version:1,fields:['event_time'],
    before:{event_time:'09:00'},after:{event_time:'10:00'}};
  assert.equal(supplierEventAffectedService(service,timeOnly),false);
  assert.equal(typeof eventChangeFingerprint(change),'string');
});
test('location update with assigned supplier gets decision flag and NO automatic WhatsApp',async()=>{
  const f=fixture();
  f.event.date_change_pending_action=false;
  const old={...f.event,location:'Mamilla'};
  const updated={...f.event};
  const handler=compileEndpoint('handleEntityEvents',f);
  const result=await handler({
    json:async()=>({
      event:{entity_name:'Event',type:'update',entity_id:EVENT_ID},
      data:updated,old_data:old
    })
  });
  assert.equal(result.status,200);
  assert.equal(result.body.notifications_sent,0);
  assert.equal(f.recorded.messages.length,0);
  assert.equal(f.event.date_change_pending_action,true);
  assert.deepEqual(
    JSON.parse(f.event.supplier_event_change_context).fields,['location']
  );
});
test('notify without reset creates exactly one update and keeps approved status',async()=>{
  const f=fixture();
  const handler=compileEndpoint('confirmReassignAfterDateChange',f);
  const response=await handler({json:async()=>({
    event_id:EVENT_ID,mode:'notify_no_reset'
  })});
  assert.equal(response.status,200,JSON.stringify(response.body));
  assert.equal(response.body.success,true);
  assert.equal(f.recorded.statuses.length,0);
  assert.equal(f.recorded.recalc,0);
  assert.equal(JSON.parse(f.service.supplier_statuses)[SUPPLIER_ID],'confirmed');
  assert.equal(f.recorded.messages.length,1);
  const job=f.recorded.messages[0];
  assert.equal(job.sourceType,'event_update');
  assert.match(job.idempotencyKey,/^supplier-event-info-v1:[0-9a-f]{64}$/);
  assert.equal(job.eventServiceId,SERVICE_ID);
  assert.equal(job.supplierId,SUPPLIER_ID);
  assert.equal(f.event.date_change_pending_action,false);
});
test('notify with reset keeps single change message and exact pending assignment',async()=>{
  const f=fixture();
  const handler=compileEndpoint('confirmReassignAfterDateChange',f);
  const response=await handler({json:async()=>({
    event_id:EVENT_ID,mode:'notify_reset'
  })});
  assert.equal(response.status,200,JSON.stringify(response.body));
  assert.equal(f.recorded.statuses.length,1);
  assert.equal(JSON.parse(f.service.supplier_statuses)[SUPPLIER_ID],'pending');
  assert.equal(f.recorded.messages.length,1);
  assert.equal(f.recorded.messages[0].sourceType,'assignment_update');
  assert.ok(f.recorded.messages[0].changeFingerprint);
  assert.equal(f.recorded.recalc,1);
});
test('decision rejects unauthenticated actor and no-pending event',async()=>{
  const f=fixture();
  f.client.auth.me=async()=>({role:'supplier'});
  const handler=compileEndpoint('confirmReassignAfterDateChange',f);
  assert.equal((await handler({json:async()=>({
    event_id:EVENT_ID,mode:'notify_no_reset'
  })})).status,403);
  assert.equal(f.recorded.messages.length,0);
  f.client.auth.me=async()=>({role:'admin'});
  f.event.date_change_pending_action=false;
  assert.equal((await handler({json:async()=>({
    event_id:EVENT_ID,mode:'notify_no_reset'
  })})).status,409);
  assert.equal(f.recorded.messages.length,0);
});
