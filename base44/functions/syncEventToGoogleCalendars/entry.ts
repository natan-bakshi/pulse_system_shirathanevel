import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * syncEventToGoogleCalendars - Full calendar sync via Shared Connector
 * 
 * Uses the built-in Google Calendar shared connector (1 integration credit per call).
 * Syncs events to: admin (primary), additional admins, suppliers, clients.
 * Content and timing are customized per user type using configurable templates.
 * 
 * Triggered by entity automations on Event and EventService changes.
 */

const EVENT_TYPE_HEBREW = {
  bar_mitzvah: 'בר מצווה',
  bat_mitzvah: 'בת מצווה',
  wedding: 'חתונה',
  other: 'אירוע'
};

const SYNCED_STATUSES = ['confirmed', 'in_progress', 'completed'];
const CALENDAR_SYNC_FAILURE_KEY = 'google_calendar_sync_failure_state';
const CALENDAR_SYNC_FAILURE_THRESHOLD = 3;
const CALENDAR_SYNC_COOLDOWN_MINUTES = 60;

function normalizeEntityName(value) {
  return value || '';
}

function normalizeEntityId(event) {
  return event?.entity_id || event?.entityid || event?.entityId || null;
}

function isCalendarMetadataOnlyChange(changedFields) {
  if (!Array.isArray(changedFields) || changedFields.length === 0) return false;
  const calendarMetadataFields = new Set([
    'google_calendar_event_id',
    'client_google_calendar_event_id',
    'client_google_calendar_id',
    'admin_other_google_calendar_ids',
    'supplier_calendar_ids'
  ]);
  return changedFields.every(field => calendarMetadataFields.has(field));
}

function inferChangedFields(data, oldData) {
  if (!data || !oldData) return [];
  const keys = new Set([...Object.keys(data), ...Object.keys(oldData)]);
  const changed = [];
  for (const key of keys) {
    if (JSON.stringify(data[key] ?? null) !== JSON.stringify(oldData[key] ?? null)) {
      changed.push(key);
    }
  }
  return changed;
}

function stableStringifyObject(value) {
  const obj = value && typeof value === 'object' ? value : {};
  const sorted = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return JSON.stringify(sorted);
}

function hasRelevantCalendarChange(entityName, triggerAction, changedFields) {
  if (triggerAction !== 'update') return true;
  if (!Array.isArray(changedFields) || changedFields.length === 0) return true;

  const eventFields = new Set([
    'status', 'event_name', 'event_type', 'event_date', 'event_time', 'location', 'concept',
    'family_name', 'child_name', 'guest_count', 'notes', 'schedule', 'parents',
    'organizer_contacts', 'custom_organizer_fields'
  ]);
  const eventServiceFields = new Set([
    'event_id', 'service_id', 'supplier_ids', 'supplier_statuses', 'supplier_notes',
    'supplier_arrival_time', 'pickup_point', 'standing_time', 'on_site_contact_details'
  ]);

  const relevantFields = entityName === 'EventService' ? eventServiceFields : eventFields;
  return changedFields.some(field => relevantFields.has(field));
}

function getSyncFailureState(settingsMap) {
  try {
    return JSON.parse(settingsMap[CALENDAR_SYNC_FAILURE_KEY] || '{}');
  } catch (e) {
    return {};
  }
}

async function saveSyncFailureState(base44, allSettings, state) {
  const value = JSON.stringify(state);
  const existing = allSettings.find(s => s.setting_key === CALENDAR_SYNC_FAILURE_KEY);
  if (existing) {
    await base44.asServiceRole.entities.AppSettings.update(existing.id, { setting_value: value });
  } else {
    await base44.asServiceRole.entities.AppSettings.create({
      setting_key: CALENDAR_SYNC_FAILURE_KEY,
      setting_value: value,
      setting_type: 'object',
      description: 'מצב כשלים זמני לסנכרון Google Calendar כדי לעצור לולאות כשל ובזבוז קרדיטים'
    });
  }
}

