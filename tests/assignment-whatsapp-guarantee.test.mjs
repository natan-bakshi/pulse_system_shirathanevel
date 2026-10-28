import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';
import {assignmentWhatsAppKey,assignmentWhatsAppContext,renderAssignmentWhatsApp,cleanMissingAssignmentTime,supplierTargetChatId,supplierAssignmentTargetChatId,addedSupplierIds} from '../base44/shared/assignmentWhatsApp.ts';

const tpl="שלום {{supplier_name}}, שובצת לשירות '{{service_name}}' באירוע של משפחת {{family_name}} בתאריך {{event_date}} בשעה {{event_time}}.\n📍 מיקום: {{event_location}}\n\n{{supplier_note}}\n\nנא אשר את השתתפותך במערכת Pulse.\n\nhttps://pulse-system.base44.app/SupplierCalendarDashboard";
function env(overrides={}){
  const event={id:'event-abc123',event_name:'משפחת בדיקה',family_name:'בדיקה',event_date:'2026-11-16',event_time:'10:30',location:'ירושלים',status:'confirmed'};
  const supplier={id:'supplier-abc123',supplier_name:'עדי',contact_person:'עדי',phone:'0521234567',whatsapp_enabled:true,preferred_channel:'phone'};
  const svc={id:'service-abc123',event_id:event.id,service_id:'servicecat-abc123',is_external:false,
    updated_date:'2026-10-13T15:25:00Z',supplier_ids:JSON.stringify([supplier.id]),
    supplier_statuses:JSON.stringify({[supplier.id]:'pending'}),supplier_notes:JSON.stringify({[supplier.id]:'להגיע לפני הזמן'})};
  Object.assign(supplier,overrides.supplier||{});Object.assign(svc,overrides.svc||{});Object.assign(event,overrides.event||{});
  const sent=[],queries=[];
  const client={auth:{me:async()=>overrides.actor||{role:'admin'}},
    asServiceRole:{entities:{
      EventService:{get:async()=>svc},
      Event:{get:async()=>event},
      Service:{get:async()=>({service_name:'להקה'})},
      Supplier:{get:async()=>supplier},
      NotificationTemplate:{filter:async()=>[{type:'SUPPLIER_NEW_ASSIGNMENT',is_active:true,
        allowed_channels:['whatsapp'],whatsapp_body_template:tpl}]},
      WhatsAppQueueControl:{filter:async()=>[{id:'control',enabled:true}]}
    }}
  };
  const js=esbuild.transformSync(fs.readFileSync('base44/functions/ensureAssignmentWhatsApp/entry.ts','utf8'),{
    loader:'ts',format:'cjs',target:'es2022'
  }).code;
  let handler;
  vm.runInNewContext(js,{
    exports:{},module:{exports:{}},console:{error:()=>{},warn:()=>{}},
    Deno:{serve:fn=>handler=fn,env:{get:k=>overrides.qaEnv?.[k]||''}},
    Response:{json:(data,{status=200}={})=>({status,data})},
    require:path=>{
      if(path.startsWith('npm:@base44/sdk'))return {createClientFromRequest:()=>client};
      if(path.endsWith('whatsappSend.ts'))return {toChatId:phone=>'972'+String(phone).slice(1)+'@c.us',
        sendWhatsAppToChat:async(chatId,text,_client,ctx)=>{
          if(overrides.sendFailure)throw Error('Simulated backend refusal');
          sent.push({chatId,text,ctx});
          return overrides.sendResponse||{queued:true,status:'queued',jobId:'outbox-'+sent.length};
        }};
      if(path.endsWith('whatsappOutbox.ts'))return {readWhatsAppQueueControl:async()=>({enabled:true})};
      if(path.endsWith('quietHours.ts'))return {resolveNotificationDelay:()=>({shouldDelay:false})};
      if(path.endsWith('assignmentWhatsApp.ts'))return {
        assignmentWhatsAppKey,assignmentWhatsAppContext,renderAssignmentWhatsApp,supplierTargetChatId,supplierAssignmentTargetChatId
      };
      throw Error('Unexpected import '+path);
    }
  });
  return {svc,supplier,event,sent,queries,invoke:async(body,method='POST')=>{
    const result=await handler({method,json:async()=>body});
    return result;
  }};
}
test('exact assignment renderer preserves supplier-specific time and note',()=>{
 const e=env();
 e.svc.supplier_arrival_time='09:40';
 const text=renderAssignmentWhatsApp(tpl,e.event,e.svc,e.supplier,'להקה');
 assert.match(text,/עדי/);assert.match(text,/09:40/);
 assert.match(text,/16\/11\/2026/);assert.match(text,/📝 הערה עבורך: להגיע לפני הזמן/);
 assert.match(text,/SupplierCalendarDashboard/);
});
test('assignment message without a known time omits dangling בשעה . without fabricating a time',()=>{
 const x=env({event:{event_time:''},svc:{supplier_arrival_time:''}});
 const actual=renderAssignmentWhatsApp(tpl,x.event,x.svc,x.supplier,'להקה');
 assert.doesNotMatch(actual,/בשעה\s*[.\n]/);
 assert.match(actual,/16\/11\/2026\./);
 assert.match(actual,/נא אשר/);
 assert.equal(cleanMissingAssignmentTime('הגעה בשעה .',false),'הגעה.');
 assert.equal(cleanMissingAssignmentTime('הגעה בשעה 09:40.',true),'הגעה בשעה 09:40.');
});
test('both producers compute the same business key and a single quiet-hour Outbox due date',()=>{
 const x=env();
 const deadline=new Date('2026-11-16T05:00:00.000Z');
 const regular=assignmentWhatsAppContext(x.svc,x.supplier.id,'SUPPLIER_NEW_ASSIGNMENT');
 const delayed=assignmentWhatsAppContext(x.svc,x.supplier.id,'SUPPLIER_NEW_ASSIGNMENT',
   {shouldDelay:true,scheduledFor:deadline});
 assert.equal(delayed.idempotencyKey,regular.idempotencyKey);
 assert.equal(delayed.availableAt,deadline.toISOString());
 assert.equal(regular.availableAt,undefined);
 assert.equal(delayed.sourceType,'assignment_new');
});
test('newly added suppliers are identified while existing unchanged IDs are skipped',()=>{
 assert.deepEqual(addedSupplierIds('[\"a\"]','[\"a\",\"b\",\"c\"]'),['b','c']);
 assert.deepEqual(addedSupplierIds(['a'],['a']),[]);
});
test('explicit save guard generates one WhatsApp outbox job for a pending supplier',async()=>{
 const x=env();
 const result=await x.invoke({eventServiceId:x.svc.id,newSupplierIds:[x.supplier.id]});
 assert.equal(result.status,200);
 assert.equal(result.data.queued,1);assert.equal(result.data.success,true);
 assert.equal(x.sent.length,1);
 assert.match(x.sent[0].chatId,/@c\.us$/);
 assert.equal(x.sent[0].ctx.idempotencyKey,assignmentWhatsAppKey(x.svc,x.supplier.id));
 assert.equal(x.sent[0].ctx.sourceType,'assignment_new');
});
test('supplier using WhatsApp group receives the correct group chat target',async()=>{
 const x=env({supplier:{preferred_channel:'group',whatsapp_group_url:'120363402752568652@g.us'}});
 const r=await x.invoke({eventServiceId:x.svc.id,newSupplierIds:[x.supplier.id]});
 assert.equal(r.status,200);assert.equal(x.sent[0].chatId,'120363402752568652@g.us');
});
test('existing confirmed supplier is never sent a new approval request',async()=>{
 const x=env({svc:{supplier_statuses:JSON.stringify({'supplier-abc123':'confirmed'})}});
 const r=await x.invoke({eventServiceId:x.svc.id,newSupplierIds:[x.supplier.id]});
 assert.equal(r.data.skipped,1);assert.equal(x.sent.length,0);
});
test('a deduplicated FAILED outbox entry is surfaced to manager and never counted as success',async()=>{
 const x=env({sendResponse:{success:true,queued:false,deduplicated:true,status:'failed',jobId:'old-job'}});
 const r=await x.invoke({eventServiceId:x.svc.id,newSupplierIds:[x.supplier.id]});
 assert.equal(r.status,207);
 assert.equal(r.data.success,false);
 assert.equal(r.data.queued,0);
 assert.equal(r.data.accepted,0);
 assert.equal(r.data.skipped,0);
 assert.equal(r.data.jobIds[0],'old-job');
 assert.match(r.data.errors[0],/failed.*manual review required/);
});

