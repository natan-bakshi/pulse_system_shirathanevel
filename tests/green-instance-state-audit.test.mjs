import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {inspectGreenInstanceStateReadOnly}
 from '../base44/shared/greenInstanceStateAudit.ts';

const setup={instanceId:'9903183013',
 apiToken:'synthetic-green-owner-api-token-1234567890'};
function green(state,extra={}){
 const data={stateInstance:state,wid:'972500000000@c.us',
  webhookUrl:'https://private.example.test/secret',...extra};
 return new Response(JSON.stringify(data),{
  status:200,headers:{'Content-Type':'application/json'}
 });
}
test('one owner-click GET checks same Green instance state without sending, changing settings or revealing phone',async()=>{
 const seen=[];
 const result=await inspectGreenInstanceStateReadOnly({
  ...setup,fetchFn:async(url,init)=>{
   seen.push({url,init});
   return green('authorized');
  }
 });
 assert.equal(seen.length,1);
 assert.match(seen[0].url,/\/waInstance9903183013\/getStateInstance\//);
 assert.equal(seen[0].init.method,'GET');
 assert.equal(seen[0].init.redirect,'manual');
 assert.equal(seen[0].init.body,undefined);
 assert.equal(result.state,'authorized');
 assert.equal(result.authorized,true);
 assert.equal(result.providerReadCalls,1);
 assert.equal(result.noMessagesSent,true);
 assert.equal(result.noSettingsWritten,true);
 assert.equal(result.noBusinessDatabaseReads,true);
 const publicText=JSON.stringify(result);
 for(const secret of [setup.apiToken,setup.instanceId,
  '972500000000','private.example.test','wid'])
  assert.equal(publicText.includes(secret),false);
});
test('reconnecting/blocked/starting/suspended Green account is never reported ready',async()=>{
 for(const state of ['notAuthorized','blocked','sleepMode','starting','suspended']){
  const result=await inspectGreenInstanceStateReadOnly({
   ...setup,fetchFn:async()=>green(state)});
  assert.equal(result.state,state);
  assert.equal(result.authorized,false);
 }
});
test('invalid provider status, unexpected redirects, forged origin, auth failure and unknown payload fail closed without leaking API keys',async()=>{
 for(const response of [
  ()=>green('unexpectedConnected'),
  ()=>new Response('',{status:302,headers:{Location:'https://evil.example/'}}),
  ()=>new Response('invalid',{status:200}),
  ()=>new Response(JSON.stringify({stateInstance:'authorized',raw:'x'.repeat(2048)}),
   {status:200}),
  ()=>new Response('no',{status:401})
 ]){
  await assert.rejects(inspectGreenInstanceStateReadOnly({...setup,
   fetchFn:async()=>response()}),/green_instance_state_unavailable/);
 }
 for(const apiBaseUrl of [
  'http://api.green-api.com','https://evil.example',
  'https://api.green-api.com.evil.example',
  'https://token@api.green-api.com'
 ])await assert.rejects(inspectGreenInstanceStateReadOnly({
  ...setup,apiBaseUrl,fetchFn:async()=>{throw new Error('should not execute')}
 }),/green_instance_origin_unavailable/);
});
test('on-demand backend action remains owner-authenticated; UI never uses a refresh timer or new background cron',()=>{
 const backend=fs.readFileSync('base44/functions/WhatsAppQueueAdmin/entry.ts','utf8');
 const ui=fs.readFileSync('src/components/admin/notifications/WhatsAppQueueSettings.jsx','utf8');
 assert.match(backend,/actor\.role!=='admin'/);
 assert.match(backend,/OWNER_EMAIL/);
 assert.match(backend,/action==='greenInstanceStateAudit'/);
 assert.match(backend,/inspectGreenInstanceStateReadOnly/);
 assert.match(ui,/run\('greenInstanceStateAudit'\)/);
 assert.match(ui,/greenConnection\.state/);
 assert.match(ui,/onClick=\{\(\)=>run\('greenInstanceStateAudit'\)\}/);
 assert.doesNotMatch(ui,/setInterval\(|setTimeout\(/);
});