async function clearSyncFailureState(base44, allSettings) {
  const existing = allSettings.find(s => s.setting_key === CALENDAR_SYNC_FAILURE_KEY);
  if (existing && existing.setting_value !== JSON.stringify({ count: 0 })) {
    await base44.asServiceRole.entities.AppSettings.update(existing.id, { setting_value: JSON.stringify({ count: 0 }) });
  }
}

async function recordSyncFailure(base44, allSettings, settingsMap, errorMessage) {
  const current = getSyncFailureState(settingsMap);
  const count = (current.count || 0) + 1;
  const state = {
    count,
    last_error: String(errorMessage || '').slice(0, 500),
    last_failure_at: new Date().toISOString()
  };

  if (count >= CALENDAR_SYNC_FAILURE_THRESHOLD) {
    state.paused_until = new Date(Date.now() + CALENDAR_SYNC_COOLDOWN_MINUTES * 60 * 1000).toISOString();
  }

  await saveSyncFailureState(base44, allSettings, state);
  return state;
}

// Default templates (used when no custom templates are configured)
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
 * Build suppliers list for admin description.
 * Only includes confirmed suppliers from selected service categories.
 */
function buildSuppliersList(allEventServices, allServices, allSuppliers, selectedCategories) {
  if (!selectedCategories || selectedCategories.length === 0) return '';

  const servicesMap = {};
  for (const s of allServices) servicesMap[s.id] = s;
  const suppliersMap = {};
  for (const s of allSuppliers) suppliersMap[s.id] = s;

  const lines = [];

  for (const es of allEventServices) {
    const service = servicesMap[es.service_id];
    if (!service) continue;
    // Check if this service is in selected categories
    if (!selectedCategories.includes(service.service_name)) continue;

    let supplierIds = [];
    try { supplierIds = JSON.parse(es.supplier_ids || '[]'); } catch (e) {}
    let supplierStatuses = {};
    try { supplierStatuses = JSON.parse(es.supplier_statuses || '{}'); } catch (e) {}
    let supplierNotes = {};
    try { supplierNotes = JSON.parse(es.supplier_notes || '{}'); } catch (e) {}

    const confirmedSuppliers = supplierIds
      .filter(id => (supplierStatuses[id] || 'pending') === 'confirmed')
      .map(id => {
        const supplier = suppliersMap[id];
        if (!supplier) return null;
        const note = supplierNotes[id];
        return note ? `${supplier.supplier_name} (${note})` : supplier.supplier_name;
      })
      .filter(Boolean);

    if (confirmedSuppliers.length > 0) {
      lines.push(`${service.service_name}: ${confirmedSuppliers.join(', ')}`);
    }
  }

  return lines.join('\n');
}

/**
 * Parse a template string with variables and conditional blocks.
 * Variables: {{variable_name}}
 * Conditional blocks: [[ text with {{variable}} ]] - only included if all variables inside are non-empty
 */
function parseTemplate(template, data) {
  if (!template) return '';

  // First, handle conditional blocks [[ ... ]]
  let result = template.replace(/\[\[([\s\S]*?)\]\]/g, (match, content) => {
    // Find all variables in this block
    const vars = content.match(/\{\{(\w+)\}\}/g);
    if (!vars) return content; // No variables, always include

    // Check if ALL variables in this block have values
    for (const v of vars) {
      const key = v.replace(/\{\{|\}\}/g, '');
      const val = data[key];
      if (val === undefined || val === null || val === '') return '';
    }

    // All variables have values, replace them and include the block
    return content.replace(/\{\{(\w+)\}\}/g, (m, key) => data[key] || '');
  });

  // Then, replace remaining standalone variables
  result = result.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const val = data[key];
    return (val !== undefined && val !== null && val !== '') ? val : '';
  });

  // Clean up multiple empty lines
  result = result.replace(/\n{3,}/g, '\n\n').trim();

  return result;
}

/**
 * Calculate start and end times for a calendar event.
 */
