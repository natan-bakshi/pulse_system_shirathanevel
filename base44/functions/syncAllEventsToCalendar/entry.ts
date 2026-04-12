import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * syncAllEventsToCalendar - Mass sync all relevant events to Google Calendar.
 * 
 * Called manually from settings page.
 * Accepts: { syncType: 'admin' | 'supplier' }
 * 
 * For admin: syncs all events with SYNCED_STATUSES to admin calendar.
 * For supplier: syncs all supplier assignments with confirmed status.
 */

const EVENT_TYPE_HEBREW = {
  bar_mitzvah: 'בר מצווה',
  bat_mitzvah: 'בת מצווה',
  wedding: 'חתונה',
  other: 'אירוע'
};

const SYNCED_STATUSES = ['confirmed', 'in_progress', 'completed'];

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

function calculateTimes(eventDate, eventTime, offsetMinutes, durationHours) {
  if (!eventTime) {
    const nextDay = new Date(eventDate);
    nextDay.setDate(nextDay.getDate() + 1);
    return {
      startDateTime: { date: eventDate },
      endDateTime: { date: nextDay.toISOString().split('T')[0] }
    };
  }
  const [hours, minutes] = eventTime.split(':').map(Number);
  const startDate = new Date(eventDate + 'T00:00:00+03:00');
  startDate.setHours(hours, minutes + offsetMinutes, 0, 0);
  const endDate = new Date(startDate);
  endDate.setHours(endDate.getHours() + durationHours);
  return {
    startDateTime: { dateTime: startDate.toISOString(), timeZone: 'Asia/Jerusalem' },
    endDateTime: { dateTime: endDate.toISOString(), timeZone: 'Asia/Jerusalem' }
  };
}

function buildAdminEventBody(event) {
  const eventType = EVENT_TYPE_HEBREW[event.event_type] || 'אירוע';
  const childName = event.child_name || '';
  const familyName = event.family_name || '';
  let summary = childName 
    ? `${eventType}, של, ${childName}, ${familyName}`
    : `${eventType}, של, משפחת ${familyName}`;
  let description = childName
    ? `אירוע, ${eventType}, של, ${childName}, משפחת ${familyName}`
    : `אירוע, ${eventType}, של, משפחת ${familyName}`;
  if (event.concept) description += `, בקונספט, ${event.concept}`;
  description += `.`;
  description += `\nמספר משתתפים: ${event.guest_count || 'לא צוין'}`;
  const scheduleText = buildScheduleText(event.schedule);
  if (scheduleText) description += `\n\nלוז האירוע:\n${scheduleText}`;
  const { startDateTime, endDateTime } = calculateTimes(event.event_date, event.event_time, 0, 5);
  return { summary, description, location: event.location || '', start: startDateTime, end: endDateTime };
}

function buildSupplierEventBody(event, serviceName, supplierNote, companyName) {
  const eventType = EVENT_TYPE_HEBREW[event.event_type] || 'אירוע';
  const childName = event.child_name || '';
  const familyName = event.family_name || '';
  let summary = `${eventType}, עם, ${companyName || ''}, ${serviceName}`;
  if (supplierNote) summary += `, הערה עבורך (${supplierNote})`;
  let description = childName
    ? `אירוע, ${eventType}, של, ${childName}, משפחת ${familyName}`
    : `אירוע, ${eventType}, של, משפחת ${familyName}`;
  if (event.concept) description += `, בקונספט, ${event.concept}`;
  description += `.`;
  const scheduleText = buildScheduleText(event.schedule);
  if (scheduleText) description += `\n\nלוז האירוע:\n${scheduleText}`;
  const { startDateTime, endDateTime } = calculateTimes(event.event_date, event.event_time, -15, 3);
  return { summary, description, location: event.location || '', start: startDateTime, end: endDateTime };
}

async function upsertCalendarEvent(accessToken, calendarId, existingEventId, eventBody) {
  const baseUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  if (existingEventId) {
    const res = await fetch(`${baseUrl}/${existingEventId}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(eventBody)
    });
    if (res.ok) return { success: true, eventId: (await res.json()).id };
    if (res.status !== 404) return { success: false, error: `PATCH ${res.status}` };
  }
  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
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
    const syncType = body.syncType; // 'admin' or 'supplier'

    if (!syncType || !['admin', 'supplier'].includes(syncType)) {
      return Response.json({ error: 'Invalid syncType. Must be "admin" or "supplier"' }, { status: 400 });
    }

    // Load settings
    const allSettings = await base44.asServiceRole.entities.AppSettings.list();
    const settingsMap = allSettings.reduce((acc, s) => { acc[s.setting_key] = s.setting_value; return acc; }, {});
    const companyName = settingsMap.company_name || '';
    const adminCalendarId = settingsMap.admin_google_calendar_id || 'primary';

    // Get access token (1 credit)
    let accessToken;
    try {
      const connection = await base44.asServiceRole.connectors.getConnection("googlecalendar");
      accessToken = connection.accessToken;
    } catch (e) {
      return Response.json({ error: 'Google Calendar connector not authorized', details: e.message }, { status: 500 });
    }

    // Load all events
    const allEvents = await base44.asServiceRole.entities.Event.list();
    const syncableEvents = allEvents.filter(ev => SYNCED_STATUSES.includes(ev.status));

    let synced = 0;
    let skipped = 0;
    let errors = 0;

    if (syncType === 'admin') {
      for (const event of syncableEvents) {
        const eventBody = buildAdminEventBody(event);
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
      const allEventServices = await base44.asServiceRole.entities.EventService.list();
      const allServices = await base44.asServiceRole.entities.Service.list();
      const servicesMap = allServices.reduce((acc, s) => { acc[s.id] = s; return acc; }, {});
      const allSuppliers = await base44.asServiceRole.entities.Supplier.list();
      const suppliersMap = allSuppliers.reduce((acc, s) => { acc[s.id] = s; return acc; }, {});
      const eventsMap = allEvents.reduce((acc, e) => { acc[e.id] = e; return acc; }, {});

      for (const es of allEventServices) {
        const event = eventsMap[es.event_id];
        if (!event || !SYNCED_STATUSES.includes(event.status)) {
          skipped++;
          continue;
        }

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
          if (!supplier?.google_calendar_id) { skipped++; continue; }

          const status = supplierStatuses[suppId] || 'pending';
          if (status !== 'confirmed') { skipped++; continue; }

          const existingCalEventId = supplierCalendarIds[suppId];
          const note = supplierNotes[suppId] || '';
          const eventBody = buildSupplierEventBody(event, serviceName, note, companyName);
          const result = await upsertCalendarEvent(accessToken, supplier.google_calendar_id, existingCalEventId, eventBody);

          if (result.success) {
            synced++;
            supplierCalendarIds[suppId] = result.eventId;
            calendarIdsChanged = true;
          } else {
            errors++;
            console.error(`Supplier sync failed for ES ${es.id}, supplier ${suppId}:`, result.error);
          }
        }

        if (calendarIdsChanged) {
          await base44.asServiceRole.entities.EventService.update(es.id, {
            supplier_calendar_ids: JSON.stringify(supplierCalendarIds)
          });
        }
      }
    }

    return Response.json({ 
      success: true, 
      syncType,
      synced, 
      skipped, 
      errors,
      totalEvents: allEvents.length,
      syncableEvents: syncableEvents.length
    });

  } catch (error) {
    console.error('Error in syncAllEventsToCalendar:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});