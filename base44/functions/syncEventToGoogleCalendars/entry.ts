import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * syncEventToGoogleCalendars - Admin calendar sync via Shared Connector
 * 
 * Uses the built-in Google Calendar shared connector (1 integration credit per call).
 * Only syncs events with status: confirmed, in_progress, completed.
 * If status changes to a non-synced status, deletes the event from the calendar.
 * 
 * Triggered by entity automations on Event and EventService changes.
 */

const EVENT_TYPE_HEBREW = {
  bar_mitzvah: 'בר מצווה',
  bat_mitzvah: 'בת מצווה',
  wedding: 'חתונה',
  other: 'אירוע'
};

// Statuses that should be synced to Google Calendar
const SYNCED_STATUSES = ['confirmed', 'in_progress', 'completed'];

/**
 * Build schedule text from event schedule array.
 */
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

/**
 * Calculate start and end times for a calendar event.
 */
function calculateTimes(eventDate, eventTime, offsetMinutes, durationHours) {
  if (!eventTime) {
    // All-day event
    const parts = eventDate.split('-').map(Number);
    const nextDay = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + 1));
    const nextDayStr = nextDay.toISOString().split('T')[0];
    return {
      startDateTime: { date: eventDate },
      endDateTime: { date: nextDayStr }
    };
  }

  const [hours, minutes] = eventTime.split(':').map(Number);
  // Build total minutes from midnight, apply offset, then convert back to hours:minutes
  let totalMinutes = hours * 60 + minutes + offsetMinutes;
  const startHours = Math.floor(totalMinutes / 60);
  const startMins = totalMinutes % 60;
  const hh = String(startHours).padStart(2, '0');
  const mm = String(startMins).padStart(2, '0');

  // Build ISO string explicitly in Israel timezone to avoid UTC conversion issues
  // Google Calendar API accepts dateTime with timezone, so we provide local time as-is
  const startIso = `${eventDate}T${hh}:${mm}:00`;

  const endTotalMinutes = totalMinutes + durationHours * 60;
  const endHours = Math.floor(endTotalMinutes / 60);
  const endMins = endTotalMinutes % 60;
  const ehh = String(endHours).padStart(2, '0');
  const emm = String(endMins).padStart(2, '0');
  const endIso = `${eventDate}T${ehh}:${emm}:00`;

  return {
    startDateTime: { dateTime: startIso, timeZone: 'Asia/Jerusalem' },
    endDateTime: { dateTime: endIso, timeZone: 'Asia/Jerusalem' }
  };
}

/**
 * Build calendar event body for ADMIN.
 * כותרת: סוג האירוע, של, שם החתן, שם המשפחה
 * גוף: אירוע, סוג, של, שם חתן, משפחה, בקונספט (אם יש), מספר משתתפים, לוז, תאריך, שעה
 * משך: 5 שעות
 */
function buildAdminEventBody(event) {
  const eventType = EVENT_TYPE_HEBREW[event.event_type] || 'אירוע';
  const childName = event.child_name || '';
  const familyName = event.family_name || '';

  // כותרת
  let summary = childName 
    ? `${eventType} של ${childName} ${familyName}`
    : `${eventType} של משפחת ${familyName}`;

  // גוף
  let description = childName
    ? `אירוע ${eventType} של ${childName} ${familyName}.`
    : `אירוע ${eventType} של משפחת ${familyName}.`;
  
  if (event.concept) {
    description += `\nבקונספט ${event.concept}.`;
  }
  description += `\nמספר משתתפים: ${event.guest_count || 'לא צוין'}.`;

  const scheduleText = buildScheduleText(event.schedule);
  if (scheduleText) {
    description += `\n\nלוז האירוע:\n${scheduleText}`;
  }

  const { startDateTime, endDateTime } = calculateTimes(event.event_date, event.event_time, 0, 6);

  return {
    summary,
    description,
    location: event.location || '',
    start: startDateTime,
    end: endDateTime
  };
}

/**
 * Build calendar event body for SUPPLIER.
 * כותרת: סוג האירוע, עם, שם החברה, שם השירות, הערה עבורך (הערה) - רק אם יש הערה
 * גוף: אירוע, סוג, של, שם חתן, משפחה, בקונספט (אם יש), לוז
 * שעה: 15 דקות לפני, משך: 3 שעות
 */
