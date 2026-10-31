import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SHIRAT_WHATSAPP_COMPANY_ID,parseSavedWhatsAppInteractivePolicy,
  readSavedWhatsAppInteractivePolicy,saveWhatsAppInteractivePolicyDraft
} from '../base44/shared/whatsappInteractiveSettingsStore.ts';
import {defaultAssignmentWhatsAppPolicy} from '../base44/shared/whatsappInteractivePolicy.ts';

function fixture(){
  const control={id:'control-whatsapp',control_key:'global',enabled:true,
    paused:false,lease_owner:'',lease_until:'',enqueue_owner:'',enqueue_until:''};
  let writes=0, simulateRace=null;
  const read=async()=>[control];
  const updateMany=async(query,operation)=>{
    if(simulateRace){const race=simulateRace;simulateRace=null;race(control);}
    const matches=Object.entries(query).every(([key,value])=>
      // Mongo match {field:null} includes an absent optional field.
      (control[key]??null)===(value??null));
    if(!matches)return {updated:0};
    Object.assign(control,operation.$set);
    writes++;
    return {updated:1};
  };
  const client={asServiceRole:{entities:{WhatsAppQueueControl:{filter:read,updateMany}}}};
  return {control,client,setRace:fn=>simulateRace=fn,getWrites:()=>writes};
}
function edit(provider='green',version=1,patch={}){
  return {provider,expectedVersion:version,officeNumber:'972501234567',
    policy:defaultAssignmentWhatsAppPolicy(),...patch};
}
test('new interactive settings default to disabled and never mutate the queue',async()=>{
  const f=fixture();
  const initial=await readSavedWhatsAppInteractivePolicy(f.client,'green');
  assert.equal(initial.setting.companyId,SHIRAT_WHATSAPP_COMPANY_ID);
  assert.equal(initial.setting.policy.enabled,false);
  assert.equal(initial.setting.version,1);
  assert.equal(initial.configured,false);
  assert.equal(initial.corrupt,false);
  assert.equal(f.getWrites(),0);
  assert.equal(f.control.enabled,true);
});
test('provider-isolated persistent drafts use sequential CAS versions without changing worker fields',async()=>{
  const f=fixture();
  const first=await saveWhatsAppInteractivePolicyDraft(f.client,edit('green'));
  assert.equal(first.setting.version,2);
  assert.equal(first.setting.officeNumber,'972501234567');
  assert.equal(first.setting.policy.enabled,false);
  const green=await readSavedWhatsAppInteractivePolicy(f.client,'green');
  const wasender=await readSavedWhatsAppInteractivePolicy(f.client,'wasender');
  assert.equal(green.setting.version,2);
  assert.equal(wasender.setting.version,1);
  assert.equal(wasender.configured,false);
  const second=await saveWhatsAppInteractivePolicyDraft(f.client,edit('wasender'));
  assert.equal(second.setting.version,2);
  assert.equal(f.getWrites(),2);
  assert.equal(f.control.enabled,true);
  assert.equal(f.control.paused,false);
  assert.equal(f.control.enqueue_owner,'');
  assert.equal(f.control.lease_owner,'');
  const revised=await saveWhatsAppInteractivePolicyDraft(f.client,edit('green',2,{
    officeNumber:'972547654321',policy:{...defaultAssignmentWhatsAppPolicy(),quoteAssignment:true,
      buttons:[{action:'assignment_reject',label:'לא מתאים'}]}
  }));
  assert.deepEqual(revised.setting.policy.buttons,[{action:'assignment_reject',label:'לא מתאים'}]);
  assert.equal(revised.setting.policy.quoteAssignment,true);
  assert.equal((await readSavedWhatsAppInteractivePolicy(f.client,'wasender')).setting.version,2);
});
test('stale browser tab and concurrently modified record cannot silently overwrite draft',async()=>{
  const f=fixture();
  await saveWhatsAppInteractivePolicyDraft(f.client,edit('green'));
  await assert.rejects(saveWhatsAppInteractivePolicyDraft(f.client,edit('green',1)),e=>e.status===409);
  const before=f.getWrites();
  f.setRace(row=>{row.interactive_assignment_green_policy_json=JSON.stringify({
    ...(JSON.parse(row.interactive_assignment_green_policy_json)),version:3
  });});
  await assert.rejects(saveWhatsAppInteractivePolicyDraft(f.client,edit('green',2)),e=>e.status===409);
  assert.equal(f.getWrites(),before,'CAS failure must not write stale data');
});
test('corrupted, wrong tenant or wrong provider settings fail closed and are not overwritten',async()=>{
  const f=fixture();
  f.control.interactive_assignment_green_policy_json='invalid JSON';
  const broken=await readSavedWhatsAppInteractivePolicy(f.client,'green');
  assert.equal(broken.corrupt,true);
  assert.equal(broken.setting.policy.enabled,false);
  await assert.rejects(saveWhatsAppInteractivePolicyDraft(f.client,edit('green')),e=>e.status===409);
  assert.equal(f.getWrites(),0);
  f.control.interactive_assignment_green_policy_json=JSON.stringify({
    ...broken.setting,companyId:'other_company'
  });
  assert.equal(parseSavedWhatsAppInteractivePolicy(f.control,'green').corrupt,true);
  f.control.interactive_assignment_green_policy_json=JSON.stringify({
    ...broken.setting,provider:'wasender'
  });
  assert.equal(parseSavedWhatsAppInteractivePolicy(f.control,'green').corrupt,true);
});
test('reject unsupported scope, early live activation, invalid phone, labels and versions',async()=>{
  const f=fixture();
  const invalid=[
    edit('other'),
    edit('green',1,{companyId:'another_company'}),
    edit('green',1,{messageKind:'invoice'}),
    edit('green',0),
    edit('green',1,{officeNumber:'0501234567+'}),
    edit('green',1,{policy:{...defaultAssignmentWhatsAppPolicy(),enabled:true}}),
    edit('green',1,{policy:{...defaultAssignmentWhatsAppPolicy(),buttons:[{action:'delete_all',label:'danger'}]}})
  ];
  for(const row of invalid)await assert.rejects(saveWhatsAppInteractivePolicyDraft(f.client,row));
  assert.equal(f.getWrites(),0);
  assert.equal(f.control.interactive_assignment_green_policy_json,undefined);
});
test('production UI edits the ACTUAL saved office/label policy without re-enabling QA draft screen',()=>{
  const source=fs.readFileSync('src/components/admin/notifications/WhatsAppLiveButtonSettings.jsx','utf8');
  const parent=fs.readFileSync('src/components/admin/NotificationManagementTab.jsx','utf8');
  const queue=fs.readFileSync('src/components/admin/notifications/WhatsAppQueueSettings.jsx','utf8');
  assert.match(parent,/<WhatsAppLiveButtonSettings active=/);
  assert.doesNotMatch(queue,/<WhatsAppLiveButtonSettings/,'same settings must not appear twice');
  assert.doesNotMatch(parent,/<WhatsAppInteractiveDraftSettings\s*\/>/);
  assert.match(source,/action:'interactiveGet'/);
  assert.match(source,/action:'interactiveSave'/);
  assert.match(source,/enabled:false/);
  assert.match(source,/officeNumber/);
  assert.doesNotMatch(source,/action:'kick'|action:'retry'|action:'configure'/);
});
