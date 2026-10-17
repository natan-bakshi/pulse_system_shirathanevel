import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';
import {whatsappEnqueueReceiptState,isWhatsAppEnqueueConfirmed} from '../base44/shared/whatsappReceipt.ts';

function makeHandler({receipt={success:true,queued:true,status:'queued',jobId:'job-one'},tokens=[],firebaseFailures=0,firebaseReady=true}={}){
 let handler;const sentWA=[],sentFCM=[];
 const users=[{id:'admin-recipient',phone:'0501234567',email:'admin@example.test',
   whatsapp_enabled:true,push_tokens:tokens}];
 const client={auth:{me:async()=>({id:'system-owner',role:'admin'})},
   asServiceRole:{entities:{User:{list:async()=>users,update:async()=>({})}}}};
 const moduleCode=esbuild.transformSync(fs.readFileSync('base44/functions/sendPushNotification/entry.ts','utf8'),{
   loader:'ts',format:'cjs',target:'es2022'
 }).code;
 class MockResponse{constructor(raw,options={}){this.body=JSON.parse(raw);this.status=options.status||200;}}
 vm.runInNewContext(moduleCode,{
   module:{exports:{}},exports:{},Response:MockResponse,
   Deno:{serve:fn=>handler=fn,env:{get:()=>''}},
   console:{error:()=>{}},
   require:name=>{
     if(name.startsWith('npm:@base44/sdk'))return {createClientFromRequest:()=>client};
     if(name.startsWith('npm:firebase-admin')&&name.includes('/app'))return {
       getApps:()=>firebaseReady?[{}]:[],getApp:()=>({}),initializeApp:()=>({}),cert:()=>({})
     };
     if(name.startsWith('npm:firebase-admin')&&name.includes('/messaging'))return {
       getMessaging:()=>({sendEachForMulticast:async(params)=>{
         sentFCM.push(params);
         const responses=params.tokens.map((_,i)=>i<firebaseFailures?
           {success:false,error:{code:'synthetic-failure'}}:{success:true});
         return {successCount:responses.filter(x=>x.success).length,
           failureCount:responses.filter(x=>!x.success).length,responses};
       }})
     };
     if(name.endsWith('whatsappSend.ts'))return {sendWhatsAppText:async()=>{
       sentWA.push('outbox-enqueue');return receipt;
     }};
     if(name.endsWith('whatsappReceipt.ts'))return {
       whatsappEnqueueReceiptState,isWhatsAppEnqueueConfirmed
     };
     throw Error('Unexpected import '+name);
   }
 });
 return {invoke:async({sendWhatsApp=true}={})=>handler({
   method:'POST',json:async()=>({userIds:['admin-recipient'],title:'Reminder',
     body:'Body',sendWhatsApp,data:{}})
 }),sentWA,sentFCM};
}
test('no Firebase token NEVER hides an UNKNOWN WhatsApp queue receipt',async()=>{
 const x=makeHandler({receipt:{status:'unknown',success:true,queued:false,jobId:'unknown'}});
 const r=await x.invoke();
 assert.equal(r.status,200);
 assert.equal(r.body.success,false);
 assert.equal(r.body.partial_failure,true);
 assert.equal(r.body.manual_review_required,true);
 assert.equal(r.body.whatsapp.count,1);
 assert.equal(r.body.whatsapp.confirmed,0);
 assert.equal(r.body.whatsapp.failed,1);
 assert.equal(r.body.whatsapp.results[0].state,'unknown');
 assert.equal(r.body.push.noTokens,true);
 assert.equal(x.sentWA.length,1);assert.equal(x.sentFCM.length,0);
});
test('no Firebase token with queued WhatsApp reports honest partial-channel success',async()=>{
 const x=makeHandler();
 const r=await x.invoke();
 assert.equal(r.body.success,true);
 assert.equal(r.body.partial_failure,false);
 assert.equal(r.body.whatsapp.confirmed,1);
 assert.equal(r.body.push.noTokens,true);
 assert.equal(x.sentWA.length,1);
});
test('when FCM token delivery fails response reports partial failure despite queued WhatsApp',async()=>{
 const x=makeHandler({tokens:['synthetic-token'],firebaseFailures:1});
 const r=await x.invoke();
 assert.equal(r.body.success,false);
 assert.equal(r.body.partial_failure,true);
 assert.equal(r.body.push.failureCount,1);
 assert.equal(r.body.whatsapp.confirmed,1);
 assert.equal(x.sentFCM.length,1);
});
test('missing Firebase secret does not block independent WhatsApp enqueue with no Push tokens',async()=>{
 const x=makeHandler({firebaseReady:false,tokens:[]});
 const r=await x.invoke();
 assert.equal(r.status,200);
 assert.equal(r.body.success,true,'WhatsApp is independent from FCM configuration');
 assert.equal(r.body.whatsapp.confirmed,1);
 assert.equal(x.sentWA.length,1);
 assert.equal(x.sentFCM.length,0);
});
test('missing Firebase secret with Push tokens reports Push failure but keeps WhatsApp receipt',async()=>{
 const x=makeHandler({firebaseReady:false,tokens:['token-one']});
 const r=await x.invoke();
 assert.equal(r.status,200);
 assert.equal(r.body.success,false);
 assert.equal(r.body.partial_failure,true);
 assert.equal(r.body.push.failureCount,1);
 assert.equal(r.body.whatsapp.confirmed,1);
 assert.equal(x.sentWA.length,1);
 assert.equal(x.sentFCM.length,0);
});
test('caller opting out of WhatsApp does not create a new WhatsApp Outbox message',async()=>{
 const x=makeHandler({tokens:[]});
 const r=await x.invoke({sendWhatsApp:false});
 assert.equal(r.body.success,true);
 assert.equal(r.body.whatsapp.count,0);
 assert.equal(x.sentWA.length,0);
});
