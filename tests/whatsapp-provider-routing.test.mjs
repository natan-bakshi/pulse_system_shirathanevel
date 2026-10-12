import test from 'node:test';
import assert from 'node:assert/strict';
import { sendWhatsAppTransport, sendWhatsAppText, sendWhatsAppToChat } from '../base44/shared/whatsappSend.ts';

const env={GREEN_API_INSTANCE_ID:'synthetic-instance',GREEN_API_TOKEN:'synthetic-green-token',WASENDER_API_KEY:'synthetic-wasender-key'};
globalThis.Deno={env:{get:k=>env[k]}};
const oldFetch=globalThis.fetch;
test.after(()=>{globalThis.fetch=oldFetch;delete globalThis.Deno;});
const client={asServiceRole:{integrations:{Core:{CreateFileSignedUrl:async()=>({signed_url:'https://example.com/signed-file.pdf'})}}}};
test('Green transport is only called by the worker; preserves original payload',async()=>{
 globalThis.fetch=async(url,options)=>{
  assert.equal(url,'https://api.green-api.com/waInstancesynthetic-instance/sendMessage/synthetic-green-token');
  assert.deepEqual(JSON.parse(options.body),{chatId:'972501234567@c.us',message:'test message'});
  return {ok:true,status:200,json:async()=>({idMessage:'green-123'})};
 };
 const r=await sendWhatsAppTransport({chat_id:'972501234567@c.us',message_type:'text',message_text:'test message'},'green',client);
 assert.equal(r.messageId,'green-123');
});
test('Wasender transport supports group and phone recipients',async()=>{
 globalThis.fetch=async(url,options)=>{
  assert.equal(url,'https://www.wasenderapi.com/api/send-message');
  assert.equal(options.headers.Authorization,'Bearer synthetic-wasender-key');
  assert.equal(JSON.parse(options.body).to,'120363123456789@g.us');
  return {ok:true,status:200,json:async()=>({success:true,data:{msgId:66}})};
 };
 const r=await sendWhatsAppTransport({chat_id:'120363123456789@g.us',message_type:'text',message_text:'hi'},'wasender',client);
 assert.equal(r.messageId,'66');
});
test('private file is signed only when worker dispatches, not at enqueue',async()=>{
 let signed=0;
 const fileClient={asServiceRole:{integrations:{Core:{CreateFileSignedUrl:async({file_uri})=>{
   signed++;assert.equal(file_uri,'private://invoice');return {signed_url:'https://example.com/signed.pdf'};
 }}}}};
 globalThis.fetch=async(url,opts)=>{
  const data=JSON.parse(opts.body);
  assert.equal(data.documentUrl,'https://example.com/signed.pdf');
  assert.equal(data.fileName,'invoice.pdf');
  return {ok:true,status:200,json:async()=>({success:true,data:{msgId:99}})};
 };
 const r=await sendWhatsAppTransport({chat_id:'972501234567@c.us',message_type:'document',file_uri:'private://invoice',file_name:'invoice.pdf',caption:'invoice'},'wasender',fileClient);
 assert.equal(r.messageId,'99');assert.equal(signed,1);
});
test('Green 503 is uncertain and must not be auto retried',async()=>{
 globalThis.fetch=async()=>({ok:false,status:503,json:async()=>({})});
 await assert.rejects(sendWhatsAppTransport({chat_id:'972501234567@c.us',message_type:'text',message_text:'hi'},'green',client),err=>err.deliveryUncertain===true&&err.errorCode===503);
});
test('producer without an authenticated backend cannot bypass the queue',async()=>{
 await assert.rejects(sendWhatsAppText('0501234567','msg'),/backend/);
 await assert.rejects(sendWhatsAppToChat('120363123456789@g.us','msg'),/backend/);
});
