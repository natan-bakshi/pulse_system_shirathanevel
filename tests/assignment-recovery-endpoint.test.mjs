import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';
import * as recovery from '../base44/shared/assignmentRecovery.ts';

const code=esbuild.transformSync(fs.readFileSync('base44/functions/AssignmentWhatsAppRecovery/entry.ts','utf8'),{loader:'ts',format:'cjs',target:'es2022'}).code;
function fixture({actor={role:'admin',email:'natib8000@gmail.com'},failure=null}={}) {
  const now=new Date().toISOString(); let calls=0;
  const supplier={id:'supplier123456',supplier_name:'ספק בדיקה',phone:'0501234567',whatsapp_enabled:true};
  const event={id:'event123456',event_name:'אירוע בדיקה',family_name:'בדיקה',event_date:'2099-11-05',event_time:'10:00',location:'ירושלים',status:'confirmed'};
  const service={id:'type123456',service_name:'צילום'};
  const eventService={id:'eventservice123456',event_id:event.id,service_id:service.id,service_name:'צילום',supplier_ids:JSON.stringify([supplier.id]),supplier_statuses:JSON.stringify({[supplier.id]:'pending'}),updated_date:now};
  const template={type:'SUPPLIER_NEW_ASSIGNMENT',is_active:true,allowed_channels:['whatsapp'],whatsapp_body_template:'שלום {{supplier_name}}, שירות {{service_name}} של {{family_name}} ב{{event_date}}, {{event_time}}'};
  const rows=[];
  function filterRecords(query){
    return rows.filter(x=>Object.entries(query||{}).every(([k,v])=>{
      if(v&&typeof v==='object'&&('$gte' in v))return x[k] && x[k]>=v.$gte;
      return x[k]===v;
    }));
  }
  const recoveryEntity={
    list:async()=>rows,
    filter:async(query,sort,limit)=>filterRecords(query).sort((a,b)=>sort?.startsWith('-')?String(b[sort.slice(1)]||'').localeCompare(String(a[sort.slice(1)]||'')):String(a[sort]||'').localeCompare(String(b[sort]||''))).slice(0,limit||500),
    get:async(id)=>rows.find(x=>x.id===id),
    create:async(data)=>{const value={id:'recovery'+String(rows.length+1).padStart(8,'0'),created_date:now,...data};rows.push(value);return value;},
    update:async(id,patch)=>{Object.assign(rows.find(x=>x.id===id),patch);return rows.find(x=>x.id===id);},
    updateMany:async(query,ops)=>{const hit=filterRecords(query);for(const x of hit)Object.assign(x,ops.$set||{});return {updated:hit.length};}
  };
  const db={
    EventService:{filter:async()=>[eventService],get:async(id)=>id===eventService.id?eventService:null},
    Event:{list:async()=>[event],get:async(id)=>id===event.id?event:null},
    Supplier:{list:async()=>[supplier],get:async(id)=>id===supplier.id?supplier:null},
    Service:{list:async()=>[service],get:async()=>service},
    NotificationTemplate:{filter:async()=>[template]},
    AssignmentMessageRecovery:recoveryEntity
  };
  const client={auth:{me:async()=>actor},asServiceRole:{entities:db}};
  let handler;
  const mockRequire=(name)=>{
    if(name.startsWith('npm:@base44/sdk'))return {createClientFromRequest:()=>client};
    if(name.endsWith('assignmentRecovery.ts'))return recovery;
    if(name.endsWith('whatsappProviderConfig.ts'))return {
      resolveWhatsAppProvider:async()=> 'wasender',
      hasSelectedWhatsAppProviderCredentials:async()=>true
    };
    if(name.endsWith('whatsappSend.ts'))return {
      sendWhatsAppToChat:async()=>{calls++;if(failure)throw failure;return {messageId:'provider-message-123'};}
    };
    if(name.endsWith('wasenderSend.ts'))return {checkWasenderSessionStatus:async()=>({connected:true,status:'connected'})};
    throw new Error('Unexpected module: '+name);
  };
  vm.runInNewContext(code,{
    require:mockRequire,exports:{},module:{exports:{}},
    console:{log:()=>{},error:()=>{}},
    Deno:{serve:(fn)=>{handler=fn;}},
    Response:{json:(body,{status=200}={})=>({body,status})},
    Date,Map,Set
  },{filename:'AssignmentWhatsAppRecovery/entry.ts'});
  const invoke=async(action,other={})=>handler({method:'POST',json:async()=>({action,...other})});
  return {invoke,rows,get calls(){return calls;},eventService,supplier};
}
test('preview makes no sends and accurately returns pending candidates',async()=>{
  const x=fixture();
  const a=await x.invoke('preview',{hours:8});
  assert.equal(a.status,200);
  assert.equal(a.body.changedServices,1);
  assert.equal(a.body.items.length,1);
  assert.match(a.body.items[0].message,/תזכורת/);
  assert.equal(x.calls,0);
});
test('prepare is dry and idempotent, then sendNext sends exactly one',async()=>{
  const x=fixture();
  const choice=[{eventServiceId:x.eventService.id,supplierId:x.supplier.id}];
  const a=await x.invoke('prepare',{selection:choice,hours:8});
  assert.equal(a.body.prepared,1);
  assert.equal(x.calls,0);
  const dup=await x.invoke('prepare',{selection:choice,hours:8});
  assert.equal(dup.body.prepared,0);
  assert.equal(x.rows.length,1);
  const sent=await x.invoke('sendNext');
  assert.equal(sent.status,200);
  assert.equal(sent.body.sent,true);
  assert.equal(sent.body.summary.accepted,1);
  assert.equal(x.calls,1);
  const again=await x.invoke('sendNext');
  assert.equal(x.calls,1);
  assert.equal(again.body.waitingSeconds>0,true);
});
test('automatic rate-limit queue cannot send before explicit approval',async()=>{
  const x=fixture();
  const preview=await x.invoke('preview',{hours:8});
  const item=preview.body.items[0];
  x.rows.push({
    id:'recovery-unapproved',created_date:new Date().toISOString(),
    recovery_key:item.recoveryKey || `unused|${x.eventService.id}|${x.supplier.id}`,
    incident_date:recovery.israelDay(),
    event_id:item.eventId,event_service_id:item.eventServiceId,supplier_id:item.supplierId,
    message_snapshot:item.message,state:'queued',approved_for_replay:false,attempt_count:0
  });
  // Use the actual logical key so prepare reconciles instead of duplicating.
  x.rows[0].recovery_key=recovery.israelDay()+'|'+x.eventService.id+'|'+x.supplier.id;
  const initial=await x.invoke('sendNext');
  assert.equal(initial.body.finished,true);
  assert.equal(x.calls,0);
  const result=await x.invoke('prepare',{hours:8,selection:[{eventServiceId:x.eventService.id,supplierId:x.supplier.id}]});
  assert.equal(result.body.prepared,1);
  assert.equal(x.rows.length,1);
  assert.equal(x.rows[0].approved_for_replay,true);
  await x.invoke('sendNext');
  assert.equal(x.calls,1);
});

