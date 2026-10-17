import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';

function harness(pushResult){
 const invokes=[],warnings=[];
 const client={
  auth:{me:async()=>({role:'admin',id:'owner'})},
  asServiceRole:{
   entities:{
    Event:{get:async()=>({id:'event-test',event_name:'Sample',event_date:'2026-11-20',event_time:'10:00'})},
    EventService:{get:async()=>({id:'es-test',supplier_arrival_time:''})},
    Supplier:{list:async()=>[{id:'supplier-test',contact_emails:['one@example.test'],phone:'0501234567'}]},
    User:{list:async()=>[{id:'user-test',email:'one@example.test',phone:'0501234567',role:'supplier'}]}
   },
   functions:{invoke:async(name,payload)=>{invokes.push({name,payload});return {data:pushResult};}}
  }
 };
 const js=esbuild.transformSync(fs.readFileSync('base44/functions/notifySupplierAssignment/entry.ts','utf8'),{
   loader:'ts',format:'cjs',target:'es2022'
 }).code;
 let handler;
 class MockResponse{constructor(body,{status=200}={}){this.body=JSON.parse(body);this.status=status}}
 MockResponse.json=(data,{status=200}={})=>({body:data,status});
 vm.runInNewContext(js,{
   module:{exports:{}},exports:{},
   Deno:{serve:fn=>handler=fn},Response:MockResponse,
   console:{log:()=>{},error:(...args)=>warnings.push(args)},
   require:name=>{
     if(name.startsWith('npm:@base44/sdk'))return {createClientFromRequest:()=>client};
     if(name.endsWith('eventName.ts'))return {getEventDisplayName:()=> 'Sample'};
     throw Error('Unexpected require '+name);
   }
 });
 return {invoke:async()=>handler({method:'POST',json:async()=>({
   supplierIds:['supplier-test'],eventId:'event-test',eventServiceId:'es-test',serviceName:'Band'
 })}),invokes,warnings};
}
test('an FCM failure is NOT flattened into a successful assignment Push response',async()=>{
 const x=harness({success:false,partial_failure:true,push:{successCount:0,failureCount:1}});
 const r=await x.invoke();
 assert.equal(r.status,200);
 assert.equal(r.body.success,false);
 assert.equal(r.body.partial_failure,true);
 assert.equal(x.invokes[0].name,'sendPushNotification');
 assert.equal(x.invokes[0].payload.sendWhatsApp,false);
});
test('registered user with no Firebase token is shown as a Push verification problem',async()=>{
 const x=harness({success:true,push:{successCount:0,failureCount:0,noTokens:true}});
 const r=await x.invoke();
 assert.equal(r.body.success,false);
 assert.equal(r.body.partial_failure,true);
});
test('successful FCM reports are not downgraded or retried',async()=>{
 const x=harness({success:true,push:{successCount:1,failureCount:0}});
 const r=await x.invoke();
 assert.equal(r.body.success,true);
 assert.equal(r.body.partial_failure,false);
 assert.equal(x.invokes.length,1);
});
test('assignment frontend informs the admin about an unconfirmed Push instead of silently logging it',()=>{
 const src=fs.readFileSync('src/pages/EventDetails.jsx','utf8');
 assert.match(src,/if\(response\?\.data\?\.success===false\)assignmentPushWarning=/);
 assert.match(src,/if\(assignmentPushWarning\)alert\(assignmentPushWarning\)/);
});
