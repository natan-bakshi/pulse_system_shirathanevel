import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {summarizeGreenWebhookSettings,inspectGreenWebhookSettingsReadOnly,summarizeGreenWebhookAuditFailure}
 from '../base44/shared/greenWebhookSettingsAudit.ts';

const SETTINGS={
 wid:'972500000000@c.us',webhookUrl:'https://PRIVATE.example.test/secret-path?token=TOP-SECRET',
 webhookUrlToken:'SECRET-OWNER-WEBHOOK-TOKEN',
 incomingWebhook:'yes',outgoingWebhook:'yes',outgoingMessageWebhook:'no',
 outgoingAPIMessageWebhook:'yes',stateWebhook:'yes',deviceWebhook:'no',
 pollMessageWebhook:'no',editedMessageWebhook:'no',deletedMessageWebhook:'no',
 incomingCallWebhook:'yes',incomingMessageStatusWebhook:'no',
 delaySendMessagesMilliseconds:7000,
 apiTokenInstance:'MOST-PRIVATE-API-TOKEN',notes:'PRIVATE-CUSTOMER-NOTES'
};
const config={instanceId:'9903183013',apiToken:'mockGreenOnlyToken-SENTINEL-123456789'};
function response(data=SETTINGS,status=200){
 return {ok:status===200,status,
  headers:{get:key=>key==='content-length'?String(JSON.stringify(data).length):null},
  text:async()=>JSON.stringify(data)};
}
test('single authorized Green GetSettings GET reveals only non-secret configuration flags',async()=>{
 let called=0,options={};
 const report=await inspectGreenWebhookSettingsReadOnly({
  ...config,fetchFn:async(url,init)=>{
   called++;options={url,init};
   return response();
  }
 });
 assert.equal(called,1);
 assert.equal(options.init.method,'GET');
 assert.equal(options.init.redirect,'error');
 assert.equal(options.init.cache,'no-store');
 assert.equal(options.init.body,undefined);
 assert.ok(options.url.startsWith('https://api.green-api.com/waInstance9903183013/getSettings/'));
 assert.equal(report.webhookConfigured,true);
 assert.equal(report.webhookTokenConfigured,true);
 assert.equal(report.endpointProtocol,'https');
 assert.equal(report.webhookDeliveryMode,'push_configured');
 assert.equal(report.incomingNotificationsEnabled,true);
 assert.equal(report.notificationFlags.outgoingWebhook,'yes');
 assert.equal(report.notificationFlags.incomingCallWebhook,'yes');
 assert.equal(report.activeCategories,5);
 assert.equal(report.sendDelayMs,7000);
 assert.equal(report.existingWebhookMustBePreserved,true);
 assert.equal(report.safeToReplaceWebhookUrl,false);
 assert.equal(report.providerReadCalls,1);
 assert.equal(report.noDatabaseQueries,true);
 assert.equal(report.noMessagesSent,true);
 assert.equal(report.webhookSettingChangesMade,false);
 assert.equal(report.accountButtonCapabilityNotProven,true);
 const serialized=JSON.stringify(report);
 for(const secret of [
  SETTINGS.wid,SETTINGS.webhookUrl,SETTINGS.webhookUrlToken,
  'PRIVATE.example.test','secret-path','TOP-SECRET','MOST-PRIVATE-API-TOKEN',
  'PRIVATE-CUSTOMER-NOTES','mockGreenOnlyToken-SENTINEL-123456789',
  '9903183013'
 ])assert.equal(serialized.includes(secret),false,secret);
});
test('missing Green url represents polling or unconfigured, never falsely proves incoming capability',()=>{
 const report=summarizeGreenWebhookSettings({
  webhookUrl:'',webhookUrlToken:'',incomingWebhook:'no',
  outgoingWebhook:'yes',delaySendMessagesMilliseconds:3500
 });
 assert.equal(report.webhookConfigured,false);
 assert.equal(report.webhookDeliveryMode,'polling_or_not_configured');
 assert.equal(report.incomingNotificationsEnabled,false);
 assert.equal(report.existingWebhookMustBePreserved,false);
 assert.ok(report.riskFlags.includes('incoming_webhook_not_confirmed_enabled'));
 assert.ok(report.riskFlags.includes('webhook_auth_token_not_configured'));
 assert.equal(report.notificationFlags.outgoingAPIMessageWebhook,'unknown');
 assert.equal(report.sendDelayMs,3500);
});
test('non-HTTPS existing destination is flagged but never leaked to browser',()=>{
 const report=summarizeGreenWebhookSettings({
  ...SETTINGS,webhookUrl:'http://insecure.local/super-secret-path'
 });
 assert.equal(report.endpointProtocol,'non_https_or_invalid');
 assert.equal(report.existingWebhookMustBePreserved,true);
 assert.ok(report.riskFlags.includes('webhook_url_not_secure_https'));
 assert.equal(JSON.stringify(report).includes('insecure.local'),false);
});
test('invalid instance or token is rejected without any provider invocation',async()=>{
 const invalid=[
  {instanceId:'123'}, {instanceId:'9903183013/SETTINGS'},
  {instanceId:'9903183013',apiToken:'x'},
  {apiToken:'validButWrong/token-in-path'},
  {apiToken:' x '.repeat(15)}
 ];
 for(const fields of invalid){
  let called=0;
  await assert.rejects(inspectGreenWebhookSettingsReadOnly({
   ...config,...fields,fetchFn:async()=>{called++;return response();}
  }),err=>err.code==='green_settings_unavailable');
  assert.equal(called,0);
 }
});
test('provider failure, oversized reply and unexpected body fail closed without leaking raw error',async()=>{
 for(const value of [
  async()=>response({...SETTINGS,webhookUrl:'https://secret.invalid'},500),
  async()=>{throw Error('SECRET-THROW-PRIVILEGED-API-KEY');},
  async()=>response({webhookUrl:'x'.repeat(33000)}),
  async()=>({ok:true,status:200,headers:{get:()=>null},text:async()=>'{'}),
  async()=>response([])
 ]){
  let called=0;
  await assert.rejects(inspectGreenWebhookSettingsReadOnly({
   ...config,fetchFn:async(url,init)=>{called++;return value(url,init);}
  }),err=>{
   assert.equal(err.code,'green_settings_unavailable');
   assert.equal(JSON.stringify(err).includes('SECRET-THROW'),false);
   return true;
  });
  assert.equal(called,1);
 }
});
test('missing webhook URL type and provider flag nonsense never become trusted positive flags',()=>{
 assert.throws(()=>summarizeGreenWebhookSettings({webhookUrl:{url:'https://bad'}}));
 const invalid=summarizeGreenWebhookSettings({webhookUrl:'',incomingWebhook:true,
  outgoingWebhook:'YES',delaySendMessagesMilliseconds:'7000'});
 assert.equal(invalid.notificationFlags.incomingWebhook,'unknown');
 assert.equal(invalid.notificationFlags.outgoingWebhook,'unknown');
 assert.equal(invalid.incomingNotificationsEnabled,false);
 assert.equal(invalid.sendDelayMs,null);
});
test('sanitized codes distinguish Green auth, unreachable route, rate-limit and provider downtime with ONE GET',async()=>{
 const cases=[
  [401,'provider_auth_rejected'],[403,'provider_auth_rejected'],
  [404,'provider_instance_not_found'],[429,'provider_rate_limited'],
  [503,'provider_server_error'],[418,'provider_http_error']
 ];
 for(const [status,expected] of cases){
  let calls=0;
  await assert.rejects(inspectGreenWebhookSettingsReadOnly({
   ...config,fetchFn:async()=>{calls++;return response({private:'NEVER_LEAK'},status);}
  }),err=>{
   const safe=summarizeGreenWebhookAuditFailure(err);
   assert.equal(err.code,'green_settings_unavailable');
   assert.equal(safe.diagnosticCode,expected);
   assert.ok(safe.error.includes(expected));
   assert.equal(safe.noMessagesSent,true);
   assert.equal(safe.webhookSettingChangesMade,false);
   assert.equal(JSON.stringify(safe).includes('NEVER_LEAK'),false);
   return true;
  });
  assert.equal(calls,1,'No automatic retry for HTTP '+status);
 }
});
test('network errors are classified safely and never return raw errors or credentials',async()=>{
 let calls=0;
 await assert.rejects(inspectGreenWebhookSettingsReadOnly({
  ...config,fetchFn:async()=>{calls++;throw Error('SECRET-ORIGIN TOKEN SECRET');}
 }),err=>{
  const safe=summarizeGreenWebhookAuditFailure(err);
  assert.equal(safe.diagnosticCode,'provider_connection_unavailable');
  assert.equal(JSON.stringify(safe).includes('SECRET-ORIGIN'),false);
  return true;
 });
 assert.equal(calls,1);
 const unknown=summarizeGreenWebhookAuditFailure({diagnosticCode:'UNTRUSTED_SECRET_VALUE'});
 assert.equal(unknown.diagnosticCode,'unexpected_failure');
 assert.equal(JSON.stringify(unknown).includes('UNTRUSTED'),false);
});
test('owner read-only audit supports only verified Green instance apiUrl origin and blocks SSRF',async()=>{
 let calls=0;
 const data=await inspectGreenWebhookSettingsReadOnly({
  ...config,apiBaseUrl:'https://7103.api.greenapi.com/',
  fetchFn:async(url,init)=>{
   calls++;
   assert.ok(url.startsWith('https://7103.api.greenapi.com/waInstance9903183013/getSettings/'));
   assert.equal(init.method,'GET');
   return response();
  }
 });
 assert.equal(data.providerReadCalls,1);
 assert.equal(calls,1);
 for(const bad of [
  'http://7103.api.greenapi.com','https://7103.api.greenapi.com/secret',
  'https://7103.api.greenapi.com.evil.example',
  'https://api.green-api.com@evil.example',
  'https://7103.api.greenapi.com:1234',
  'https://7103.api.greenapi.com/?instance=1',
  'https://localhost','file:///etc/passwd'
 ]){
  await assert.rejects(inspectGreenWebhookSettingsReadOnly({
   ...config,apiBaseUrl:bad,fetchFn:async()=>{calls++;return response();}
  }),err=>summarizeGreenWebhookAuditFailure(err).diagnosticCode==='invalid_api_host',bad);
 }
 assert.equal(calls,1,'invalid host must never initiate an HTTP request');
});
test('server abort is reported as provider_timeout and does not retry',async()=>{
 let called=0;
 await assert.rejects(inspectGreenWebhookSettingsReadOnly({
  ...config,timeoutMs:500,
  fetchFn:async(_url,init)=>{
   called++;
   return new Promise((resolve,reject)=>{
    init.signal.addEventListener('abort',()=>reject(Error('PRIVATE-RAW-ABORT')),{once:true});
   });
  }
 }),err=>{
  assert.equal(summarizeGreenWebhookAuditFailure(err).diagnosticCode,'provider_timeout');
  return true;
 });
 assert.equal(called,1);
});
test('owner action retains server-only credentials, no automatic calls and safe diagnostic response',()=>{
 const backend=fs.readFileSync('base44/functions/WhatsAppQueueAdmin/entry.ts','utf8');
 assert.match(backend,/apiBaseUrl:Deno\.env\.get\('GREEN_API_URL'\)/);
 assert.match(backend,/summarizeGreenWebhookAuditFailure\(error\)/);
 assert.match(backend,/action==='greenWebhookSettingsAudit'/);
 assert.doesNotMatch(backend,/getSettings\/[\s\S]{0,100}SetSettings/);
});
test('UI only triggers provider GET on manual owner click, never dashboard refresh or settings render',()=>{
 const ui=fs.readFileSync('src/components/admin/notifications/WhatsAppQueueSettings.jsx','utf8');
 const admin=fs.readFileSync('base44/functions/WhatsAppQueueAdmin/entry.ts','utf8');
 const module=fs.readFileSync('base44/shared/greenWebhookSettingsAudit.ts','utf8');
 assert.match(ui,/onClick=\{\(\)=>run\('greenWebhookSettingsAudit'\)\}/);
 assert.match(ui,/action==='greenWebhookSettingsAudit'/);
 assert.match(admin,/action==='greenWebhookSettingsAudit'/);
 assert.doesNotMatch(ui,/useEffect\([\s\S]{0,200}greenWebhookSettingsAudit/);
 assert.doesNotMatch(module,/\/setSettings\//i);
 assert.doesNotMatch(module,/\.updateMany\(|\.create\(|\.delete\(/);
 assert.match(module,/\/getSettings\//);
});
