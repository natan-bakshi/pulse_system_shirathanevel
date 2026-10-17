// Request-local indexes for notification schedulers. Build once per batch;
// preserve original EventService iteration order within each event.
// No cross-run cache: subsequent assignment changes remain visible on next run.
export function indexEventServicesByEvent(services:any[]){
  const grouped=new Map<string,any[]>();
  for(const service of services||[]){
    const id=String(service?.event_id||'');
    if(!id)continue;
    const existing=grouped.get(id);
    if(existing)existing.push(service);
    else grouped.set(id,[service]);
  }
  return grouped;
}
export function indexEventReminderReceipts(notifications:any[]){
  const supplier=new Set<string>(),admin=new Set<string>();
  for(const note of notifications||[]){
    const event=String(note?.related_event_id||'');
    if(!event)continue;
    if(note?.template_type==='SUPPLIER_EVENT_REMINDER'&&note.related_supplier_id)
      supplier.add(event+':'+String(note.related_supplier_id));
    if(note?.template_type==='ADMIN_EVENT_REMINDER'&&note.user_id)
      admin.add(event+':'+String(note.user_id));
  }
  return {supplier,admin};
}
