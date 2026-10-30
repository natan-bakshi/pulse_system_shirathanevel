// Google Calendar PATCH merges nested EventDateTime objects. When an event
// changes between all-day and timed, the OLD "date"/"dateTime" survives unless
// explicitly removed, leading to HTTP 400 "Invalid start time". POST must
// retain the original eventBody: this helper is for PATCH only.
// We leave event IDs, calendar IDs, templates, times and all other fields intact.
export function googleCalendarPatchBody(eventBody:any){
 if(!eventBody||typeof eventBody!=='object'||Array.isArray(eventBody))
  throw Error('Invalid Google Calendar event body');
 const normalize=(value:any)=>{
  if(!value||typeof value!=='object'||Array.isArray(value))
   throw Error('Missing Google Calendar event time');
  const dateOnly=typeof value.date==='string'&&value.date.length>0;
  const timed=typeof value.dateTime==='string'&&value.dateTime.length>0;
  if(dateOnly===timed)throw Error('Ambiguous Google Calendar event time');
  return dateOnly
   ?{...value,dateTime:null,timeZone:null}
   :{...value,date:null};
 };
 return {...eventBody,start:normalize(eventBody.start),end:normalize(eventBody.end)};
}