function buildSupplierEventBody(event, serviceName, supplierNote, companyName) {
  const eventType = EVENT_TYPE_HEBREW[event.event_type] || 'אירוע';
  const childName = event.child_name || '';
  const familyName = event.family_name || '';

  // כותרת
  let summary = `${eventType} עם ${companyName || ''}. שירות: ${serviceName}.`;
  if (supplierNote) {
    summary += ` הערה עבורך: (${supplierNote})`;
  }

  // גוף
  let description = childName
    ? `אירוע ${eventType} של ${childName} ${familyName}.`
    : `אירוע ${eventType} של משפחת ${familyName}.`;
  
  if (event.concept) {
    description += `\nבקונספט ${event.concept}.`;
  }

  const scheduleText = buildScheduleText(event.schedule);
  if (scheduleText) {
    description += `\n\nלוז האירוע:\n${scheduleText}`;
  }

  // שעת התחלה: 15 דקות לפני שעת האירוע, משך: 3 שעות
  const { startDateTime, endDateTime } = calculateTimes(event.event_date, event.event_time, -15, 3);

  return {
    summary,
    description,
    location: event.location || '',
    start: startDateTime,
    end: endDateTime
  };
}

/**
 * Create or update a Google Calendar event using the shared connector token.
 */
async function upsertCalendarEvent(accessToken, calendarId, existingEventId, eventBody) {
  const baseUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;

  if (existingEventId) {
    const res = await fetch(`${baseUrl}/${existingEventId}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(eventBody)
    });
    if (res.ok) {
      const data = await res.json();
      return { success: true, eventId: data.id };
    }
    if (res.status !== 404) {
      console.error(`Calendar PATCH failed (${res.status}):`, await res.text());
      return { success: false, error: `PATCH failed: ${res.status}` };
    }
    // 404 = deleted externally, fall through to create
  }

  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(eventBody)
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`Calendar POST failed (${res.status}):`, errText);
    return { success: false, error: `POST failed: ${res.status}` };
  }

  const data = await res.json();
  return { success: true, eventId: data.id };
}

/**
 * Delete a Google Calendar event.
 */
async function deleteCalendarEvent(accessToken, calendarId, existingEventId) {
  if (!existingEventId) return { success: true };

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${existingEventId}`,
    { method: 'DELETE', headers: { 'Authorization': `Bearer ${accessToken}` } }
  );

  if (res.ok || res.status === 404 || res.status === 410) {
    return { success: true };
  }

  console.error(`Calendar DELETE failed (${res.status}):`, await res.text());
  return { success: false, error: `DELETE failed: ${res.status}` };
}


Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const body = await req.json();
    // Support both direct call and automation trigger
    const eventId = body.eventId || body.data?.id || body.event?.entity_id;
    const triggerAction = body.action || body.event?.type; // 'create', 'update', 'delete'
    const eventServiceId = body.eventServiceId;
    const entityName = body.event?.entity_name; // 'Event' or 'EventService'
    // For delete triggers, body.data contains the entity data BEFORE deletion
    const deletedEntityData = triggerAction === 'delete' ? body.data : null;

    if (!eventId && !eventServiceId) {
      return Response.json({ error: 'Missing eventId or eventServiceId' }, { status: 400 });
    }

    // ====================================================
    // LOAD SETTINGS (no credits used)
    // ====================================================
    const allSettings = await base44.asServiceRole.entities.AppSettings.list();
    const settingsMap = allSettings.reduce((acc, s) => { acc[s.setting_key] = s.setting_value; return acc; }, {});

    const adminSyncEnabled = settingsMap.google_calendar_admin_sync_enabled === 'true';
    const supplierSyncEnabled = settingsMap.google_calendar_supplier_sync_enabled === 'true';

    if (!adminSyncEnabled && !supplierSyncEnabled) {
      return Response.json({ skipped: true, message: 'Google Calendar sync is disabled' });
    }

    const companyName = settingsMap.company_name || '';
    const adminCalendarId = settingsMap.admin_google_calendar_id || 'primary';

    // ====================================================
    // DETERMINE EVENT ID
    // ====================================================
    let actualEventId = eventId;
    let targetEventService = null;

    if (entityName === 'EventService' || eventServiceId) {
      const esId = eventServiceId || body.event?.entity_id;
      if (esId) {
        try {
          targetEventService = await base44.asServiceRole.entities.EventService.get(esId);
          actualEventId = targetEventService?.event_id || eventId;
        } catch (e) {
          console.log(`EventService ${esId} not found (may have been deleted)`);
          // For delete triggers, use pre-deletion data as fallback
          if (deletedEntityData) {
            targetEventService = deletedEntityData;
            actualEventId = deletedEntityData.event_id || eventId;
          }
        }
      }
    }

    if (!actualEventId) {
      return Response.json({ error: 'Could not determine eventId' }, { status: 400 });
    }

    // ====================================================
    // LOAD EVENT
    // ====================================================
    let event;
    try {
      event = await base44.asServiceRole.entities.Event.get(actualEventId);
    } catch (e) {
      console.log(`Event ${actualEventId} not found - handling as delete`);
    }

    // For delete triggers on Event entity, use the pre-deletion data as fallback
    // This ensures we have google_calendar_event_id even after the event is deleted
    const eventForCalendarIds = event || (entityName === 'Event' && deletedEntityData ? deletedEntityData : null);

    const isDeleteAction = triggerAction === 'delete' || !event;
    const isStatusSynced = event && SYNCED_STATUSES.includes(event.status);

    // If event exists but status is NOT in synced list, treat as delete (remove from calendar)
    const shouldDelete = isDeleteAction || !isStatusSynced;

    // ====================================================
    // GET SHARED CONNECTOR TOKEN (1 integration credit)
    // This single token is used for ALL calendar operations
    // ====================================================
    let accessToken;
    try {
      const connection = await base44.asServiceRole.connectors.getConnection("googlecalendar");
      accessToken = connection.accessToken;
    } catch (e) {
      console.error('Failed to get Google Calendar connector token:', e);
      return Response.json({ error: 'Google Calendar connector not authorized', details: e.message }, { status: 500 });
    }

    const results = [];

    // ====================================================
    // ADMIN SYNC (uses shared connector token + admin calendar ID from settings)
    // ====================================================
    if (adminSyncEnabled) {
      const existingEventId = event?.google_calendar_event_id || eventForCalendarIds?.google_calendar_event_id;

      if (shouldDelete) {
        // Delete from admin calendar
        if (existingEventId) {
          const delResult = await deleteCalendarEvent(accessToken, adminCalendarId, existingEventId);
          results.push({ target: 'admin', ...delResult, action: 'delete' });
          if (delResult.success && event) {
            await base44.asServiceRole.entities.Event.update(actualEventId, { google_calendar_event_id: null });
          }
        } else {
          results.push({ target: 'admin', success: true, action: 'skip', reason: 'no existing calendar event' });
        }
      } else {
        // Create or update in admin calendar
        const eventBody = buildAdminEventBody(event);
        const upsertResult = await upsertCalendarEvent(accessToken, adminCalendarId, existingEventId, eventBody);
        results.push({ target: 'admin', ...upsertResult, action: existingEventId ? 'update' : 'create' });

        if (upsertResult.success && upsertResult.eventId !== existingEventId) {
          await base44.asServiceRole.entities.Event.update(actualEventId, { google_calendar_event_id: upsertResult.eventId });
        }
      }
    }

    // ====================================================
    // SUPPLIER SYNC (also uses shared connector token - same credit!)
    // Suppliers get events synced only when status is approved ('confirmed')
    // ====================================================
    if (supplierSyncEnabled && !isDeleteAction) {
      // Load event services and related data
      const allEventServices = event ? await base44.asServiceRole.entities.EventService.filter({ event_id: actualEventId }) : [];
      const allServices = await base44.asServiceRole.entities.Service.list();
      const servicesMap = allServices.reduce((acc, s) => { acc[s.id] = s; return acc; }, {});
      const allSuppliers = await base44.asServiceRole.entities.Supplier.list();
      const suppliersMap = allSuppliers.reduce((acc, s) => { acc[s.id] = s; return acc; }, {});

      const eventServicesToProcess = targetEventService ? [targetEventService] : allEventServices;

      for (const es of eventServicesToProcess) {
        let supplierIds = [];
        try { supplierIds = JSON.parse(es.supplier_ids || '[]'); } catch (e) {}
        let supplierStatuses = {};
        try { supplierStatuses = JSON.parse(es.supplier_statuses || '{}'); } catch (e) {}
        let supplierCalendarIds = {};
        try { supplierCalendarIds = JSON.parse(es.supplier_calendar_ids || '{}'); } catch (e) {}
        let supplierNotes = {};
        try { supplierNotes = JSON.parse(es.supplier_notes || '{}'); } catch (e) {}

        let calendarIdsChanged = false;
        const serviceName = servicesMap[es.service_id]?.service_name || 'שירות';

        for (const suppId of supplierIds) {
          const supplier = suppliersMap[suppId];
          if (!supplier) continue;

          const status = supplierStatuses[suppId] || 'pending';
          const isConfirmed = status === 'confirmed';
          const existingCalEventId = supplierCalendarIds[suppId];

          // Supplier calendar ID from supplier entity
          const supplierCalendarId = supplier.google_calendar_id;
          if (!supplierCalendarId) {
            // Supplier has no calendar configured - skip
            continue;
          }

          if (shouldDelete || !isConfirmed) {
            // Delete: event not synced status, or supplier not confirmed
            if (existingCalEventId) {
              const delResult = await deleteCalendarEvent(accessToken, supplierCalendarId, existingCalEventId);
              results.push({ target: 'supplier', supplierId: suppId, esId: es.id, ...delResult, action: 'delete' });
              if (delResult.success) {
                delete supplierCalendarIds[suppId];
                calendarIdsChanged = true;
              }
            }
          } else {
            // Create or update: supplier is confirmed + event has synced status
            const note = supplierNotes[suppId] || '';
            const eventBody = buildSupplierEventBody(event, serviceName, note, companyName);
            const upsertResult = await upsertCalendarEvent(accessToken, supplierCalendarId, existingCalEventId, eventBody);
            results.push({ target: 'supplier', supplierId: suppId, esId: es.id, ...upsertResult, action: existingCalEventId ? 'update' : 'create' });

            if (upsertResult.success) {
              supplierCalendarIds[suppId] = upsertResult.eventId;
              calendarIdsChanged = true;
            }
          }
        }

        // Clean up orphaned calendar entries (suppliers removed from service)
        for (const oldSuppId of Object.keys(supplierCalendarIds)) {
          if (!supplierIds.includes(oldSuppId) && supplierCalendarIds[oldSuppId]) {
            const supplier = suppliersMap[oldSuppId];
            if (supplier?.google_calendar_id) {
              await deleteCalendarEvent(accessToken, supplier.google_calendar_id, supplierCalendarIds[oldSuppId]);
            }
            delete supplierCalendarIds[oldSuppId];
            calendarIdsChanged = true;
          }
        }

        if (calendarIdsChanged) {
          await base44.asServiceRole.entities.EventService.update(es.id, {
            supplier_calendar_ids: JSON.stringify(supplierCalendarIds)
          });
        }
      }
    } else if (supplierSyncEnabled && isDeleteAction) {
      // Event deleted - clean up all supplier calendar entries
      // For EventService delete trigger, use deletedEntityData if available
      let allEventServices = await base44.asServiceRole.entities.EventService.filter({ event_id: actualEventId }).catch(() => []);
      if (allEventServices.length === 0 && entityName === 'EventService' && deletedEntityData?.supplier_calendar_ids) {
        allEventServices = [deletedEntityData];
      }
      const allSuppliers = await base44.asServiceRole.entities.Supplier.list();
      const suppliersMap = allSuppliers.reduce((acc, s) => { acc[s.id] = s; return acc; }, {});

      for (const es of allEventServices) {
        let supplierCalendarIds = {};
        try { supplierCalendarIds = JSON.parse(es.supplier_calendar_ids || '{}'); } catch (e) {}

        let changed = false;
        for (const [suppId, calEventId] of Object.entries(supplierCalendarIds)) {
          if (calEventId) {
            const supplier = suppliersMap[suppId];
            if (supplier?.google_calendar_id) {
              await deleteCalendarEvent(accessToken, supplier.google_calendar_id, calEventId);
            }
            delete supplierCalendarIds[suppId];
            changed = true;
          }
        }

        if (changed) {
          await base44.asServiceRole.entities.EventService.update(es.id, {
            supplier_calendar_ids: JSON.stringify(supplierCalendarIds)
          }).catch(e => console.log('Could not update ES during delete cleanup:', e));
        }
      }
    }

    return Response.json({ success: true, results });

  } catch (error) {
    console.error('Error in syncEventToGoogleCalendars:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});