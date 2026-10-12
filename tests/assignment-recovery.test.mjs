import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecoveryReminder, candidateFromLive, effectiveDestination, israelDay, recoveryCooldownSeconds } from '../base44/shared/assignmentRecovery.ts';

const event={id:'event123456',event_name:'אירוע לדוגמה',family_name:'משפחת בדיקה',event_date:'2099-02-03',event_time:'10:30',location:'ירושלים',status:'confirmed'};
const supplier={id:'supplier123456',supplier_name:'ספק לדוגמה',phone:'0501234567',preferred_channel:'phone',whatsapp_enabled:true};
const svc={id:'service123456',event_id:event.id,service_id:'type123456',service_name:'צילום',supplier_ids:JSON.stringify([supplier.id]),supplier_statuses:JSON.stringify({[supplier.id]:'pending'}),supplier_notes:JSON.stringify({[supplier.id]:'להגיע מוקדם'}),supplier_arrival_time:'09:45',updated_date:'2099-02-01'};
const tmpl={whatsapp_body_template:'שלום {{supplier_name}}, שובצת לשירות {{service_name}} אצל {{family_name}} ביום {{event_date}} בשעה {{event_time}}. {{event_location}}. {{supplier_note}}. {{unknown}}'};
const type={service_name:'צילום'};
test('reminder preserves event/service/supplier context without ambiguous placeholders',()=>{
 const text=buildRecoveryReminder(tmpl,event,svc,type,supplier);
 assert.match(text,/תזכורת לאישור שיבוץ/);
 assert.match(text,/משפחת בדיקה/);
 assert.match(text,/03\/02\/2099/);
 assert.match(text,/09:45/);
 assert.match(text,/להגיע מוקדם/);
 assert.match(text,/אינו שיבוץ נוסף/);
 assert.doesNotMatch(text,/\{\{/);
});
test('pending assignment produces only one pair key and valid phone target',()=>{
 const candidate=candidateFromLive(svc,supplier,event,type,tmpl,'2026-10-12');
 assert.equal(candidate?.destination,'972501234567@c.us');
 assert.equal(candidate?.recoveryKey,'2026-10-12|service123456|supplier123456');
 assert.equal(candidate?.channel,'phone');
});
test('group preference targets existing WhatsApp group, preserving assignment route',()=>{
 const s={...supplier,preferred_channel:'group',whatsapp_group_url:'120363123456789@g.us'};
 assert.deepEqual(effectiveDestination(s),{chatId:'120363123456789@g.us',channel:'group'});
});
test('confirmed, rejected, removed, cancelled and WhatsApp-disabled suppliers are never included',()=>{
 assert.equal(candidateFromLive({...svc,supplier_statuses:JSON.stringify({[supplier.id]:'confirmed'})},supplier,event,type,tmpl,'2026-10-12'),null);
 assert.equal(candidateFromLive({...svc,supplier_statuses:JSON.stringify({[supplier.id]:'rejected'})},supplier,event,type,tmpl,'2026-10-12'),null);
 assert.equal(candidateFromLive({...svc,supplier_ids:'[]'},supplier,event,type,tmpl,'2026-10-12'),null);
 assert.equal(candidateFromLive(svc,supplier,{...event,status:'cancelled'},type,tmpl,'2026-10-12'),null);
 assert.equal(candidateFromLive(svc,{...supplier,whatsapp_enabled:false},event,type,tmpl,'2026-10-12'),null);
 assert.equal(candidateFromLive({...svc,is_external:true},supplier,event,type,tmpl,'2026-10-12'),null);
});
test('recovery cooldown compares actual instants across UTC and Israeli offsets',()=>{
 const now=Date.parse('2026-10-12T14:42:00Z'); // 17:42 Israel
 const historical=[{attempted_at:'2026-10-12T15:40:40+03:00'},
                   {attempted_at:'2026-10-12T15:39:55+03:00'}];
 assert.equal(recoveryCooldownSeconds(historical,now,7000),0);
 // This was the production failure: string comparisons reported historical
 // '+03:00' entries as newer than a UTC cutoff.
 assert.equal(historical[0].attempted_at > new Date(now-7000).toISOString(),true);
 assert.equal(recoveryCooldownSeconds([{attempted_at:'2026-10-12T17:41:57+03:00'}],now,7000),4);
 assert.equal(recoveryCooldownSeconds([{attempted_at:'2026-10-12T14:41:57Z'}],now,7000),4);
 assert.equal(recoveryCooldownSeconds([{attempted_at:'nonsense'},{attempted_at:''}],now,7000),0);
});

test('Israel timezone day detection does not use raw UTC date',()=>{
 assert.equal(israelDay(new Date('2026-10-11T22:01:00Z')),'2026-10-12');
});
