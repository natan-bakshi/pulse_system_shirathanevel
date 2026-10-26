import test from 'node:test';
import assert from 'node:assert/strict';
import {supplierTransition,supplierAssigned} from '../base44/shared/whatsappSupplierTransition.ts';
test('dashboard transition maps to real persisted confirmed/rejected statuses',()=>{
 assert.equal(supplierTransition(undefined,'confirmed').next,'confirmed');
 assert.equal(supplierTransition(undefined,'rejected').next,'rejected');
 assert.equal(supplierTransition('confirmed','confirmed').changed,false);
 assert.equal(supplierTransition('pending','invalid').allowed,false);
});
test('future inbound transition refuses stale status and duplicate is no-op',()=>{
 assert.equal(supplierTransition('confirmed','rejected',true).allowed,false);
 assert.equal(supplierTransition('confirmed','confirmed',true).changed,false);
 assert.equal(supplierTransition('pending','rejected',true).changed,true);
});
test('supplier assignment must be explicit',()=>{
 assert.equal(supplierAssigned('["a","b"]','a'),true);
 assert.equal(supplierAssigned('["a","b"]','c'),false);
 assert.equal(supplierAssigned('not json','a'),false);
});
