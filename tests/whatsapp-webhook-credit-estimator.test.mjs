import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {estimateGreenWebhookInvocationCredits} from '../src/lib/whatsappWebhookCreditModel.js';
test('pure forecast compares 30 days of 200 incoming / 10 buttons / 2 unknown per day',()=>{
 const result=estimateGreenWebhookInvocationCredits({
  incomingEventsPerDay:200,buttonClicksPerDay:10,unknownEventsPerDay:2
 });
 assert.equal(result.directBase44Invocations,6000);
 assert.equal(result.filteredGatewayBase44Invocations,360);
 assert.equal(result.directEstimatedCredits,60);
 assert.equal(result.gatewayEstimatedBase44Credits,3.6);
 assert.equal(result.backendCreditsPotentiallyAvoided,56.4);
 assert.equal(result.filteredKnownNonButtonsPerMonth,5640);
 assert.equal(result.unknownEventsMustBeForwarded,true);
 assert.equal(result.actualWorkspaceUsageNotMeasured,true);
 assert.equal(result.externalGatewayCostsExcluded,true);
 assert.equal(result.providerWebhookNotEnabled,true);
 assert.equal(result.noNetworkCalls,true);
});
test('no incoming traffic means zero backend invocation cost in BOTH options',()=>{
 const result=estimateGreenWebhookInvocationCredits({
  incomingEventsPerDay:0,buttonClicksPerDay:0
 });
 assert.equal(result.directEstimatedCredits,0);
 assert.equal(result.gatewayEstimatedBase44Credits,0);
 assert.equal(result.backendCreditsPotentiallyAvoided,0);
});
test('if every inbound is button or unknown, filtering cannot magically save Base44 credits',()=>{
 const result=estimateGreenWebhookInvocationCredits({
  incomingEventsPerDay:500,buttonClicksPerDay:200,unknownEventsPerDay:300
 });
 assert.equal(result.backendCreditsPotentiallyAvoided,0);
 assert.equal(result.directBase44Invocations,result.filteredGatewayBase44Invocations);
});
test('gateway NEVER silently discards unknown beta callback types to inflate savings',()=>{
 const result=estimateGreenWebhookInvocationCredits({
  incomingEventsPerDay:100,buttonClicksPerDay:5,unknownEventsPerDay:70
 });
 assert.equal(result.filteredGatewayBase44Invocations,2250);
 assert.equal(result.filteredKnownNonButtonsPerMonth,750);
 assert.equal(result.gatewayEstimatedBase44Credits,22.5);
});
test('estimate supports different verified workspace invocation rate and actual month length',()=>{
 const result=estimateGreenWebhookInvocationCredits({
  incomingEventsPerDay:30,buttonClicksPerDay:4,
  unknownEventsPerDay:1,days:31,invocationsPerCredit:50
 });
 assert.equal(result.directBase44Invocations,930);
 assert.equal(result.filteredGatewayBase44Invocations,155);
 assert.equal(result.directEstimatedCredits,18.6);
 assert.equal(result.gatewayEstimatedBase44Credits,3.1);
});
test('invalid and obviously impossible estimates fail closed rather than invent negative credits',()=>{
 const base={incomingEventsPerDay:25,buttonClicksPerDay:3,unknownEventsPerDay:2};
 for(const invalid of [
  {incomingEventsPerDay:-1},{buttonClicksPerDay:30},{unknownEventsPerDay:23},
  {days:0},{days:367},{invocationsPerCredit:0},
  {buttonClicksPerDay:1.5},{incomingEventsPerDay:Infinity},
  {unknownEventsPerDay:NaN},{incomingEventsPerDay:1_000_001}
 ]){
  assert.throws(()=>estimateGreenWebhookInvocationCredits({...base,...invalid}),
   /Invalid documented webhook forecast/);
 }
});
test('forecast is purely client-side, collapsed and never triggers an integration',()=>{
 const model=fs.readFileSync('src/lib/whatsappWebhookCreditModel.js','utf8');
 const ui=fs.readFileSync('src/components/admin/notifications/WhatsAppWebhookCreditsEstimator.jsx','utf8');
 const parent=fs.readFileSync('src/components/admin/notifications/WhatsAppQueueSettings.jsx','utf8');
 assert.match(ui,/estimateGreenWebhookInvocationCredits/);
 assert.match(ui,/<details className="rounded border p-3 text-sm"/);
 assert.doesNotMatch(parent,/<WhatsAppWebhookCreditsEstimator\s*\/>/);
 assert.match(parent,/ניהול שליחה והודעות/);
 assert.doesNotMatch(ui,/base44\.functions\.invoke|fetch\(|setInterval|WebSocket|localStorage/);
 assert.doesNotMatch(model,/base44\.functions\.invoke|fetch\(|setInterval|WebSocket/);
});
