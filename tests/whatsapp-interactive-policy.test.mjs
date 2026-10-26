import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultAssignmentWhatsAppPolicy,validateWhatsAppInteractivePolicy,resolveWhatsAppAction} from '../base44/shared/whatsappInteractivePolicy.ts';
test('new interactive feature defaults OFF, with three known actions',()=>{
 const p=validateWhatsAppInteractivePolicy(defaultAssignmentWhatsAppPolicy());
 assert.equal(p.enabled,false);
 assert.equal(resolveWhatsAppAction(p,'assignment_approve'),null);
 assert.deepEqual(p.buttons.map(x=>x.action),['assignment_approve','assignment_reject','contact_office']);
});
test('configured action must be explicitly allowed and enabled',()=>{
 const p=validateWhatsAppInteractivePolicy({enabled:true,quoteAssignment:true,buttons:[{action:'assignment_approve',label:'מאשר'}]});
 assert.equal(resolveWhatsAppAction(p,'assignment_approve'),'assignment_approve');
 assert.equal(resolveWhatsAppAction(p,'assignment_reject'),null);
});
test('reject arbitrary actions, duplicate actions, oversized or unsafe labels',()=>{
 const base={enabled:true,quoteAssignment:false};
 for(const buttons of [
  [{action:'delete_all',label:'המשך'}],
  [{action:'assignment_approve',label:'אישור'},{action:'assignment_approve',label:'אישור נוסף'}],
  [{action:'assignment_approve',label:'x'.repeat(21)}],
  [{action:'assignment_approve',label:'כן\nלא'}],
  []
 ])assert.throws(()=>validateWhatsAppInteractivePolicy({...base,buttons}));
});
