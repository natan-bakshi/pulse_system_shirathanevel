import test from 'node:test';
import assert from 'node:assert/strict';
import {assignmentReplyDeadline,shouldScheduleAssignmentReplyReminder} from '../base44/shared/assignmentReminderTiming.ts';

test('do not schedule 24-hour approval reminder after event beginning',()=>{
  const event={event_date:'2026-10-15',event_time:'10:00'};
  const service={supplier_arrival_time:'09:30'};
  const due=new Date('2026-10-15T11:37:00+03:00');
  assert.equal(shouldScheduleAssignmentReplyReminder(event,service,due),false);
  assert.equal(assignmentReplyDeadline(event,service).toISOString(),'2026-10-15T06:30:00.000Z');
});
test('approval reminder before event and on earlier arrival remains due',()=>{
  const event={event_date:'2026-11-15',event_time:'12:00'};
  const service={supplier_arrival_time:'9:30'};
  assert.equal(shouldScheduleAssignmentReplyReminder(event,service,new Date('2026-11-14T07:30:00.000Z')),true);
  assert.equal(shouldScheduleAssignmentReplyReminder(event,service,new Date('2026-11-15T07:30:00.000Z')),false);
});
test('Jerusalem DST starts/ends are respected, do not use fixed +3 offset',()=>{
  const july=assignmentReplyDeadline({event_date:'2026-07-15',event_time:'10:00'},{});
  const dec=assignmentReplyDeadline({event_date:'2026-12-15',event_time:'10:00'},{});
  assert.equal(july.toISOString(),'2026-07-15T07:00:00.000Z');
  assert.equal(dec.toISOString(),'2026-12-15T08:00:00.000Z');
});
test('unknown or invalid event time defaults to start of date, not guessed 09:00',()=>{
  const event={event_date:'2026-10-15',event_time:''};
  const cutoff=assignmentReplyDeadline(event,{});
  assert.equal(cutoff.toISOString(),'2026-10-14T21:00:00.000Z');
  assert.equal(assignmentReplyDeadline({event_date:'2026-02-31'},{}),null);
  assert.equal(shouldScheduleAssignmentReplyReminder(event,{},new Date('2026-10-15T08:00:00Z')),false);
});