function calculateTimes(eventDate, eventTime, offsetMinutes, durationHours) {
  if (!eventTime) {
    const parts = eventDate.split('-').map(Number);
    const nextDay = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + 1));
    const nextDayStr = nextDay.toISOString().split('T')[0];
    return {
      startDateTime: { date: eventDate },
      endDateTime: { date: nextDayStr }
    };
  }

  const [hours, minutes] = eventTime.split(':').map(Number);
  let totalMinutes = hours * 60 + minutes + offsetMinutes;
  const startHours = Math.floor(totalMinutes / 60);
  const startMins = totalMinutes % 60;
  const hh = String(startHours).padStart(2, '0');
  const mm = String(startMins).padStart(2, '0');
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
 * Build calendar event body using templates.
 */
function buildEventBody(event, userType, settingsMap, extraData) {
  const eventType = EVENT_TYPE_HEBREW[event.event_type] || 'אירוע';
  const companyName = settingsMap.company_name || '';
  const appLink = settingsMap.app_base_url || '';

  // Get templates
  const summaryTemplate = settingsMap[`google_calendar_${userType}_summary_template`] || DEFAULT_TEMPLATES[userType].summary;
  const descriptionTemplate = settingsMap[`google_calendar_${userType}_description_template`] || DEFAULT_TEMPLATES[userType].description;

  // Build data object for template
  const data = {
    event_type_hebrew: eventType,
    event_name: event.event_name || '',
    child_name: event.child_name || '',
    family_name: event.family_name || '',
    concept: event.concept || '',
    guest_count: event.guest_count ? String(event.guest_count) : '',
    notes: event.notes || '',
    schedule_text: buildScheduleText(event.schedule),
    company_name: companyName,
    app_link: appLink,
    // Supplier-specific
    service_name: extraData?.serviceName || '',
    supplier_note: extraData?.supplierNote || '',
    // Admin-specific
    suppliers_list: extraData?.suppliersList || '',
  };

  const summary = parseTemplate(summaryTemplate, data);
  const description = parseTemplate(descriptionTemplate, data);

  // Calculate times based on user type
  let offsetMinutes = 0;
  let durationHours = 6;
  let baseTime = event.event_time;
  if (userType === 'supplier') {
    offsetMinutes = -15;
    durationHours = 3;
    // אם הוגדרה שעת התייצבות ייעודית לספק - נשתמש בה כשעת בסיס במקום שעת האירוע
    const arrivalTime = extraData?.supplierArrivalTime;
    if (arrivalTime && typeof arrivalTime === 'string' && arrivalTime.trim() !== '') {
      baseTime = arrivalTime.trim();
      // כששעת ההתייצבות הוגדרה, היא כבר השעה הסופית - לא להחסיר עוד 15 דקות
      offsetMinutes = 0;
    }
  }

  const { startDateTime, endDateTime } = calculateTimes(event.event_date, baseTime, offsetMinutes, durationHours);

  return {
    summary,
    description,
    location: event.location || '',
    start: startDateTime,
    end: endDateTime
  };
}

