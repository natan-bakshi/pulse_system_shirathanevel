import { base44 } from '@/api/base44Client';
import { queryClientInstance } from '@/lib/query-client';

export function cacheEventStatus(eventId, status) {
  if (!eventId || !status) return;
  queryClientInstance.setQueriesData({ queryKey: ['events'] }, old =>
    Array.isArray(old) ? old.map(event => event.id === eventId ? { ...event, status } : event) : old
  );
  queryClientInstance.setQueryData(['event', eventId], old => old ? { ...old, status } : old);
}

// Called once, after the complete save. Only the server reads and calculates the status.
export async function refreshEventStatus(eventId, scope = {}) {
  const { data } = await base44.functions.invoke('checkEventStatus', { ...scope, eventId });
  if (!data?.success) throw new Error(data?.error || 'עדכון סטטוס האירוע נכשל');
  for (const result of data.results || [data]) cacheEventStatus(result.eventId, result.newStatus);
  return data;
}

export function subscribeToEventStatus() {
  const stopEvents = base44.entities.Event.subscribe(change => {
    if (change.type !== 'delete') cacheEventStatus(change.id, change.data?.status);
  });
  const stopAssignments = base44.entities.EventService.subscribe(change => {
    const eventId = change.data?.event_id;
    const keys = [['eventServices'], ...(eventId ? [['eventServices', eventId]] : [])];
    for (const queryKey of keys) {
      if (change.data?._oversize) {
        queryClientInstance.invalidateQueries({ queryKey, exact: true });
        continue;
      }
      queryClientInstance.setQueryData(queryKey, old => {
        if (!Array.isArray(old)) return old;
        if (change.type === 'delete') return old.filter(row => row.id !== change.id);
        if (!change.data) return old;
        if (old.some(row => row.id === change.id)) {
          return old.map(row => row.id === change.id ? { ...row, ...change.data } : row);
        }
        return change.type === 'create' ? [...old, change.data] : old;
      });
    }
  });
  return () => { stopEvents(); stopAssignments(); };
}
