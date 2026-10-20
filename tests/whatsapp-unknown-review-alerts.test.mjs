import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {alertUnknownWhatsAppOutcomes,unknownWhatsAppReviewTitle} from '../base44/shared/whatsappUnknownReviewAlerts.ts';

const now=Date.parse('2026-10-20T09:00:00.000Z');
const old=new Date(now-5*60_000).toISOString();
const ready=(id,extra={})=>({
  id,status:'unknown',source_type:'scheduled_notification',created_date:old,
  last_status_at:old,archived:false,...extra
});

function fixtures(jobs=[ready('outbox-one')], options={}){
  const rows=jobs.map(x=>({...x})),notices=options.existing||[];
  const calls={provider:0,notesCreated:0,claims:0,owners:0,read:0};
  let failNotice=options.failNotice??false,failAck=options.failAck??false;
  const matches=(r,q)=>Object.entries(q).every(([k,v])=>{
    if(v&&typeof v==='object'&&'$in' in v)
      return v.$in.some(x=>x===null?r[k]===undefined||r[k]===null:r[k]===x);
    return r[k]===v;
  });
  const db={
    WhatsAppOutbox:{
      filter:async(q,sort,limit,_skip,fields)=>{
        calls.read++;
        assert.deepEqual(Object.keys(q),['status']);
        assert.equal(q.status,'unknown');
        assert.ok(!fields.includes('message_text')&&!fields.includes('chat_id'));
        return rows.filter(x=>matches(x,q))
          .sort((a,b)=>String(b.last_status_at||'').localeCompare(String(a.last_status_at||'')))
          .slice(0,limit).map(x=>({...x}));
      },
      updateMany:async(q,p)=>{
        const row=rows.find(x=>matches(x,q));
        if(!row)return {updated:0};
        if(p.$set?.review_alert_claim_until && !p.$set?.review_alert_sent_at)
          calls.claims++;
        if(failAck && p.$set?.review_alert_sent_at)throw Error('Lost receipt write');
        Object.assign(row,p.$set);return {updated:1};
      }
    },
    User:{
      filter:async(q)=>{
        calls.owners++;
        assert.equal(q.email,'natib8000@gmail.com');
        return options.missingOwner?[]:[{id:'system-owner',email:q.email,
          role:options.role||'admin'}];
      }
    },
    InAppNotification:{
      filter:async q=>{
        assert.equal(q.user_id,'system-owner');
        return notices.filter(n=>matches(n,q));
      },
      create:async n=>{
        calls.notesCreated++;
        assert.equal(n.template_type,'WHATSAPP_OUTBOX_REVIEW');
        assert.match(n.link,/SettingsPage\?whatsappQueue=review/);
        assert.equal(n.is_read,false);
        assert.equal(n.is_resolved,false);
        assert.equal(JSON.stringify(n).includes('97250'),false);
        notices.push({...n,id:'notice-'+notices.length});
        if(failNotice)throw Error('Synthetic notice acknowledgement lost after commit');
        return notices.at(-1);
      }
    }
  };
  return {client:{asServiceRole:{entities:db}},rows,notices,calls,
    setFailAck:value=>{failAck=value},
    setFailNotice:value=>{failNotice=value}};
}

test('old UNKNOWN provider outcome creates exactly one owner review notice, never sends WhatsApp',async()=>{
  const x=fixtures();
  const r=await alertUnknownWhatsAppOutcomes(x.client,{now});
  assert.deepEqual(r,{examined:1,eligible:1,created:1,existing:0,busy:0,failed:0,noMessagesSent:true});
  assert.equal(x.rows[0].status,'unknown');
  assert.ok(x.rows[0].review_alert_sent_at);
  assert.equal(x.notices[0].title,unknownWhatsAppReviewTitle('outbox-one'));
  assert.equal(x.calls.provider,0);
  const next=await alertUnknownWhatsAppOutcomes(x.client,{now:now+5*60_000});
  assert.equal(next.created,0);assert.equal(x.notices.length,1);
});

