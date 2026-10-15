// Supplier assignment response reminder timing. This is distinct from the
// separate EVENT_REMINDER_FANOUT (day-before-event) system.
// Never schedule "please approve your assignment" after the supplier should
// already be on site. Jerusalem DST rules are taken from the shared calendar.
import { fromJerusalemWallClock } from './quietHours.ts';

export function assignmentReplyDeadline(event:any,eventService:any):Date|null {
  const date=String(event?.event_date||'').slice(0,10);
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if(!match)return null;
  const [year,month,day]=match.slice(1).map(Number);
  const normalized=new Date(Date.UTC(year,month-1,day));
  if(normalized.toISOString().slice(0,10)!==date)return null;
  const times=[event?.event_time,eventService?.supplier_arrival_time]
    .map(t=>String(t||'').trim()).filter(t=>/^([01]?\d|2[0-3]):[0-5]\d$/.test(t));
  // If start time is unknown, do not invent 09:00; conservatively cut off
  // approval reminders when the event date begins.
  const first=times.length?times.map(t=>t.split(':').map(Number))
    .sort((a,b)=>(a[0]*60+a[1])-(b[0]*60+b[1]))[0]:[0,0];
  const [h,m]=first;
  return fromJerusalemWallClock(year,month,day,h,m);
}
export function shouldScheduleAssignmentReplyReminder(event:any,service:any,scheduledAt:Date):boolean {
  const deadline=assignmentReplyDeadline(event,service);
  return !!deadline && Number.isFinite(scheduledAt?.getTime()) && scheduledAt.getTime()<deadline.getTime();
}
