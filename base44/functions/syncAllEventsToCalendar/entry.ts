import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * syncAllEventsToCalendar - Mass sync all relevant events to Google Calendar.
 * 
 * Called manually from settings page.
 * Accepts: { syncType: 'admin' | 'supplier' | 'client' }
 */

const EVENT_TYPE_HEBREW = {
  bar_mitzvah: 'בר מצווה',
  bat_mitzvah: 'בת מצווה',
  wedding: 'חתונה',
  other: 'אירוע'
};

const SYNCED_STATUSES = ['confirmed', 'in_progress', 'completed'];

const DEFAULT_TEMPLATES = {
  admin: {
    summary: '{{event_type_hebrew}} [[של {{child_name}}]] {{family_name}}[[, בקונספט {{concept}}]]',
    description: '{{event_type_hebrew}} [[של {{child_name}}]] {{family_name}}[[, בקונספט {{concept}}]].\n[[מספר אורחים: {{guest_count}}]]\n[[הערות: {{notes}}]]\n[[לו"ז האירוע:\n{{schedule_text}}]]\n[[ספקים משויכים:\n{{suppliers_list}}]]\n[[לינק למערכת: {{app_link}}]]'
  },
  supplier: {
    summary: 'אירוע {{event_type_hebrew}} עם {{company_name}}, {{service_name}}. [[הערה עבורך: ({{supplier_note}})]]',
    description: 'אירוע {{event_type_hebrew}} [[של {{child_name}}]] {{family_name}}.\n[[בקונספט: {{concept}}.]]\n[[לו"ז האירוע:\n{{schedule_text}}]]\n[[לינק למערכת: {{app_link}}]]'
  },
  client: {
    summary: '{{event_type_hebrew}} [[של {{child_name}}]] {{family_name}}[[, בקונספט {{concept}}]]',
    description: 'אירוע {{event_type_hebrew}} [[של {{child_name}}]] {{family_name}}[[, בקונספט {{concept}}]].\n[[הערות: {{notes}}]]\n[[לינק למערכת: {{app_link}}]]'
  }
};

function buildScheduleText(schedule) {
  if (!schedule || !Array.isArray(schedule) || schedule.length === 0) return '';
  return schedule.map(item => {
    let line = '';
    if (item.time) line += item.time;
    if (item.activity) line += (line ? ' - ' : '') + item.activity;
    if (item.notes) line += (line ? ' (' : '(') + item.notes + ')';
    return line;
  }).filter(Boolean).join('\n');
}

function buildSuppliersList(allEventServices, allServices, allSuppliers, selectedCategories) {
  if (!selectedCategories || selectedCategories.length === 0) return '';
  const servicesMap = {};
  for (const s of allServices) servicesMap[s.id] = s;
  const suppliersMap = {};
  for (const s of allSuppliers) suppliersMap[s.id] = s;
  const lines = [];
  for (const es of allEventServices) {
    const service = servicesMap[es.service_id];
    if (!service || !selectedCategories.includes(service.service_name)) continue;
    let supplierIds = [];
    try { supplierIds = JSON.parse(es.supplier_ids || '[]'); } catch (e) {}
    let supplierStatuses = {};
    try { supplierStatuses = JSON.parse(es.supplier_statuses || '{}'); } catch (e) {}
    let supplierNotes = {};
    try { supplierNotes = JSON.parse(es.supplier_notes || '{}'); } catch (e) {}
    const confirmed = supplierIds
      .filter(id => (supplierStatuses[id] || 'pending') === 'confirmed')
      .map(id => {
        const s = suppliersMap[id];
        if (!s) return null;
        const note = supplierNotes[id];
        return note ? `${s.supplier_name} (${note})` : s.supplier_name;
      }).filter(Boolean);
    if (confirmed.length > 0) lines.push(`${service.service_name}: ${confirmed.join(', ')}`);
  }
  return lines.join('\n');
}

function parseTemplate(template, data) {
  if (!template) return '';
  let result = template.replace(/\[\[([\s\S]*?)\]\]/g, (match, content) => {
    const vars = content.match(/\{\{(\w+)\}\}/g);
    if (!vars) return content;
    for (const v of vars) {
      const key = v.replace(/\{\{|\}\}/g, '');
      if (!data[key]) return '';
    }
    return content.replace(/\{\{(\w+)\}\}/g, (m, key) => data[key] || '');
  });
  result = result.replace(/\{\{(\w+)\}\}/g, (match, key) => (data[key] !== undefined && data[key] !== null && data[key] !== '') ? data[key] : '');
  return result.replace(/\n{3,}/g, '\n\n').trim();
}