test('provider result less than 90 seconds old is left alone',async()=>{
  const x=fixtures([ready('fresh',{last_status_at:new Date(now-25_000).toISOString()})]);
  const r=await alertUnknownWhatsAppOutcomes(x.client,{now});
  assert.equal(r.eligible,0);assert.equal(x.calls.owners,0);
  assert.equal(x.notices.length,0);
});
test('archived, resolved, accepted, and stale old history never creates false alerts',async()=>{
  const x=fixtures([
    ready('archived',{archived:true}),
    ready('settled',{status:'resolved'}),
    ready('accepted',{status:'accepted'}),
    ready('old-history',{last_status_at:new Date(now-40*86400_000).toISOString()})
  ]);
  const r=await alertUnknownWhatsAppOutcomes(x.client,{now});
  assert.equal(r.created,0);assert.equal(r.eligible,0);
});
test('concurrent watchdog calls reserve one job with atomic CAS, not duplicate notices',async()=>{
  const x=fixtures();
  const [a,b]=await Promise.all([
    alertUnknownWhatsAppOutcomes(x.client,{now}),
    alertUnknownWhatsAppOutcomes(x.client,{now})
  ]);
  assert.equal(a.created+b.created,1);
  assert.equal(x.calls.notesCreated,1);
  assert.equal(x.notices.length,1);
  assert.equal(x.calls.claims,1);
  assert.equal(x.rows[0].status,'unknown');
});

test('notice committed but response lost is deduplicated after reservation expires',async()=>{
  const x=fixtures([ready('notice-ack-lost')],{failNotice:true});
  const first=await alertUnknownWhatsAppOutcomes(x.client,{now});
  assert.equal(first.created,0);
  assert.equal(first.failed,1);
  assert.equal(x.notices.length,1,'Notice was committed despite lost reply');
  const second=await alertUnknownWhatsAppOutcomes(x.client,{now:now+5*60_000});
  assert.equal(second.busy,1,'Active reservation prevents immediate duplicate');
  x.setFailNotice(false);
  const third=await alertUnknownWhatsAppOutcomes(x.client,{now:now+11*60_000});
  assert.equal(third.existing,1);
  assert.equal(third.created,0);
  assert.equal(x.notices.length,1);
  assert.ok(x.rows[0].review_alert_sent_at);
});

test('Outbox acknowledgement failure after notice creation is deduplicated on recovery',async()=>{
  const x=fixtures([ready('db-ack-lost')],{failAck:true});
  const r=await alertUnknownWhatsAppOutcomes(x.client,{now});
  assert.equal(r.failed,1);assert.equal(x.notices.length,1);
  x.setFailAck(false);
  const r2=await alertUnknownWhatsAppOutcomes(x.client,{now:now+11*60_000});
  assert.equal(r2.existing,1);
  assert.equal(r2.created,0);
  assert.equal(x.notices.length,1);
});
test('missing or non-admin owner cannot produce untrusted recipient alerts or claim jobs',async()=>{
  for(const opts of [{missingOwner:true},{role:'supplier'}]){
    const x=fixtures([ready('owner-invalid')],opts);
    const r=await alertUnknownWhatsAppOutcomes(x.client,{now});
    assert.equal(r.ownerUnavailable,true);
    assert.equal(x.calls.claims,0);assert.equal(x.notices.length,0);
    assert.equal(r.noMessagesSent,true);
  }
});

test('records are reported with their own identity and no phone or message bodies',async()=>{
  assert.throws(()=>unknownWhatsAppReviewTitle('bad phone @c.us'));
  const x=fixtures([ready('qa-job-123',{event_service_id:'service-123',
    message_text:'Secret content',chat_id:'972501234567@c.us'})]);
  const r=await alertUnknownWhatsAppOutcomes(x.client,{now});
  assert.equal(r.created,1);
  const notice=JSON.stringify(x.notices[0]);
  assert.equal(notice.includes('Secret content'),false);
  assert.equal(notice.includes('@c.us'),false);
  assert.equal(notice.includes('972501234567'),false);
  assert.equal(notice.includes('service-123'),true);
});

test('worker runs owner alert check only on authenticated watchdog and never queues provider retry',()=>{
  const worker=fs.readFileSync('base44/functions/processWhatsAppOutbox/entry.ts','utf8');
  const snippet=worker.slice(worker.indexOf("if(wakeReason==='watchdog'){",500));
  assert.match(snippet,/alertUnknownWhatsAppOutcomes\(client,\{limit:8\}\)/);
  assert.ok(worker.indexOf("if(!controlRows[0].enabled || controlRows[0].paused)")<
    worker.indexOf('alertUnknownWhatsAppOutcomes(client,{limit:8})'));
  const schema=JSON.parse(fs.readFileSync('base44/entities/WhatsAppOutbox.jsonc','utf8'));
  assert.equal(schema.properties.review_alert_claim_until.type,'string');
  assert.equal(schema.properties.review_alert_sent_at.type,'string');
});
