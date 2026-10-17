import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import esbuild from 'esbuild';
import {delayUntilNextSendMs,providerIntervalMs,lastDispatchForProvider} from '../base44/shared/whatsappQueueWorker.ts';
import {summarizeWhatsAppOutbox} from '../base44/shared/whatsappQueueMetrics.ts';

function context({actor={role:'admin',email:'natib8000@gmail.com'},state={},jobs=[]}={}){
 const record={id:'control',control_key:'global',enabled:false,paused:false,
   green_interval_ms:7000,wasender_interval_ms:7000,max_messages_per_run:16,
   lease_owner:'',lease_until:'',last_dispatched_at:'',last_worker_at:'',...state};
 const syncs=[],calls=[],listProjections=[];
 const matches=(record,query)=>Object.entries(query||{}).every(([key,val])=>{
   if(val&&typeof val==='object'&&('$in' in val))return val.$in.includes(record[key]);
   return record[key]===val;
 });
 const jobEntity={
   list:async(_sort,limit=500,offset=0,fields)=>{listProjections.push(fields);return jobs.slice(offset,offset+limit);},
   filter:async(query,_sort,limit=500,offset=0)=>jobs.filter(x=>matches(x,query)).slice(offset,offset+limit),
   get:async(id)=>jobs.find(x=>x.id===id)||null,
   updateMany:async(query,{ $set })=>{
     const found=jobs.filter(x=>matches(x,query));
     for(const job of found)Object.assign(job,$set);
     return {updated:found.length};
   }
 };
 const client={auth:{me:async()=>actor},asServiceRole:{entities:{
   WhatsAppQueueControl:{update:async(_id,patch)=>Object.assign(record,patch)},
   WhatsAppOutbox:jobEntity
 }}};
 let handler=null;
 const js=esbuild.transformSync(fs.readFileSync('base44/functions/WhatsAppQueueAdmin/entry.ts','utf8'),{
   loader:'ts',format:'cjs',target:'es2022'
 }).code;
 vm.runInNewContext(js,{
   exports:{},module:{exports:{}},console:{error:()=>{},log:()=>{}},
   Deno:{serve:fn=>handler=fn},
   Response:{json:(body,{status=200}={})=>({body,status})},
   require:name=>{
     if(name.startsWith('npm:@base44/sdk'))return {createClientFromRequest:()=>client};
     if(name.endsWith('whatsappOutbox.ts'))return {readWhatsAppQueueControl:async()=>record};
     if(name.endsWith('whatsappQueueWorker.ts'))return {
       drainWhatsAppOutbox:async()=>{calls.push('dispatch');return {accepted:0,reason:'empty'}},
       providerIntervalMs,delayUntilNextSendMs,lastDispatchForProvider,
       syncWhatsAppStatus:async(_client,job,status)=>syncs.push({id:job.id,status})
     };
     if(name.endsWith('whatsappProviderConfig.ts'))return {resolveWhatsAppProvider:async()=> 'wasender'};
     if(name.endsWith('whatsappQueueMetrics.ts'))return {summarizeWhatsAppOutbox};
     throw Error('Unexpected import: '+name);
   }
 });
 return {record,jobs,syncs,calls,listProjections,invoke:async(action,params={})=>await handler({
   method:'POST',json:async()=>({action,...params})
 })};
}
const config={enabled:true,paused:false,wasenderIntervalMs:2500,greenIntervalMs:180,maxMessagesPerRun:16};
const makeJob=(id,status='queued')=>({id,status,chat_id:'972501234567@c.us',message_type:'text',message_text:'Hello',source_type:'assignment_new',available_at:new Date().toISOString(),created_date:new Date().toISOString(),attempt_count:0,archived:false});