test('a deduplicated UNKNOWN message is not silently marked as delivered or retried',async()=>{
 const x=env({sendResponse:{success:true,queued:false,deduplicated:true,status:'unknown',jobId:'uncertain-job'}});
 const r=await x.invoke({eventServiceId:x.svc.id,newSupplierIds:[x.supplier.id]});
 assert.equal(r.data.success,false);
 assert.equal(r.status,207);
 assert.equal(r.data.accepted,0);
 assert.match(r.data.errors[0],/unknown.*manual review required/);
});

test('a deduplicated ACCEPTED message is recognized without a new outbox entry',async()=>{
 const x=env({sendResponse:{success:true,queued:false,deduplicated:true,status:'accepted',jobId:'done-job'}});
 const r=await x.invoke({eventServiceId:x.svc.id,newSupplierIds:[x.supplier.id]});
 assert.equal(r.status,200);
 assert.equal(r.data.success,true);
 assert.equal(r.data.accepted,1);
});

test('an unrecognized provider response is an error, not successful skipped',async()=>{
 const x=env({sendResponse:{success:true,queued:false,status:'pending'}});
 const r=await x.invoke({eventServiceId:x.svc.id,newSupplierIds:[x.supplier.id]});
 assert.equal(r.data.success,false);
 assert.match(r.data.errors[0],/not confirmed as queued or accepted/);
});

test('failed producer cannot claim success; manager receives error summary',async()=>{
 const x=env({sendFailure:true});
 const r=await x.invoke({eventServiceId:x.svc.id,newSupplierIds:[x.supplier.id]});
 assert.equal(r.status,207);assert.equal(r.data.success,false);
 assert.equal(r.data.errors.length,1);assert.equal(x.sent.length,0);
});
test('unauthenticated supplier cannot enqueue assignment messages',async()=>{
 const x=env({actor:{role:'supplier'}});
 const r=await x.invoke({eventServiceId:x.svc.id,newSupplierIds:[x.supplier.id]});
 assert.equal(r.status,403);assert.equal(x.sent.length,0);
});
test('invalid requests do not enqueue WhatsApp',async()=>{
 const x=env();
 const r=await x.invoke({eventServiceId:x.svc.id,newSupplierIds:['bad@input']});
 assert.equal(r.status,400);assert.equal(x.sent.length,0);
});
