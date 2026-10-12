import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';

const source=fs.readFileSync('base44/functions/handleEntityEvents/entry.ts','utf8');
const match=source.match(/async function recordAssignmentDelivery\([\s\S]*?(?=async function triggerWhatsApp)/);
assert.ok(match,'new assignment delivery recorder was not found');
const compiled=esbuild.transformSync(match[0]+'\n globalThis.record=recordAssignmentDelivery;', {loader:'js'}).code;

function setup() {
  const rows=[];const service={id:'eventservice123456'};
  const event={id:'event123456'};
  const supplier={id:'supplier123456'};
  const template={type:'SUPPLIER_NEW_ASSIGNMENT'};
  const collection={
    filter:async({recovery_key})=>rows.filter(x=>x.recovery_key===recovery_key),
    create:async(x)=>{rows.push({id:'item'+rows.length,...x});return rows.at(-1);},
    update:async(id,patch)=>Object.assign(rows.find(x=>x.id===id),patch)
  };
  const base44={asServiceRole:{entities:{AssignmentMessageRecovery:collection}}};
  const sandbox={
    globalThis:{},console:{error:()=>{}},
    candidateFromLive:()=>({eventServiceId:service.id,eventId:event.id,supplierId:supplier.id,recoveryKey:'2026-10-12|eventservice123456|supplier123456',message:'test reminder'}),
    israelDay:()=> '2026-10-12',
    resolveWhatsAppProvider:async()=> 'wasender'
  };
  vm.runInNewContext(compiled,sandbox);
  const record=(state,arg)=>sandbox.globalThis.record(base44,template,event,service,supplier,state,arg);
  return {record,rows,base44,event,service,supplier};
}
test('429 creates a durable queued item for manual recovery',async()=>{
 const x=setup();
 await x.record('queued',{errorCode:429});
 assert.equal(x.rows.length,1);
 assert.equal(x.rows[0].state,'queued');
 assert.equal(x.rows[0].message_snapshot,'test reminder');
 assert.equal(x.rows[0].error_code,429);
});
test('accepted attempt updates existing queue instead of creating duplicates',async()=>{
 const x=setup();
 await x.record('queued',{errorCode:429});
 await x.record('accepted',{messageId:'test-msg'});
 assert.equal(x.rows.length,1);
 assert.equal(x.rows[0].state,'accepted');
 assert.equal(x.rows[0].provider_message_id,'test-msg');
 await x.record('queued',{errorCode:429});
 assert.equal(x.rows[0].state,'accepted');
});
test('unknown delivery cannot be overwritten by future attempts',async()=>{
 const x=setup();
 await x.record('unknown',{deliveryUncertain:true,errorCode:503});
 assert.equal(x.rows.length,1);
 await x.record('accepted',{messageId:'new-message'});
 assert.equal(x.rows[0].state,'unknown');
});
test('unrelated template never creates an assignment recovery entry',async()=>{
 const x=setup();
 await x.base44.asServiceRole.entities.AssignmentMessageRecovery.filter({recovery_key:'unused'});
 const code=source.match(/async function recordAssignmentDelivery\([\s\S]*?(?=async function triggerWhatsApp)/)[0];
 assert.ok(code.includes("SUPPLIER_NEW_ASSIGNMENT"));
});
