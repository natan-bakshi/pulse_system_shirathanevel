import { formatEventContacts } from './eventContacts.ts';

export function isMissingAssignmentAlertDue(readiness, now = new Date()) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(now);
    return readiness.event.status === 'confirmed' && !readiness.ready &&
        !!readiness.event.event_date && readiness.event.event_date.slice(0, 10) >= today;
}

export function renderMissingAssignmentAlert(template, readiness) {
    const event = readiness.event;
    const missing = readiness.services.filter(service => service.missingConfirmations > 0);
    const date = (event.event_date || '').slice(0, 10).split('-').reverse().join('/');
    const context = {
        event_id: event.id, event_name: event.event_name || '',
        family_name: event.family_name || event.event_name || '',
        event_date: date, event_contacts: formatEventContacts(event),
        service_name: missing.map(service => service.serviceName).join(', '),
        min_suppliers: missing.reduce((sum, service) => sum + service.minimum, 0),
        current_suppliers: missing.reduce((sum, service) => sum + service.assigned, 0),
        confirmed_suppliers: missing.reduce((sum, service) => sum + service.confirmed, 0),
        missing_count: missing.reduce((sum, service) => sum + service.missingConfirmations, 0)
    };
    const replace = text => (text || '').replace(/\{\{?([\w_]+)\}?}/g,
        (match, key) => context[key] == null ? match : String(context[key]));
    const details = missing.map(service =>
        `• ${service.serviceName}: נדרשים ${service.minimum}, משובצים ${service.assigned}, אישרו ${service.confirmed}. חסרים ${service.missingAssignments} שיבוצים ו-${service.missingConfirmations} אישורים.`
    ).join('\n');
    const summary = `האירוע "${context.family_name}" בתאריך ${date} עדיין אינו תפור.\n\n${details}`;
    // Preserve the configured WhatsApp links while replacing stale counts with current data.
    const links = replace(template.whatsapp_body_template || '').match(/https?:\/\/\S+/g) || [];
    return {
        title: replace(template.title_template), message: summary,
        whatsapp_message: summary + (links.length ? '\n\n' + [...new Set(links)].join('\n') : '')
    };
}