function calculateTimes(eventDate, eventTime, offsetMinutes, durationHours) {
  if (!eventTime) {
    const parts = eventDate.split('-').map(Number);
    const nextDay = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + 1));
    return { startDateTime: { date: eventDate }, endDateTime: { date: nextDay.toISOString().split('T')[0] } };
  }
  const [hours, minutes] = eventTime.split(':').map(Number);
  let totalMinutes = hours * 60 + minutes + offsetMinutes;
  const hh = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const mm = String(totalMinutes % 60).padStart(2, '0');
  const endTotal = totalMinutes + durationHours * 60;
  const ehh = String(Math.floor(endTotal / 60)).padStart(2, '0');
  const emm = String(endTotal % 60).padStart(2, '0');
  return {
    startDateTime: { dateTime: `${eventDate}T${hh}:${mm}:00`, timeZone: 'Asia/Jerusalem' },
    endDateTime: { dateTime: `${eventDate}T${ehh}:${emm}:00`, timeZone: 'Asia/Jerusalem' }
  };
}

function buildEventBody(event, userType, settingsMap, extraData) {
  const eventType = EVENT_TYPE_HEBREW[event.event_type] || 'אירוע';
  const summaryTemplate = settingsMap[`google_calendar_${userType}_summary_template`] || DEFAULT_TEMPLATES[userType].summary;
  const descriptionTemplate = settingsMap[`google_calendar_${userType}_description_template`] || DEFAULT_TEMPLATES[userType].description;
  const data = {
    event_type_hebrew: eventType, event_name: event.event_name || '', child_name: event.child_name || '',
    family_name: event.family_name || '', concept: event.concept || '',
    guest_count: event.guest_count ? String(event.guest_count) : '', notes: event.notes || '',
    schedule_text: buildScheduleText(event.schedule), company_name: settingsMap.company_name || '',
    app_link: settingsMap.app_base_url || '',
    service_name: extraData?.serviceName || '', supplier_note: extraData?.supplierNote || '',
    suppliers_list: extraData?.suppliersList || '',
  };
  const summary = parseTemplate(summaryTemplate, data);
  const description = parseTemplate(descriptionTemplate, data);
  let offset = 0, duration = 6;
  if (userType === 'supplier') { offset = -15; duration = 3; }
  const { startDateTime, endDateTime } = calculateTimes(event.event_date, event.event_time, offset, duration);
  return { summary, description, location: event.location || '', start: startDateTime, end: endDateTime };
}