test('non-system owner cannot read or modify queue operations',async()=>{
 for(const actor of [null,{role:'admin',email:'other@example.com'},{role:'supplier',email:'natib8000@gmail.com'}]){
   const ctx=context({actor,jobs:[makeJob('job-123','queued')]});
   for(const action of ['status','configure','list','get','cancel','retry','resolve','archive','kick']){
     const res=await ctx.invoke(action,{...config,id:'job-123'});
     assert.equal(res.status,403);
   }
   assert.equal(ctx.calls.length,0);
 }
});
test('status/list/get are read only and mask recipient until owner requests detail',async()=>{
 const ctx=context({jobs:[makeJob('job-123')]});
 const status=await ctx.invoke('status');
 assert.equal(status.status,200);
 assert.equal(status.body.config.wasenderIntervalMs,7000);
 assert.equal(status.body.config.greenIntervalMs,7000);
 assert.equal(status.body.activeProvider,'wasender');
 const list=await ctx.invoke('list');
 assert.equal(list.status,200);assert.equal(list.body.rows.length,1);
 assert.equal(list.body.rows[0].chatId,undefined);
 assert.equal(list.body.rows[0].text,undefined);
 const detail=await ctx.invoke('get',{id:'job-123'});
 assert.equal(detail.body.message.chatId,'972501234567@c.us');
 assert.equal(detail.body.message.text,'Hello');
 assert.equal(ctx.calls.length,0);
});
test('lightweight read-only status/list/metrics use server-side field projection, not 500 message bodies',async()=>{
 const ctx=context({jobs:[makeJob('job-123')]});
 await ctx.invoke('status');
 await ctx.invoke('list');
 const m=await ctx.invoke('metrics');
 assert.equal(m.status,200);
 assert.ok(ctx.listProjections.length>=3);
 for(const fields of ctx.listProjections){
   assert.ok(Array.isArray(fields));
   for(const privateField of ['message_text','caption','document_url','file_uri','chat_id_secret']){
     assert.equal(fields.includes(privateField),false,'Never fetch private '+privateField+' when only summary needed');
   }
 }
 assert.ok(ctx.listProjections[0].includes('status'));
 assert.ok(ctx.listProjections.at(-1).includes('transport_finished_at'));
});
test('provider wait UI uses its own dispatch history, not the other provider cooldown',async()=>{
 const recent=new Date(Date.now()-1000).toISOString();
 const old=new Date(Date.now()-60000).toISOString();
 const ctx=context({state:{enabled:true,last_dispatched_at:recent,last_provider:'green',
   last_green_dispatched_at:recent,last_wasender_dispatched_at:old,
   green_interval_ms:5000,wasender_interval_ms:9000}});
 const r=await ctx.invoke('status');
 assert.equal(r.status,200);
 assert.equal(r.body.activeProvider,'wasender');
 assert.equal(r.body.nextAllowedInMs,0,
   'Wasender can send even when latest global dispatch was Green');
});
test('configure persists each provider in milliseconds and enables wake once',async()=>{
 const ctx=context();
 let r=await ctx.invoke('configure',config);
 assert.equal(r.status,200);
 assert.equal(ctx.record.wasender_interval_ms,2500);
 assert.equal(ctx.record.green_interval_ms,180);
 assert.ok(ctx.record.wake_requested_at);
 assert.equal(ctx.calls.length,0);
 r=await ctx.invoke('configure',{...config,wasenderIntervalMs:0,greenIntervalMs:250});
 assert.equal(r.status,200);
 assert.equal(ctx.record.wasender_interval_ms,0);
});
test('invalid provider intervals reject negative, fractional milliseconds and excessive values',async()=>{
 for(const bad of [-1,0.5,300001,null,'7000']){
   const ctx=context();
   const r=await ctx.invoke('configure',{...config,wasenderIntervalMs:bad});
   assert.equal(r.status,400);
   assert.equal(ctx.record.enabled,false);
 }
});
test('disable refuses to bypass active queued or retry-wait jobs, pause is reversible',async()=>{
 const ctx=context({state:{enabled:true},jobs:[makeJob('job-a','retry_wait')]});
 let r=await ctx.invoke('configure',{...config,enabled:false});
 assert.equal(r.status,409);
 assert.equal(ctx.record.enabled,true);
 r=await ctx.invoke('configure',{...config,paused:true});
 assert.equal(r.status,200);assert.equal(ctx.record.paused,true);
 r=await ctx.invoke('configure',{...config,paused:false});
 assert.equal(r.status,200);assert.equal(ctx.record.paused,false);
 assert.ok(ctx.record.wake_requested_at);
});
test('cancel only pending/retry and CAS never cancels in-flight',async()=>{
 const ctx=context({jobs:[makeJob('job-a','queued'),makeJob('job-b','sending')]});
 let r=await ctx.invoke('cancel',{id:'job-a'});
 assert.equal(r.status,200);assert.equal(ctx.jobs[0].status,'cancelled');
 assert.deepEqual(ctx.syncs[0],{id:'job-a',status:'cancelled'});
 r=await ctx.invoke('cancel',{id:'job-b'});
 assert.equal(r.status,409);assert.equal(ctx.jobs[1].status,'sending');
});
test('bulk cancel and archive cannot mutate active/in-flight jobs',async()=>{
 const ctx=context({jobs:[makeJob('job-a','queued'),makeJob('job-b','retry_wait'),makeJob('job-c','sending')]});
 let r=await ctx.invoke('bulkCancel',{ids:['job-a','job-b','job-c'],confirm:true});
 assert.equal(r.status,200);assert.equal(r.body.updated,2);assert.equal(r.body.skipped.length,1);
 assert.equal(ctx.jobs[2].status,'sending');
 r=await ctx.invoke('bulkArchive',{ids:['job-a','job-b','job-c'],confirm:true});
 assert.equal(r.body.updated,2);
 assert.equal(ctx.jobs[0].archived,true);
 assert.equal(ctx.jobs[1].archived,true);
});
test('definitely failed messages can be retried with reason, no silent duplicates',async()=>{
 const ctx=context({jobs:[makeJob('job-a','failed'),makeJob('job-b','accepted')]});
 let r=await ctx.invoke('retry',{id:'job-a',note:'Verified invalid number corrected'});
 assert.equal(r.status,200);assert.equal(ctx.jobs[0].status,'queued');assert.equal(ctx.jobs[0].manual_retry_count,1);
 r=await ctx.invoke('retry',{id:'job-b',note:'do not repeat'});
 assert.equal(r.status,409);assert.equal(ctx.jobs[1].status,'accepted');
});
test('unknown requires explicit verification of non-delivery and detailed note',async()=>{
 const ctx=context({jobs:[makeJob('job-u','unknown')]});
 let r=await ctx.invoke('retry',{id:'job-u',note:'No provider entry'});
 assert.equal(r.status,409);assert.equal(ctx.jobs[0].status,'unknown');
 r=await ctx.invoke('retry',{id:'job-u',verifiedNotSent:true,note:'Checked provider sent history: message absent'});
 assert.equal(r.status,200);assert.equal(ctx.jobs[0].status,'queued');
 assert.equal(ctx.jobs[0].resolution,'verified_not_sent_then_requeued');
});
test('resolve unknown without resending; archive only terminal statuses',async()=>{
 const ctx=context({jobs:[makeJob('job-u','unknown'),makeJob('job-q','queued')]});
 let r=await ctx.invoke('archive',{id:'job-u'});assert.equal(r.status,409);
 r=await ctx.invoke('resolve',{id:'job-u',note:'Confirmed handled by phone',resolution:'handled_outside'});
 assert.equal(r.status,200);assert.equal(ctx.jobs[0].status,'resolved');
 r=await ctx.invoke('archive',{id:'job-u'});
 assert.equal(r.status,200);assert.equal(ctx.jobs[0].archived,true);
 r=await ctx.invoke('archive',{id:'job-q'});
 assert.equal(r.status,409);
});
test('admin explicit worker kick is only action that dispatches',async()=>{
 const ctx=context();
 await ctx.invoke('status');
 assert.equal(ctx.calls.length,0);
 await ctx.invoke('kick');
 assert.equal(ctx.calls.length,1);
});
