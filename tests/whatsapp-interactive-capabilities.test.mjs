import test from 'node:test';
import assert from 'node:assert/strict';
import {effectiveInteractiveCapabilities,interactiveDeliveryPlan} from '../base44/shared/whatsappInteractiveCapabilities.ts';
const now=Date.parse('2026-10-26T12:00:00Z');
const evidence={provider:'green',accountId:'instance',verifiedAt:'2026-10-26T11:00:00Z',features:{buttons:true,urlButton:true,quote:true,inboundVerified:true}};
test('provider feature flags require fresh account-specific verification',()=>{
 assert.equal(effectiveInteractiveCapabilities(evidence,now).buttons,true);
 assert.equal(effectiveInteractiveCapabilities({...evidence,verifiedAt:'2026-08-01T00:00:00Z'},now).buttons,false);
 assert.equal(effectiveInteractiveCapabilities({...evidence,features:{...evidence.features,inboundVerified:false}},now).buttons,false);
 assert.equal(interactiveDeliveryPlan({enabled:true,provider:'wasender',accountId:'instance',evidence,quoteRequested:true,buttonsRequested:true},now).mode,'plain_text');
});
test('unverified buttons always downgrade to plain text, no provider call',()=>{
 const plan=interactiveDeliveryPlan({enabled:true,provider:'green',accountId:'instance',evidence:null,quoteRequested:true,buttonsRequested:true},now);
 assert.equal(plan.mode,'plain_text');assert.equal(plan.quote,false);
 assert.equal(interactiveDeliveryPlan({enabled:false,provider:'green',accountId:'instance',evidence,quoteRequested:true,buttonsRequested:true},now).mode,'plain_text');
});
