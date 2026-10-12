import { toChatId } from './whatsappSend.ts';

export type AssignmentCandidate = {
  eventServiceId: string;
  eventId: string;
  supplierId: string;
  supplierName: string;
  eventName: string;
  serviceName: string;
  eventDate: string;
  eventTime: string;
  updatedAt: string;
  channel: 'phone' | 'group';
  message: string;
  destination: string;
  recoveryKey: string;
};

function parseJson(value: unknown, fallback: any) {
  if (Array.isArray(value) || (value && typeof value === 'object')) return value;
  try { return JSON.parse(String(value || '')); } catch { return fallback; }
}
export function israelDay(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const get = (name: string) => parts.find(item => item.type === name)?.value || '';
  return [get('year'),get('month'),get('day')].join('-');
}
export function effectiveDestination(supplier: any): {chatId: string; channel: 'phone'|'group'} {
  if (supplier?.whatsapp_enabled === false) return {chatId:'',channel:'phone'};
  if (supplier?.preferred_channel === 'group') {
    const raw = String(supplier?.whatsapp_group_url || '').trim();
    const match = raw.match(/[A-Za-z0-9_-]+@g\.us/);
    const groupId = match?.[0] || (/^[0-9-]{8,}$/.test(raw) ? raw+'@g.us' : '');
    if (groupId) return {chatId:groupId,channel:'group'};
  }
  return {chatId:toChatId(supplier?.phone),channel:'phone'};
}
function formatDate(raw: string): string {
  const match = String(raw || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(raw || '');
}
export function buildRecoveryReminder(template: any, event: any, eventService: any, service: any, supplier: any): string {
  const notes = parseJson(eventService.supplier_notes, {});
  const time = String(eventService.supplier_arrival_time || event.event_time || '').trim();
  const context: Record<string,string> = {
    supplier_name: String(supplier.supplier_name||''),
    service_name: String(eventService.service_name || service?.service_name || ''),
    family_name: String(event.family_name || event.event_name || ''),
    event_name: String(event.event_name||''),
    event_date: formatDate(event.event_date),
    event_time: time,
    event_location: String(event.location || ''),
    supplier_note: String(notes?.[supplier.id] || ''),
    event_id: String(event.id)
  };
  let original = String(template?.whatsapp_body_template || template?.body_template || '').trim();
  if (!original) throw new Error('Assignment WhatsApp notification template is missing');
  for (const [key,value] of Object.entries(context)) original=original.replaceAll('{{'+key+'}}',value);
  original=original.replace(/\{\{[^}]+\}\}/g,'').replace(/^\s*~\s*~\s*$/gm,'').replace(/\n{3,}/g,'\n\n').trim();
  return '*תזכורת לאישור שיבוץ*\n\n'+original+'\n\n*חשוב:* הודעה זו נשלחת עקב תקלה טכנית במערכת ההתראות. אם כבר קיבלת את פרטי השיבוץ, זה אינו שיבוץ נוסף.';
}

export function candidateFromLive(serviceRecord: any, supplier: any, event: any, service: any, template: any, incidentDate: string): AssignmentCandidate | null {
  if (!serviceRecord?.id || serviceRecord.is_external || !supplier?.id || !event?.id) return null;
  if (event.status === 'cancelled' || event.status === 'completed') return null;
  if (String(event.event_date || '') < israelDay()) return null;
  const ids = parseJson(serviceRecord.supplier_ids, []);
  if (!Array.isArray(ids) || !ids.map(String).includes(String(supplier.id))) return null;
  const statuses = parseJson(serviceRecord.supplier_statuses, {});
  if (statuses?.[supplier.id] && statuses[supplier.id] !== 'pending') return null;
  const dest = effectiveDestination(supplier);
  if (!dest.chatId) return null;
  return {
    eventServiceId: serviceRecord.id,
    eventId: event.id,
    supplierId: supplier.id,
    supplierName: String(supplier.supplier_name || ''),
    eventName: String(event.event_name || event.family_name || ''),
    serviceName: String(serviceRecord.service_name || service?.service_name || ''),
    eventDate: String(event.event_date || ''),
    eventTime: String(serviceRecord.supplier_arrival_time || event.event_time || ''),
    updatedAt: String(serviceRecord.updated_date || ''),
    channel: dest.channel,
    destination: dest.chatId,
    message: buildRecoveryReminder(template,event,serviceRecord,service,supplier),
    recoveryKey: incidentDate+'|'+serviceRecord.id+'|'+supplier.id
  };
}