test('reconciled dashboard history excludes already-sent recipients and safely fills an unapproved snapshot',async()=>{
  const x=fixture();
  const preview=await x.invoke('preview',{hours:8});
  const item=preview.body.items[0];
  const key=recovery.israelDay()+'|'+item.eventServiceId+'|'+item.supplierId;
  x.rows.push({
    id:'existing-reconciled',created_date:new Date().toISOString(),recovery_key:key,
    incident_date:recovery.israelDay(),event_id:item.eventId,
    event_service_id:item.eventServiceId,supplier_id:item.supplierId,
    message_snapshot:'Pending review placeholder',state:'queued',approved_for_replay:false,attempt_count:0
  });
  const a=await x.invoke('prepare',{hours:8,selection:[{eventServiceId:item.eventServiceId,supplierId:item.supplierId}]});
  assert.equal(a.body.prepared,1);
  assert.equal(x.rows.length,1);
  assert.equal(x.rows[0].message_snapshot,item.message);
  assert.equal(x.rows[0].approved_for_replay,true);
  x.rows[0].state='accepted';
  const b=await x.invoke('prepare',{hours:8,selection:[{eventServiceId:item.eventServiceId,supplierId:item.supplierId}]});
  assert.equal(b.body.prepared,0);
  assert.equal(x.rows[0].state,'accepted');
  assert.equal(x.calls,0);
});

test('legacy Sent log timestamps in +03:00 do not block the 18 recovery messages',async()=>{
  const x=fixture();
  const choice=[{eventServiceId:x.eventService.id,supplierId:x.supplier.id}];
  const prepared=await x.invoke('prepare',{selection:choice,hours:8});
  assert.equal(prepared.body.prepared,1);
  const then=new Date(Date.now()-60*60*1000);
  const offsetTime=new Date(then.getTime()+3*60*60*1000).toISOString().replace('Z','+03:00');
  for(let i=0;i<15;i++)x.rows.push({
    id:'historical-'+i,created_date:then.toISOString(),recovery_key:'historical-'+i,
    state:'accepted',attempted_at:offsetTime,approved_for_replay:false,attempt_count:1
  });
  const attempt=await x.invoke('sendNext');
  assert.equal(attempt.status,200);
  assert.equal(attempt.body.sent,true);
  assert.equal(x.calls,1);
  assert.equal(x.rows[0].state,'accepted');
});

test('uncertain send never retries even if admin resumes',async()=>{
  const x=fixture({failure:{deliveryUncertain:true,errorCode:503}});
  await x.invoke('prepare',{hours:8,selection:[{eventServiceId:x.eventService.id,supplierId:x.supplier.id}]});
  const sent=await x.invoke('sendNext');
  assert.equal(sent.body.summary.unknown,1);
  assert.equal(x.calls,1);
  await x.invoke('sendNext');
  assert.equal(x.calls,1);
});
test('rejected 429 retains a queued record but enforces cooling off',async()=>{
  const x=fixture({failure:{deliveryUncertain:false,errorCode:429}});
  await x.invoke('prepare',{hours:8,selection:[{eventServiceId:x.eventService.id,supplierId:x.supplier.id}]});
  const sent=await x.invoke('sendNext');
  assert.equal(sent.body.summary.queued,1);
  assert.equal(sent.body.errorCode,429);
  assert.equal((await x.invoke('sendNext')).body.waitingSeconds>0,true);
  assert.equal(x.calls,1);
});
test('system owner authorization is checked before any reads or writes',async()=>{
  const x=fixture({actor:{role:'admin',email:'someone-else@example.com'}});
  const out=await x.invoke('preview',{hours:8});
  assert.equal(out.status,403);
  assert.equal(x.calls,0);
});
