import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {googleCalendarPatchBody} from '../base44/shared/googleCalendarPatchBody.ts';

const allDay={summary:'Bar Mitzvah',start:{date:'2026-11-11'},
 end:{date:'2026-11-12'},description:'Existing template',location:'Jerusalem'};
const timed={summary:'Bar Mitzvah',start:{dateTime:'2026-11-11T10:00:00',timeZone:'Asia/Jerusalem'},
 end:{dateTime:'2026-11-11T16:00:00',timeZone:'Asia/Jerusalem'},description:'Existing template',location:'Jerusalem'};
test('PATCH from all-day to timed explicitly clears obsolete date keys on start and end',()=>{
 const b=googleCalendarPatchBody(timed);
 assert.deepEqual(b.start,{...timed.start,date:null});
 assert.deepEqual(b.end,{...timed.end,date:null});
 assert.equal(b.summary,timed.summary);
 assert.equal(b.description,timed.description);
 assert.equal(b.location,timed.location);
 assert.equal(timed.start.date,undefined);
});
test('PATCH from timed to all-day clears stale dateTime and timezone on start and end',()=>{
 const b=googleCalendarPatchBody(allDay);
 assert.deepEqual(b.start,{date:'2026-11-11',dateTime:null,timeZone:null});
 assert.deepEqual(b.end,{date:'2026-11-12',dateTime:null,timeZone:null});
 assert.deepEqual(Object.keys(b).sort(),Object.keys(allDay).sort());
 assert.equal(allDay.start.dateTime,undefined);
});
test('does not permit an ambiguous mixed-date payload or malformed object to reach Google',()=>{
 for(const bad of [{},null,[],{start:{date:'2026-11-11',dateTime:'2026-11-11T10:00:00'},end:allDay.end},
 {start:{date:''},end:allDay.end}])
  assert.throws(()=>googleCalendarPatchBody(bad));
});
test('both preexisting Google Calendar upsert functions use the same PATCH-only fix without replacing POST',()=>{
 for(const file of [
  'base44/functions/syncEventToGoogleCalendars/entry.ts',
  'base44/functions/syncAllEventsToCalendar/entry.ts'
 ]){
  const src=fs.readFileSync(file,'utf8');
  assert.match(src,/googleCalendarPatchBody\(eventBody\)/);
  const patch=src.slice(src.indexOf('async function upsertCalendarEvent('),
   src.indexOf('async function upsertCalendarEvent(')+2200);
  assert.match(patch,/method:\s*'PATCH'[\s\S]*?JSON\.stringify\(googleCalendarPatchBody\(eventBody\)\)/);
  assert.match(patch,/method:\s*'POST'[\s\S]*?JSON\.stringify\(eventBody\)/);
 }
});
