import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';

function setup({actor={role:'admin',email:'natib8000@gmail.com'},key=true,connected=true,records=[]}={}) {
  let checks=0;
  const store=records.map((value,i)=>({id:'record-'+i,setting_key:'whatsapp_default_provider',setting_value:value}));
  const client={
    auth:{me:async()=>actor},
    asServiceRole:{entities:{AppSettings:{
      filter:async()=>store,
      create:async(fields)=>{store.push({id:'new',...fields});return store.at(-1);},
      update:async(id,fields)=>{Object.assign(store.find(r=>r.id===id),fields);}
    }}}
  };
  let handler;
  const transformed=esbuild.transformSync(fs.readFileSync('base44/functions/WhatsApp_ProviderConfig/entry.ts','utf8'),{loader:'ts',format:'cjs',target:'es2022'}).code;
  const sandbox={
    exports:{},module:{exports:{}},console:{log:()=>{},error:()=>{}},
    Deno:{serve(fn){handler=fn;},env:{get(name){
      if(name==='WASENDER_API_KEY')return key?'synthetic-key':undefined;
      if(name.startsWith('GREEN_API_'))return 'synthetic-green';
      return undefined;
    }}},
    Response:{json(body,{status=200}={}){return {body,status};}},
    require(name){
      if(name.startsWith('npm:@base44/sdk'))return {createClientFromRequest:()=>client};
      if(name.endsWith('whatsappProviderConfig.ts'))return {
        WHATSAPP_PROVIDER_SETTING_KEY:'whatsapp_default_provider',
        resolveWhatsAppProvider:async()=>store.at(0)?.setting_value||'green'
      };
      if(name.endsWith('wasenderSend.ts'))return {
        isWasenderConfigured:()=>key,
        checkWasenderSessionStatus:async()=>{checks++;return {status:connected?'connected':'need_scan',connected};}
      };
      throw Error('Unexpected import: '+name);
    }
  };
  vm.runInNewContext(transformed,sandbox,{filename:'WhatsApp_ProviderConfig/entry.ts'});
  async function invoke(action,provider){
    return await handler({method:'POST',json:async()=>({action,provider})});
  }
  return {invoke,store,get checks(){return checks;}};
}

test('only system owner can change the provider',async()=>{
  const a=setup({actor:{role:'admin',email:'other@example.com'}});
  const b=await a.invoke('set','wasender');
  assert.equal(b.status,403);
  assert.equal(a.store.length,0);
  const c=setup({actor:{role:'supplier',email:'natib8000@gmail.com'}});
  assert.equal((await c.invoke('set','wasender')).status,403);
});
test('invalid provider is rejected without any write',async()=>{
  const ctx=setup();
  assert.equal((await ctx.invoke('set','invalid')).status,400);
  assert.equal(ctx.store.length,0);
});
test('cannot activate Wasender without a session key',async()=>{
  const ctx=setup({key:false});
  assert.equal((await ctx.invoke('set','wasender')).status,409);
  assert.equal(ctx.store.length,0);
});
test('cannot activate Wasender without a connected session',async()=>{
  const ctx=setup({connected:false});
  const result=await ctx.invoke('set','wasender');
  assert.equal(result.status,409);
  assert.equal(result.body.connectionStatus,'need_scan');
  assert.equal(ctx.store.length,0);
});
test('connected session is validated before saving and can later revert to Green',async()=>{
  const ctx=setup();
  const save=await ctx.invoke('set','wasender');
  assert.equal(save.status,200);
  assert.equal(save.body.provider,'wasender');
  assert.equal(ctx.store.length,1);
  assert.equal(ctx.store[0].setting_value,'wasender');
  assert.equal(ctx.checks,1);
  assert.equal((await ctx.invoke('get')).body.provider,'wasender');
  assert.equal((await ctx.invoke('set','green')).body.provider,'green');
  assert.equal(ctx.store.length,1);
  assert.equal(ctx.store[0].setting_value,'green');
});
test('duplicate settings refuse changes instead of selecting ambiguously',async()=>{
  const ctx=setup({records:['green','wasender']});
  assert.equal((await ctx.invoke('set','green')).status,409);
});
test('get never returns the secret',async()=>{
  const ctx=setup();
  const response=await ctx.invoke('get');
  assert.equal(response.status,200);
  assert.equal(response.body.provider,'green');
  assert.equal(JSON.stringify(response.body).includes('synthetic-key'),false);
});
