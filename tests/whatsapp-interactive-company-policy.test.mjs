import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultCompanyWhatsAppPolicy,normalizeCompanyWhatsAppPolicy,companyPolicyKey} from '../base44/shared/whatsappInteractiveCompanyPolicy.ts';
test('each company and provider gets distinct disabled policy and settings key',()=>{
 const a=defaultCompanyWhatsAppPolicy('company1','green');
 assert.equal(a.policy.enabled,false);
 assert.notEqual(companyPolicyKey(a),companyPolicyKey(defaultCompanyWhatsAppPolicy('company2','green')));
 assert.notEqual(companyPolicyKey(a),companyPolicyKey(defaultCompanyWhatsAppPolicy('company1','wasender')));
});
test('reject invalid company scope, office phone and early activation',()=>{
 const p=defaultCompanyWhatsAppPolicy('company1','green');
 assert.throws(()=>normalizeCompanyWhatsAppPolicy({...p,companyId:'../../root'}));
 assert.throws(()=>normalizeCompanyWhatsAppPolicy({...p,officeNumber:'+972500000000'}));
 assert.throws(()=>normalizeCompanyWhatsAppPolicy({...p,policy:{...p.policy,enabled:true}}));
 assert.equal(normalizeCompanyWhatsAppPolicy({...p,officeNumber:'972500000000'}).officeNumber,'972500000000');
});
