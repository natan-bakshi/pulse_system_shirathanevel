import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {wakeExistingCalendarSyncAfterSupplierDecision}
 from '../base44/shared/calendarSyncStatusWake.ts';

const sId='service-123456';
const stamp=new Date('2026-10-30T09:00:00.000Z');
const nonce='calendar-wake-unique-001';
test('a successful supplier CAS wakes the EXISTING calendar trigger via one metadata update',async()=>{
 const calls=[];
 const client={entities:{EventService:{update:async(id,patch)=>{
  calls.push({id,patch});return {id,...patch};
 }}}};
 const status=await wakeExistingCalendarSyncAfterSupplierDecision(client,sId,stamp,nonce);
 assert.equal(status.requested,true);
 assert.deepEqual(calls,[{id:sId,patch:{
  calendar_sync_wake_at:'2026-10-30T09:00:00.000Z:'+nonce
 }}]);
 assert.equal('supplier_statuses' in calls[0].patch,false);
 assert.equal('supplier_ids' in calls[0].patch,false);
 assert.equal('assignment_intent_mode' in calls[0].patch,false);
});
test('missing storage, invalid IDs and lost DB ACK are non-replayable and never change supplier decision',async()=>{
 assert.equal((await wakeExistingCalendarSyncAfterSupplierDecision(
  {entities:{}},sId,stamp,nonce)).requested,false);
 assert.equal((await wakeExistingCalendarSyncAfterSupplierDecision(
  {entities:{EventService:{update:async()=>{throw Error('ACK lost')}}}},
  sId,stamp,nonce)).reason,'calendar_wake_outcome_uncertain');
 assert.equal((await wakeExistingCalendarSyncAfterSupplierDecision(
  {entities:{}},'wrong/id',stamp,nonce)).reason,'invalid_calendar_wake_identity');
});
test('only the preexisting Google Calendar EventService workflow observes wake field',()=>{
 const filename='base44/workflows/סנכרון יומן Google - שירותים.jsonc';
 const workflow=JSON.parse(fs.readFileSync(filename,'utf8'));
 assert.equal(workflow.trigger.config.entity_name,'EventService');
 assert.ok(workflow.trigger.condition.includes('calendar_sync_wake_at'));
 assert.equal(workflow.definition.do[0].run_function.with.function_name,
  'syncEventToGoogleCalendars');
 assert.equal(workflow.trigger.config.events.includes('update'),true);
 const calendar=fs.readFileSync('base44/functions/syncEventToGoogleCalendars/entry.ts','utf8');
 assert.match(calendar,/eventServiceFields = new Set\([\s\S]*?calendar_sync_wake_at/);
 const push=fs.readFileSync('base44/functions/onAssignmentChange/entry.ts','utf8');
 assert.match(push,/changedFields\.includes\('calendar_sync_wake_at'\)/);
 assert.match(push,/reason:'calendar_only_wake'/);
});
test('dashboard and WhatsApp button both request the existing workflow after changed CAS only',()=>{
 const dashboard=fs.readFileSync('base44/functions/updateSupplierStatus/entry.ts','utf8');
 const buttons=fs.readFileSync('base44/shared/whatsappInboundCoordinator.ts','utf8');
 assert.match(dashboard,/saved\.kind==='changed'[\s\S]*?wakeExistingCalendarSyncAfterSupplierDecision/);
 assert.match(buttons,/changed\.kind==='changed'[\s\S]*?wakeExistingCalendarSyncAfterSupplierDecision/);
 assert.equal(dashboard.includes('syncAllEventsToCalendar'),false);
 assert.equal(buttons.includes('syncAllEventsToCalendar'),false);
});
