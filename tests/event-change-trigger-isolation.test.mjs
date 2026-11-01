import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';
import {isEventChangeStatusReset,planEventChangeReconfirmation}
 from '../base44/shared/eventChangeReconfirmation.ts';

const SID='service-123456',SUP='supplier-123456',EID='event-123456';
async function run({approvedChange}){
 const before={id:SID,event_id:EID,service_id:'catalog-123456',
  supplier_ids:JSON.stringify([SUP]),
  supplier_statuses:JSON.stringify({[SUP]:'confirmed'}),
  supplier_notes:'{}'};
 const after={...before,supplier_statuses:JSON.stringify({[SUP]:'pending'})};
 if(approvedChange)after.supplier_reconfirmation_context=planEventChangeReconfirmation(before,{
  kind:'arrival_notify',supplierIds:[SUP],
  fingerprint:JSON.stringify(['10:30','2026-11-01','12:00'])
 },Date.parse('2026-11-01T12:30:00Z')).value;
 const pushes=[];
 const service={id:'catalog-123456',service_name:'Music',
  send_supplier_notifications:true};
 const supplier={id:SUP,phone:'0501234567',contact_emails:['test@example.com'],
  supplier_name:'Synthetic'};
 const db={
  Event:{filter:async()=>[{id:EID,event_name:'Test event',family_name:'Test',
   event_date:'2026-11-01',event_time:'12:00',location:'Jerusalem'}]},
  Service:{list:async()=>[service]},
  Supplier:{list:async()=>[supplier]},
  User:{list:async()=>[{id:'user-123456',email:'test@example.com',role:'supplier'}]},
  NotificationTemplate:{filter:async()=>[{
   type:'SUPPLIER_NEW_ASSIGNMENT',title_template:'שיבוץ חדש',
   body_template:'Updated test',deep_link_base:'EventDetails'
  }]}
 };
 const client={auth:{me:async()=>({role:'admin'})},asServiceRole:{entities:db}};
 const code=esbuild.transformSync(fs.readFileSync(
  'base44/functions/onAssignmentChange/entry.ts','utf8'),
  {loader:'ts',format:'cjs',target:'es2022'}).code;
 let handler;
 vm.runInNewContext(code,{Deno:{serve:fn=>handler=fn},
  Response:{json:(value,{status=200}={})=>({value,status})},
  exports:{},module:{exports:{}},console:{log:()=>{},error:()=>{},warn:()=>{}},
  require:path=>{
   if(path.startsWith('npm:@base44/sdk'))return {createClientFromRequest:()=>client};
   if(path.endsWith('eventContacts.ts'))return {formatEventContacts:()=>''};
   if(path.endsWith('greenButtonQaFixture.ts'))
    return {isGreenButtonQaFixtureServicePayload:()=>false};
   if(path.endsWith('notificationCore.ts'))return {
    createNotificationCore:async(_client,input)=>{pushes.push(input);return {};}
   };
   if(path.endsWith('eventChangeReconfirmation.ts'))return {isEventChangeStatusReset};
   throw Error('Unexpected import '+path);
  }});
 const result=await handler({json:async()=>({event:{type:'update',entity_id:SID},
  data:after,old_data:before})});
 return {result,pushes};
}
test('EventService notification workflow does not send NEW assignment Push for event reconfirmation',async()=>{
 const {result,pushes}=await run({approvedChange:true});
 assert.equal(result.status,200);
 assert.equal(result.value.notifications_sent,0);
 assert.equal(pushes.length,0);
});
test('manual confirmed-to-pending reassign retains old new-assignment notification',async()=>{
 const {result,pushes}=await run({approvedChange:false});
 assert.equal(result.status,200);
 assert.equal(result.value.notifications_sent,1);
 assert.equal(pushes.length,1);
 assert.equal(pushes[0].template_type,'SUPPLIER_NEW_ASSIGNMENT');
});