/**
 * Create or update a Google Calendar event.
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
  let base44;
  try {
    base44 = createClientFromRequest(req);

    const body = await req.json().catch(() => ({}));
    const entityName = normalizeEntityName(body.event?.entity_name || body.event?.entityname || body.entity_name || body.entityName);
    const entityId = normalizeEntityId(body.event);
    const triggerAction = body.action || body.event?.type;
    const eventServiceId = body.eventServiceId || body.event_service_id || (entityName === 'EventService' ? entityId : null);
    const eventId = body.eventId || body.event_id || body.data?.id || body.data?.event_id || (entityName === 'Event' ? entityId : null);
    const providedChangedFields = body.changed_fields || body.changedFields;
    const changedFields = Array.isArray(providedChangedFields) ? providedChangedFields : inferChangedFields(body.data, body.old_data);
    const deletedEntityData = triggerAction === 'delete' ? body.data : null;

    if (!eventId && !eventServiceId) {
      console.warn('[GoogleCalendarSync] Skipping empty trigger payload', JSON.stringify({ entityName, triggerAction, entityId }));
      return Response.json({ skipped: true, reason: 'Missing eventId/eventServiceId - no calendar work performed' });
    }

    if (isCalendarMetadataOnlyChange(changedFields)) {
      return Response.json({ skipped: true, reason: 'Calendar metadata fields changed only', changed_fields: changedFields });
    }

    if (!hasRelevantCalendarChange(entityName, triggerAction, changedFields)) {
      return Response.json({ skipped: true, reason: 'No calendar-relevant fields changed', changed_fields: changedFields });
    }

    // ====================================================
    // LOAD SETTINGS
    // ====================================================
    const allSettings = await base44.asServiceRole.entities.AppSettings.list();
    const settingsMap = allSettings.reduce((acc, s) => { acc[s.setting_key] = s.setting_value; return acc; }, {});

    const adminSyncEnabled = settingsMap.google_calendar_admin_sync_enabled === 'true';
    const supplierSyncEnabled = settingsMap.google_calendar_supplier_sync_enabled === 'true';
    const clientSyncEnabled = settingsMap.google_calendar_client_sync_enabled === 'true';

    if (!adminSyncEnabled && !supplierSyncEnabled && !clientSyncEnabled) {
      return Response.json({ skipped: true, message: 'Google Calendar sync is disabled' });
    }

    const failureState = getSyncFailureState(settingsMap);
    if (failureState.paused_until && new Date(failureState.paused_until) > new Date()) {
      return Response.json({
        skipped: true,
        reason: 'Google Calendar sync is temporarily paused after repeated failures',
        paused_until: failureState.paused_until,
        last_error: failureState.last_error || ''
      });
    }

    const adminCalendarId = settingsMap.admin_google_calendar_id || 'primary';

    // Parse supplier categories for admin view
    let adminSupplierCategories = [];
    try { adminSupplierCategories = JSON.parse(settingsMap.google_calendar_admin_supplier_categories || '[]'); } catch (e) {}

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
          if (deletedEntityData) {
            targetEventService = deletedEntityData;
            actualEventId = deletedEntityData.event_id || eventId;
          }
        }
      }
    }

    if (!actualEventId) {
      return Response.json({ skipped: true, reason: 'Could not determine eventId - no calendar work performed' });
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

    const eventForCalendarIds = event || (entityName === 'Event' && deletedEntityData ? deletedEntityData : null);
    const isDeleteAction = triggerAction === 'delete' || !event;
    const isStatusSynced = event && SYNCED_STATUSES.includes(event.status);
    const shouldDelete = isDeleteAction || !isStatusSynced;

    if (entityName === 'Event' && isDeleteAction && !eventForCalendarIds) {
      return Response.json({ skipped: true, reason: 'Event data unavailable for delete - no calendar ids to remove' });
    }

    // ====================================================
    // GET SHARED CONNECTOR TOKEN (1 integration credit)
    // ====================================================
    let accessToken;
    try {
      const connection = await base44.asServiceRole.connectors.getConnection("googlecalendar");
      accessToken = connection.accessToken;
    } catch (e) {
      console.error('Failed to get Google Calendar connector token:', e);
      const failure = await recordSyncFailure(base44, allSettings, settingsMap, e.message);
      return Response.json({
        success: false,
        handled: true,
        error: 'Google Calendar connector not authorized',
        details: e.message,
        paused_until: failure.paused_until || null
      });
    }

    const results = [];

    // ====================================================
    // LOAD SHARED DATA (only once, used by multiple sections)
    // ====================================================
    const allEventServices = event ? await base44.asServiceRole.entities.EventService.filter({ event_id: actualEventId }).catch(() => []) : [];
    const allServices = await base44.asServiceRole.entities.Service.list();
    const servicesMap = allServices.reduce((acc, s) => { acc[s.id] = s; return acc; }, {});
    const allSuppliers = await base44.asServiceRole.entities.Supplier.list();
    const suppliersMap = allSuppliers.reduce((acc, s) => { acc[s.id] = s; return acc; }, {});
    const allUsers = await base44.asServiceRole.entities.User.list();

    // Build admin suppliers list
    const suppliersList = event ? buildSuppliersList(allEventServices, allServices, allSuppliers, adminSupplierCategories) : '';

    // ====================================================
    // ADMIN PRIMARY SYNC
    // ====================================================
    if (adminSyncEnabled) {
      // Check if primary admin has approved sync
      const primaryAdminEmail = settingsMap.admin_primary_email || null;
      let primaryAdminApproved = true; // Default to true for backwards compat
      if (primaryAdminEmail) {
        const primaryAdminUser = allUsers.find(u => u.email === primaryAdminEmail);
        if (primaryAdminUser && primaryAdminUser.calendar_sync_approved === false) {
          primaryAdminApproved = false;
        }
      }

      const existingEventId = event?.google_calendar_event_id || eventForCalendarIds?.google_calendar_event_id;

      if (shouldDelete || !primaryAdminApproved) {
        if (existingEventId) {
          const delResult = await deleteCalendarEvent(accessToken, adminCalendarId, existingEventId);
          results.push({ target: 'admin', ...delResult, action: 'delete' });
          if (delResult.success && event) {
            await base44.asServiceRole.entities.Event.update(actualEventId, { google_calendar_event_id: null });
          }
        }
      } else {
        const eventBody = buildEventBody(event, 'admin', settingsMap, { suppliersList });
        const upsertResult = await upsertCalendarEvent(accessToken, adminCalendarId, existingEventId, eventBody);
        results.push({ target: 'admin', ...upsertResult, action: existingEventId ? 'update' : 'create' });

        if (upsertResult.success && upsertResult.eventId !== existingEventId) {
          await base44.asServiceRole.entities.Event.update(actualEventId, { google_calendar_event_id: upsertResult.eventId });
        }
      }

      // ====================================================
      // ADDITIONAL ADMINS SYNC
      // ====================================================
      const additionalAdmins = allUsers.filter(u => 
        u.role === 'admin' && 
        u.calendar_sync_approved === true && 
        u.google_calendar_id &&
        u.google_calendar_id !== adminCalendarId
      );

      let adminOtherCalendarIds = {};
      try { adminOtherCalendarIds = JSON.parse(event?.admin_other_google_calendar_ids || eventForCalendarIds?.admin_other_google_calendar_ids || '{}'); } catch (e) {}
      const originalAdminOtherCalendarIdsJson = stableStringifyObject(adminOtherCalendarIds);
      let adminOtherChanged = false;

      for (const adminUser of additionalAdmins) {
        const userCalendarId = adminUser.google_calendar_id;
        const existingCalEventId = adminOtherCalendarIds[adminUser.id];

        if (shouldDelete) {
          if (existingCalEventId) {
            const delResult = await deleteCalendarEvent(accessToken, userCalendarId, existingCalEventId);
            results.push({ target: 'admin_other', userId: adminUser.id, ...delResult, action: 'delete' });
            if (delResult.success) {
              delete adminOtherCalendarIds[adminUser.id];
              adminOtherChanged = true;
            }
          }
        } else {
          const eventBody = buildEventBody(event, 'admin', settingsMap, { suppliersList });
          const upsertResult = await upsertCalendarEvent(accessToken, userCalendarId, existingCalEventId, eventBody);
          results.push({ target: 'admin_other', userId: adminUser.id, ...upsertResult, action: existingCalEventId ? 'update' : 'create' });

          if (upsertResult.success && adminOtherCalendarIds[adminUser.id] !== upsertResult.eventId) {
            adminOtherCalendarIds[adminUser.id] = upsertResult.eventId;
            adminOtherChanged = true;
          }
        }
      }

      // Clean up entries for admins who no longer qualify
      const validAdminIds = additionalAdmins.map(u => u.id);
      for (const oldUserId of Object.keys(adminOtherCalendarIds)) {
        if (!validAdminIds.includes(oldUserId) && adminOtherCalendarIds[oldUserId]) {
          const oldUser = allUsers.find(u => u.id === oldUserId);
          if (oldUser?.google_calendar_id) {
            await deleteCalendarEvent(accessToken, oldUser.google_calendar_id, adminOtherCalendarIds[oldUserId]);
          }
          delete adminOtherCalendarIds[oldUserId];
          adminOtherChanged = true;
        }
      }

      if (adminOtherChanged && event && stableStringifyObject(adminOtherCalendarIds) !== originalAdminOtherCalendarIdsJson) {
        await base44.asServiceRole.entities.Event.update(actualEventId, {
          admin_other_google_calendar_ids: stableStringifyObject(adminOtherCalendarIds)
        });
      }
    }

    // ====================================================
    // SUPPLIER SYNC
    // ====================================================
    if (supplierSyncEnabled) {
      const eventServicesToProcess = targetEventService 
        ? [targetEventService] 
        : (isDeleteAction ? [] : allEventServices);

      // For delete action on EventService, also handle the deleted ES
      if (isDeleteAction && entityName === 'EventService' && deletedEntityData?.supplier_calendar_ids) {
        eventServicesToProcess.push(deletedEntityData);
      }
      // For delete action on Event, handle all ES
      if (isDeleteAction && entityName === 'Event') {
        const existingES = await base44.asServiceRole.entities.EventService.filter({ event_id: actualEventId }).catch(() => []);
        eventServicesToProcess.push(...existingES);
      }

      for (const es of eventServicesToProcess) {
        let supplierIds = [];
        try { supplierIds = JSON.parse(es.supplier_ids || '[]'); } catch (e) {}
        let supplierStatuses = {};
        try { supplierStatuses = JSON.parse(es.supplier_statuses || '{}'); } catch (e) {}
        let supplierCalendarIds = {};
        try { supplierCalendarIds = JSON.parse(es.supplier_calendar_ids || '{}'); } catch (e) {}
        const originalSupplierCalendarIdsJson = stableStringifyObject(supplierCalendarIds);
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

          // Check if supplier approved sync via User entity
          const supplierUser = allUsers.find(u => 
            u.email && supplier.contact_emails && supplier.contact_emails.includes(u.email)
          );
          const supplierSyncApproved = supplierUser?.calendar_sync_approved === true;

          // Supplier calendar ID: from User entity (dedicated calendar created on sync approval)
          const supplierCalendarId = supplierUser?.google_calendar_id || null;
          if (!supplierCalendarId) continue;

          if (shouldDelete || !isConfirmed || !supplierSyncApproved) {
            if (existingCalEventId) {
              const delResult = await deleteCalendarEvent(accessToken, supplierCalendarId, existingCalEventId);
              results.push({ target: 'supplier', supplierId: suppId, esId: es.id, ...delResult, action: 'delete' });
              if (delResult.success) {
                delete supplierCalendarIds[suppId];
                calendarIdsChanged = true;
              }
            }
          } else {
            const note = supplierNotes[suppId] || '';
            const eventBody = buildEventBody(event, 'supplier', settingsMap, { serviceName, supplierNote: note, supplierArrivalTime: es.supplier_arrival_time });
            const upsertResult = await upsertCalendarEvent(accessToken, supplierCalendarId, existingCalEventId, eventBody);
            results.push({ target: 'supplier', supplierId: suppId, esId: es.id, ...upsertResult, action: existingCalEventId ? 'update' : 'create' });

            if (upsertResult.success && supplierCalendarIds[suppId] !== upsertResult.eventId) {
              supplierCalendarIds[suppId] = upsertResult.eventId;
              calendarIdsChanged = true;
            }
          }
        }

        // Clean up orphaned supplier calendar entries
        for (const oldSuppId of Object.keys(supplierCalendarIds)) {
          if (!supplierIds.includes(oldSuppId) && supplierCalendarIds[oldSuppId]) {
            const supplier = suppliersMap[oldSuppId];
            const calId = supplier?.google_calendar_id || (supplier?.contact_emails && supplier.contact_emails[0]);
            if (calId) {
              await deleteCalendarEvent(accessToken, calId, supplierCalendarIds[oldSuppId]);
            }
            delete supplierCalendarIds[oldSuppId];
            calendarIdsChanged = true;
          }
        }

        if (calendarIdsChanged && es.id && stableStringifyObject(supplierCalendarIds) !== originalSupplierCalendarIdsJson) {
          await base44.asServiceRole.entities.EventService.update(es.id, {
            supplier_calendar_ids: stableStringifyObject(supplierCalendarIds)
          }).catch(e => console.log('Could not update ES supplier_calendar_ids:', e));
        }
      }
    }

    // ====================================================
    // CLIENT SYNC
    // ====================================================
    if (clientSyncEnabled && event) {
      // Find client user(s) via event parents
      const clientEmail = event.parents?.[0]?.email;
      const existingClientEventId = event.client_google_calendar_event_id || eventForCalendarIds?.client_google_calendar_event_id;

      // Check if client approved sync and get their dedicated calendar ID
      let clientSyncApproved = false;
      let clientCalendarId = null;
      if (clientEmail) {
        const clientUser = allUsers.find(u => u.email === clientEmail);
        if (clientUser?.calendar_sync_approved === true) {
          clientSyncApproved = true;
          clientCalendarId = clientUser.google_calendar_id || null;
        }
      }

      if (clientCalendarId) {
        if (shouldDelete || !clientSyncApproved) {
          if (existingClientEventId) {
            const delResult = await deleteCalendarEvent(accessToken, clientCalendarId, existingClientEventId);
            results.push({ target: 'client', ...delResult, action: 'delete' });
            if (delResult.success && event) {
              await base44.asServiceRole.entities.Event.update(actualEventId, { client_google_calendar_event_id: null });
            }
          }
        } else {
          const eventBody = buildEventBody(event, 'client', settingsMap, {});
          const upsertResult = await upsertCalendarEvent(accessToken, clientCalendarId, existingClientEventId, eventBody);
          results.push({ target: 'client', ...upsertResult, action: existingClientEventId ? 'update' : 'create' });

          if (upsertResult.success && upsertResult.eventId !== existingClientEventId) {
            await base44.asServiceRole.entities.Event.update(actualEventId, { client_google_calendar_event_id: upsertResult.eventId });
          }
        }
      }
    } else if (clientSyncEnabled && isDeleteAction && eventForCalendarIds?.client_google_calendar_event_id) {
      // Event deleted - clean up client calendar
      const clientEmail = eventForCalendarIds.parents?.[0]?.email;
      let delClientCalId = null;
      if (clientEmail) {
        const clientUser = allUsers.find(u => u.email === clientEmail);
        delClientCalId = clientUser?.google_calendar_id || null;
      }
      if (delClientCalId) {
        await deleteCalendarEvent(accessToken, delClientCalId, eventForCalendarIds.client_google_calendar_event_id);
        results.push({ target: 'client', action: 'delete', success: true });
      }
    }

    const failedResults = results.filter(r => r && r.success === false);
    if (failedResults.length > 0) {
      const failure = await recordSyncFailure(base44, allSettings, settingsMap, failedResults.map(r => r.error).filter(Boolean).join('; '));
      return Response.json({ success: false, handled: true, failures: failedResults, paused_until: failure.paused_until || null, results });
    }

    await clearSyncFailureState(base44, allSettings);
    return Response.json({ success: true, results });

  } catch (error) {
    console.error('Error in syncEventToGoogleCalendars:', error);
    return Response.json({ success: false, handled: true, error: error.message });
  }
});