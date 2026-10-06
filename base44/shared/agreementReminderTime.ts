// Jerusalem wall time -> UTC, including daylight saving changes.
export function reminderTime(date,days,time){
 const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-days);
 const local=d.toISOString().slice(0,10)+'T'+time+':00';
 let instant=Date.parse(local+'Z');
 for(let i=0;i<2;i++){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant));
  const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  const actual=Date.parse(p.year+'-'+p.month+'-'+p.day+'T'+p.hour+':'+p.minute+':'+p.second+'Z');
  instant+=Date.parse(local+'Z')-actual;
 }
 return new Date(instant).toISOString();
}