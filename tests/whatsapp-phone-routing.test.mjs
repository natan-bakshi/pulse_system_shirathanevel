import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseWhatsAppPhone} from '../base44/shared/whatsappPhone.ts';
import {normalizeIsraeliPhone,toChatId,sendWhatsAppText,sendWhatsAppFileUri,sendWhatsAppToChat} from '../base44/shared/whatsappSend.ts';
import {getWhatsAppLink} from '../src/lib/contactSettings.js';

const oldDeno=globalThis.Deno;
globalThis.Deno={env:{get:k=>({GREEN_API_INSTANCE_ID:'fake',GREEN_API_TOKEN:'fake'})[k]||''}};
test.after(()=>{if(oldDeno===undefined)delete globalThis.Deno;else globalThis.Deno=oldDeno;});

const numbers=[
 ['0501234567','972501234567'],
 ['5 01234567','972501234567'],
 ['+972 50-123-4567','972501234567'],
 ['00972501234567','972501234567'],
 ['972501234567','972501234567'],
 ['+1 (516) 555-1234','15165551234'],
 ['0015165551234','15165551234'],
 ['15165551234','15165551234'],
 ['+44 7700 900123','447700900123'],
 ['+33 6 12 34 56 78','33612345678'],
 ['+49 1512 3456789','4915123456789'],
 ['+91 98765 43210','919876543210'],
 ['+34 612 34 56 78','34612345678']
];
test('one canonical E.164 route for Israel, foreign countries and visual formats',()=>{
  for(const [input,digits] of numbers){
    const parsed=parseWhatsAppPhone(input);
    assert.equal(parsed.status,'VALID',input);
    assert.equal(parsed.canonicalE164,'+'+digits,input);
    assert.equal(parsed.digits,digits,input);
    assert.equal(parsed.chatId,digits+'@c.us',input);
    assert.equal(normalizeIsraeliPhone(input),digits,input);
    assert.equal(toChatId(input),digits+'@c.us',input);
    assert.equal(getWhatsAppLink(input),'https://wa.me/'+digits,input);
  }
});
test('ambiguously national, malformed and extended inputs cannot silently target wrong contact',()=>{
  for(const [input,status] of [
    ['02079460000','NEEDS_COUNTRY_CODE'],
    ['5165551234','NEEDS_COUNTRY_CODE'],
    ['+9720501234567','INVALID'],
    ['050123456','NEEDS_COUNTRY_CODE'],
    ['0501234567 ext 12','INVALID'],
    ['+15165551234, +15165551235','INVALID'],
    ['12345','NEEDS_COUNTRY_CODE'],
    ['+123','INVALID'],
    ['+123456789012345678','INVALID'],
    ['https://wa.me/15165551234','INVALID'],
    ['', 'INVALID']
  ]){
    const parsed=parseWhatsAppPhone(input);
    assert.equal(parsed.status,status,input);
    assert.equal(parsed.chatId,'',input);
    assert.equal(toChatId(input),'',input);
    assert.equal(getWhatsAppLink(input),'#',input);
  }
});
function fakeQueue(){
  const jobs=[];
  const control={id:'queue',enabled:true,paused:false,control_key:'global',
    enqueue_owner:'',enqueue_until:''};
  const db={
    WhatsAppQueueControl:{
      filter:async()=>[{...control}],
      updateMany:async(q,p)=>{
        if(q.enqueue_owner!==undefined && q.enqueue_owner!==control.enqueue_owner)return {updated:0};
        Object.assign(control,p.$set);return {updated:1};
      }
    },
    WhatsAppOutbox:{
      filter:async(q)=>jobs.filter(x=>x.idempotency_key===q.idempotency_key),
      create:async x=>{const job={...x,id:'job-'+(jobs.length+1)};jobs.push(job);return job;}
    },
    AppSettings:{filter:async()=>[{setting_key:'whatsapp_default_provider',setting_value:'green'}]}
  };
  return {client:{asServiceRole:{entities:db}},jobs};
}
test('text, document, group and trigger adapter enqueue; no provider HTTP during entry',async()=>{
 const {client,jobs}=fakeQueue();
 const oldFetch=globalThis.fetch;
 globalThis.fetch=async()=>{throw Error('NO provider HTTP at enqueue')};
 try{
   await sendWhatsAppText('+1 (516) 555-1234','agreement',client,{idempotencyKey:'agreement-1'});
   await sendWhatsAppFileUri('+44 7700 900123','private://invoice','invoice.pdf','caption',client,{idempotencyKey:'doc-1'});
   await sendWhatsAppToChat('120363123456789@g.us','group',client,{idempotencyKey:'group-1'});
   await sendWhatsAppToChat(toChatId('0501234567'),'assignment',client,{idempotencyKey:'assignment-1'});
   assert.deepEqual(jobs.map(x=>x.chat_id),[
     '15165551234@c.us','447700900123@c.us','120363123456789@g.us','972501234567@c.us']);
   assert.deepEqual(jobs.map(x=>x.message_type),['text','document','text','text']);
   await assert.rejects(sendWhatsAppText('02079460000','ambiguous',client),/Invalid WhatsApp phone/);
   await assert.rejects(sendWhatsAppToChat('02079460000@c.us','bad',client),/Invalid WhatsApp target/);
   assert.equal(jobs.length,4,'Rejected destinations never enter the queue');
 }finally{globalThis.fetch=oldFetch;}
});
test('entity-trigger and frontend link use the same telephone normalization; group remains separate',()=>{
 const producer=fs.readFileSync('base44/functions/handleEntityEvents/entry.ts','utf8');
 const contacts=fs.readFileSync('src/lib/contactSettings.js','utf8');
 assert.match(producer,/return toChatId\(phone\)/);
 assert.match(contacts,/parseWhatsAppPhone\(phone\)/);
 assert.doesNotMatch(producer,/cleanPhone\.startsWith\('05'\)/);
});
