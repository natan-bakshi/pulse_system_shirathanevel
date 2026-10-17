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
