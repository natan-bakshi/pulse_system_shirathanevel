import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WHATSAPP_PROVIDER_SETTING_KEY,resolveWhatsAppProvider,hasSelectedWhatsAppProviderCredentials
} from '../base44/shared/whatsappProviderConfig.ts';
const env={GREEN_API_INSTANCE_ID:'synthetic',GREEN_API_TOKEN:'synthetic',WASENDER_API_KEY:'synthetic'};
globalThis.Deno={env:{get:key=>env[key]}};
test.after(()=>delete globalThis.Deno);
function appClient(provider=null,fail=false) {
 const records=provider===null?[]:[{id:'provider',setting_key:WHATSAPP_PROVIDER_SETTING_KEY,setting_value:provider}];let count=0;
 return {get reads(){return count;},asServiceRole:{entities:{AppSettings:{
  filter:async(query,sort,limit)=>{count++;assert.deepEqual(query,{setting_key:'whatsapp_default_provider'});
   assert.equal(sort,'-created_date');assert.equal(limit,3);
   if(fail)throw Error('database unavailable');return records;}
 }}}};
}
test('missing provider selection preserves previous Green API default',async()=>{
 const client=appClient();
 assert.equal(await resolveWhatsAppProvider(client),'green');
 assert.equal(await hasSelectedWhatsAppProviderCredentials(client),true);
 assert.equal(client.reads,1);
});
test('Wasender selected centrally and cached within one backend invocation',async()=>{
 const client=appClient('wasender');
 assert.equal(await resolveWhatsAppProvider(client),'wasender');
 assert.equal(await hasSelectedWhatsAppProviderCredentials(client),true);
 assert.equal(client.reads,1);
});
test('Green selection overrides old env without changing source modules',async()=>{
 env.WHATSAPP_ACTIVE_PROVIDER='wasender';
 const client=appClient('green');
 assert.equal(await resolveWhatsAppProvider(client),'green');
 delete env.WHATSAPP_ACTIVE_PROVIDER;
});
test('invalid provider never silently routes to another provider',async()=>{
 await assert.rejects(resolveWhatsAppProvider(appClient('unsafe')),/Unsupported/);
});
test('database outage fails closed',async()=>{
 await assert.rejects(resolveWhatsAppProvider(appClient(null,true)),/database unavailable/);
});
test('Wasender missing session key is explicitly not configured',async()=>{
 delete env.WASENDER_API_KEY;
 assert.equal(await hasSelectedWhatsAppProviderCredentials(appClient('wasender')),false);
 env.WASENDER_API_KEY='synthetic';
});
