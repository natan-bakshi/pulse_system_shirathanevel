// Task digest completion requires EVERY targeted admin to have a durable
// notification receipt. Queuing a message in an in-memory array is NOT a
// receipt: a later Outbox create may fail (e.g. unavailable DB / credentials).
export function expectTaskRecipient(expected:Map<string,Set<string>>,taskId:any,recipientId:any){
  const task=String(taskId||''),recipient=String(recipientId||'');
  if(!task||!recipient)throw new Error('Task/recipient identity missing');
  const group=expected.get(task)||new Set<string>();
  group.add(recipient);expected.set(task,group);
}
export function acknowledgeTaskRecipient(confirmed:Map<string,Set<string>>,taskId:any,recipientId:any){
  const task=String(taskId||''),recipient=String(recipientId||'');
  if(!task||!recipient)throw new Error('Task/recipient identity missing');
  const group=confirmed.get(task)||new Set<string>();
  group.add(recipient);confirmed.set(task,group);
}
export function taskIdsReadyToMark(expected:Map<string,Set<string>>,confirmed:Map<string,Set<string>>):string[]{
  return [...expected].filter(([task,recipients])=>
    recipients.size>0&&[...recipients].every(recipient=>confirmed.get(task)?.has(recipient))
  ).map(([task])=>task);
}

// Event-driven Task scheduling owns a per-task PendingPushNotification,
// while the daily digest is only a fallback. Never run both producers for
// the same task+recipient, and never delete an outstanding Pending source by
// prematurely changing Task.whatsapp_notification_sent.
//
// Reads are scoped to DUE tasks only and use field projections. The result
// distinguishes "owned but pending" from "owned and durably queued"; in both
// cases the daily sender must skip this task/recipient.
export async function readScheduledTaskOwners(db:any,tasks:any[]):Promise<Map<string,Map<string,{confirmed:boolean}>>>{
  const tasksById=new Map((tasks||[]).filter(t=>t?.id).map(t=>[String(t.id),t]));
  const grouped=new Map<string,Map<string,{confirmed:boolean}>>();
  if(!tasksById.size)return grouped;
  const keys=[...tasksById.keys()];
  const matching:any[]=[];
  for(let i=0;i<keys.length;i+=100){
    const batch=keys.slice(i,i+100);
    const rows=await db.PendingPushNotification.filter({
      template_type:'TASK_DUE_REMINDER',related_task_id:{$in:batch}
    },'-created_date',5000,0,['id','related_task_id','user_id','scheduled_for','is_sent','data']);
    if(rows.length>=5000)throw new Error('Task Pending owner query truncated: refuse unsafe daily duplicate');
    for(const row of rows){
      const task=tasksById.get(String(row.related_task_id||''));
      if(!task||!row.user_id)continue;
      let info:any={};
      try{info=row.data?JSON.parse(row.data):{};}catch{}
      // New records carry immutable original due version even if quiet
      // hours postpone scheduled_for. Old records lack that field; prefer
      // keeping ownership rather than creating a potential duplicate.
      if(info.task_due_date && Date.parse(info.task_due_date)!==Date.parse(task.due_date))continue;
      matching.push({...row,_info:info});
    }
  }
  const allKeys=[...new Set(matching.filter(row=>row.is_sent&&row._info.send_whatsapp===true)
    .map(row=>String(row._info.idempotency_key||'scheduled-wa:'+row.id)))];
  const statuses=new Map<string,string>();
  for(let i=0;i<allKeys.length;i+=100){
    const batch=allKeys.slice(i,i+100);
    const existing=await db.WhatsAppOutbox.filter({idempotency_key:{$in:batch}},
      '-created_date',5000,0,['idempotency_key','status']);
    if(existing.length>=5000)throw new Error('Task Outbox owner query truncated: refuse unsafe daily duplicate');
    for(const job of existing)statuses.set(String(job.idempotency_key),String(job.status||''));
  }
  for(const row of matching){
    const taskId=String(row.related_task_id),recipient=String(row.user_id);
    const parent=grouped.get(taskId)||new Map<string,{confirmed:boolean}>();
    const key=String(row._info.idempotency_key||'scheduled-wa:'+row.id);
    const waState=statuses.get(key)||'';
    const confirmed=!!row.is_sent && (
      row._info.send_whatsapp!==true || ['queued','sending','retry_wait','accepted'].includes(waState)
    ) && !['unknown','failed','cancelled','expired','resolved'].includes(waState);
    // Multiple rows for the same task/recipient can be created on Task
    // updates; ALL matching Pending sources must settle safely.
    const prior=parent.get(recipient);
    parent.set(recipient,{confirmed:prior?prior.confirmed&&confirmed:confirmed});
    grouped.set(taskId,parent);
  }
  return grouped;
}
