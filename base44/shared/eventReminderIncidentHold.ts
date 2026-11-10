import {israelDay} from './eventReminderInventory.ts';

// Owner explicitly prohibited ALL catch-up WhatsApp for the missed 11 Nov 2026
// event reminders because at least one supplier was already reminded manually.
// A code fix must never unexpectedly trigger tonight's bulk delivery from
// hourly, daily, legacy or event-fanout producers. One-day incident fence, no
// secret, no DB mutation, no recurring suppression, and expires with the event.
export function ownerHeldReminderIncident(eventDate:unknown,now:Date):boolean{
 const date=String(eventDate??'').slice(0,10);
 if(date!=='2026-11-11')return false;
 const day=israelDay(now);
 return day==='2026-11-10'||day==='2026-11-11';
}