async function upsertCalendarEvent(accessToken, calendarId, existingEventId, eventBody) {
  const baseUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  if (existingEventId) {
    const res = await fetch(`${baseUrl}/${existingEventId}`, {
      method: 'PATCH', headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(eventBody)
    });
    if (res.ok) return { success: true, eventId: (await res.json()).id };
    if (res.status !== 404) return { success: false, error: `PATCH ${res.status}` };
  }
  const res = await fetch(baseUrl, {
    method: 'POST', headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(eventBody)
  });
  if (!res.ok) return { success: false, error: `POST ${res.status}` };
  return { success: true, eventId: (await res.json()).id };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const body = await req.json();
    const syncType = body.syncType;

    if (!syncType || !['admin', 'supplier', 'client'].includes(syncType)) {
      return Response.json({ error: 'Invalid syncType. Must be "admin", "supplier" or "client"' }, { status: 400 });
    }

    const allSettings = await base44.asServiceRole.entities.AppSettings.list();
    const settingsMap = allSettings.reduce((acc, s) => { acc[s.setting_key] = s.setting_value; return acc; }, {});
    const adminCalendarId = settingsMap.admin_google_calendar_id || 'primary';

    let adminSupplierCategories = [];
    try { adminSupplierCategories = JSON.parse(settingsMap.google_calendar_admin_supplier_categories || '[]'); } catch (e) {}

    let accessToken;
    try {
      const connection = await base44.asServiceRole.connectors.getConnection("googlecalendar");
      accessToken = connection.accessToken;
    } catch (e) {
      return Response.json({ error: 'Google Calendar connector not authorized', details: e.message }, { status: 500 });
    }

    const allEvents = await base44.asServiceRole.entities.Event.list();
    const syncableEvents = allEvents.filter(ev => SYNCED_STATUSES.includes(ev.status));
    const allServices = await base44.asServiceRole.entities.Service.list();
    const allSuppliers = await base44.asServiceRole.entities.Supplier.list();
    const allUsers = await base44.asServiceRole.entities.User.list();
    const allEventServices = await base44.asServiceRole.entities.EventService.list();
    const suppliersMap = allSuppliers.reduce((acc, s) => { acc[s.id] = s; return acc; }, {});

    let synced = 0, skipped = 0, errors = 0;

    if (syncType === 'admin') {
      for (const event of syncableEvents) {
        const eventES = allEventServices.filter(es => es.event_id === event.id);
        const suppliersList = buildSuppliersList(eventES, allServices, allSuppliers, adminSupplierCategories);
        const eventBody = buildEventBody(event, 'admin', settingsMap, { suppliersList });
        const existingCalId = event.google_calendar_event_id;
        const result = await upsertCalendarEvent(accessToken, adminCalendarId, existingCalId, eventBody);
        if (result.success) {
          synced++;
          if (result.eventId !== existingCalId) {
            await base44.asServiceRole.entities.Event.update(event.id, { google_calendar_event_id: result.eventId });
          }
        } else {
          errors++;
          console.error(`Admin sync failed for event ${event.id}:`, result.error);
        }
      }
      skipped = allEvents.length - syncableEvents.length;
    }

    if (syncType === 'supplier') {
      const eventsMap = allEvents.reduce((acc, e) => { acc[e.id] = e; return acc; }, {});
      const servicesMap = allServices.reduce((acc, s) => { acc[s.id] = s; return acc; }, {});

      for (const es of allEventServices) {
        const event = eventsMap[es.event_id];
        if (!event || !SYNCED_STATUSES.includes(event.status)) { skipped++; continue; }

        let supplierIds = [];
        try { supplierIds = JSON.parse(es.supplier_ids || '[]'); } catch (e) {}
        let supplierStatuses = {};
        try { supplierStatuses = JSON.parse(es.supplier_statuses || '{}'); } catch (e) {}
        let supplierCalendarIds = {};
        try { supplierCalendarIds = JSON.parse(es.supplier_calendar_ids || '{}'); } catch (e) {}
        let supplierNotes = {};
        try { supplierNotes = JSON.parse(es.supplier_notes || '{}'); } catch (e) {}

        const serviceName = servicesMap[es.service_id]?.service_name || 'שירות';
        let calendarIdsChanged = false;

        for (const suppId of supplierIds) {
          const supplier = suppliersMap[suppId];
          const calId = supplier?.google_calendar_id || (supplier?.contact_emails?.[0]);
          if (!calId) { skipped++; continue; }

          const status = supplierStatuses[suppId] || 'pending';
          if (status !== 'confirmed') { skipped++; continue; }

          // Check supplier sync approval
          const supplierUser = allUsers.find(u => u.email && supplier.contact_emails?.includes(u.email));
          if (!supplierUser?.calendar_sync_approved) { skipped++; continue; }

          const existingCalEventId = supplierCalendarIds[suppId];
          const note = supplierNotes[suppId] || '';
          const eventBody = buildEventBody(event, 'supplier', settingsMap, { serviceName, supplierNote: note });
          const result = await upsertCalendarEvent(accessToken, calId, existingCalEventId, eventBody);

          if (result.success) {
            synced++;
            supplierCalendarIds[suppId] = result.eventId;
            calendarIdsChanged = true;
          } else {
            errors++;
          }
        }

        if (calendarIdsChanged) {
          await base44.asServiceRole.entities.EventService.update(es.id, {
            supplier_calendar_ids: JSON.stringify(supplierCalendarIds)
          });
        }
      }
    }

    if (syncType === 'client') {
      for (const event of syncableEvents) {
        const clientEmail = event.parents?.[0]?.email;
        const clientCalendarId = event.client_google_calendar_id || clientEmail;
        if (!clientCalendarId) { skipped++; continue; }

        // Check client sync approval
        const clientUser = allUsers.find(u => u.email === clientEmail);
        if (!clientUser?.calendar_sync_approved) { skipped++; continue; }

        const existingCalEventId = event.client_google_calendar_event_id;
        const eventBody = buildEventBody(event, 'client', settingsMap, {});
        const result = await upsertCalendarEvent(accessToken, clientCalendarId, existingCalEventId, eventBody);

        if (result.success) {
          synced++;
          if (result.eventId !== existingCalEventId) {
            await base44.asServiceRole.entities.Event.update(event.id, { client_google_calendar_event_id: result.eventId });
          }
        } else {
          errors++;
        }
      }
      skipped += allEvents.length - syncableEvents.length;
    }

    return Response.json({ success: true, syncType, synced, skipped, errors, totalEvents: allEvents.length, syncableEvents: syncableEvents.length });

  } catch (error) {
    console.error('Error in syncAllEventsToCalendar:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});