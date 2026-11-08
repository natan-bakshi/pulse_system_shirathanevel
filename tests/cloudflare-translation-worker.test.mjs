import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const compiled=await build({
 entryPoints:['cloudflare/translation-worker/src/index.mjs'],
 bundle:true,platform:'neutral',format:'esm',write:false,
 plugins:[{name:'mock-jose',setup(plugin){
  plugin.onResolve({filter:/^jose$/},()=>({path:'jose',namespace:'virtual'}));
  plugin.onLoad({filter:/.*/,namespace:'virtual'},()=>({contents:[
   "export const createRemoteJWKSet=()=>({});",
   "export async function jwtVerify(token,_keys,_opts){",
   " if(token!=='signed-access-token')throw Error('Invalid signature');",
   " return {payload:{sub:'verified-subject',email:'admin@example.com'}};",
   "}"
  ].join('\n')}));
 }}]
});
const worker=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const {validTranslation}=worker.__test;

const origin='https://pulse-system.base44.app';
function setup({email=true,output='A four-piece live band, performing for 45 minutes.'}={}){
 const records=new Map();
 const calls=[];
 const env={
  ALLOWED_ORIGIN:origin,ACCESS_TEAM:'example-team',
  ACCESS_AUD:'example-audience',ALLOWED_EMAILS:email?'admin@example.com':'nobody@example.com',
  LIMITS:{get:async key=>records.get(key)||null,put:async(key,value)=>{records.set(key,value);}},
  AI:{run:async(model,request)=>{
   calls.push({model,request});
   return {choices:[{message:{content:JSON.stringify({translation:output})}}]};
  }}
 };
 const send=(body,config={})=>worker.default.fetch(new Request(
  'https://cloudflare.example/translate',{
   method:config.method||'POST',
   headers:{Origin:config.origin||origin,
    'Cf-Access-Jwt-Assertion':config.noToken?'':(config.token||'signed-access-token'),
    'Content-Type':'application/json'},
   body:JSON.stringify(body)
  }),env);
 return {send,env,calls,records};
}
test('integrity validation rejects changed numbers, links, HTML tags and placeholders',()=>{
 assert.equal(validTranslation('4 נגנים במשך 45 דקות','4 musicians for 45 minutes'),true);
 assert.equal(validTranslation('4 נגנים','5 musicians'),false);
 assert.equal(validTranslation('55 מקומות','55-seat vehicle'),true);
 assert.equal(validTranslation('20% מקדמה','25% deposit'),false);
 assert.equal(validTranslation('<p>שלום</p>','<p>Hello</p>'),true);
 assert.equal(validTranslation('<p>שלום</p>','<div>Hello</div>'),false);
 assert.equal(validTranslation('קישור https://a.test/xyz','Link https://b.test/xyz'),false);
 assert.equal(validTranslation('שלום {{family}}','Hello {{other}}'),false);
 assert.equal(validTranslation('שלום','<script>alert(1)</script>'),false);
});
test('protected worker requires allowed origin, access token and approved email before AI use',async()=>{
 const f=setup();
 const input={kind:'service_name',source:'4 נגנים'};
 const invalidOrigin=await f.send(input,{origin:'https://evil.test'});
 assert.equal(invalidOrigin.status,403);
 const noToken=await f.send(input,{noToken:true});
 assert.equal(noToken.status,401);
 const badToken=await f.send(input,{token:'invalid'});
 assert.equal(badToken.status,401);
 assert.equal(f.calls.length,0);
 const disallowed=setup({email:false});
 assert.equal((await disallowed.send(input)).status,401);
 assert.equal(disallowed.calls.length,0);
});
test('authorized output is a draft only and does not write business data',async()=>{
 const f=setup({output:'4 musicians'});
 const r=await f.send({kind:'service_name',source:'4 נגנים'});
 const payload=await r.json();
 assert.equal(r.status,200);
 assert.equal(payload.translation,'4 musicians');
 assert.equal(payload.approved,false);
 assert.equal(payload.reviewRequired,true);
 assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].model,'@cf/google/gemma-4-26b-a4b-it');
 assert.equal(f.records.size,1,'only the quota counter is persisted in KV');
});
test('free quota fails closed and never calls paid models',async()=>{
 const f=setup({output:'4 musicians'});
 const payload={kind:'service_name',source:'4 נגנים'};
 for(let i=0;i<30;i++)assert.equal((await f.send(payload)).status,200);
 const exhausted=await f.send(payload);
 assert.equal(exhausted.status,429);
 assert.equal(f.calls.length,30);
});
test('invalid models and untrusted inputs fail before any business output',async()=>{
 const f=setup({output:'5 musicians'});
 assert.equal((await f.send({kind:'service_name',source:'4 נגנים'})).status,422);
 assert.equal((await f.send({kind:'payment_token',source:'4 נגנים'})).status,400);
 assert.equal((await f.send({kind:'service_name',source:'4 נגנים',role:'admin'})).status,400);
 assert.equal(f.calls.length,1);
});
test('missing free-tier KV disables service, never bypasses the quota gate',async()=>{
 const f=setup();delete f.env.LIMITS;
 assert.equal((await f.send({kind:'service_name',source:'4 נגנים'})).status,503);
 assert.equal(f.calls.length,0);
});
