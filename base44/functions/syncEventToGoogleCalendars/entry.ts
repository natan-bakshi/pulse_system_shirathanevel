import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const EVENT_TYPE_HEBREW = {
  bar_mitzvah: 'בר מצווה',
  bat_mitzvah: 'בת מצווה',
  wedding: 'חתונה',
  other: 'אירוע'
};

/**
 * Refresh a user's Google Calendar access token using their refresh_token.
 * Returns the new access_token or null on failure.
 * Also updates the User entity with the new token.
 */
async function refreshUserToken(base44, userId, refreshToken) {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token'
    })
  });

  if (!response.ok) {
    console.error(`Token refresh failed for user ${userId}:`, await response.text());
    return null;
  }

  const tokens = await response.json();

  await base44.asServiceRole.entities.User.update(userId, {
    google_calendar_access_token: tokens.access_token,
    google_calendar_token_expiry: new Date(Date.now() + (tokens.expires_in * 1000)).toISOString()
  });

  return tokens.access_token;
}

/**
 * Get a valid access token for a user (refresh if expired).
 */
async function getValidAccessToken(base44, userRecord) {
  if (!userRecord.google_calendar_refresh_token) return null;

  const now = new Date();
  const expiry = userRecord.google_calendar_token_expiry ? new Date(userRecord.google_calendar_token_expiry) : null;

  // If token is still valid (with 2 min buffer), use it
  if (userRecord.google_calendar_access_token && expiry && expiry > new Date(now.getTime() + 120000)) {
    return userRecord.google_calendar_access_token;
  }

  // Otherwise refresh
  return await refreshUserToken(base44, userRecord.id, userRecord.google_calendar_refresh_token);
}

/**
 * Create or update a Google Calendar event.
 */
async function upsertCalendarEvent(accessToken, calendarId, existingEventId, eventBody) {
  const baseUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;

  if (existingEventId) {
    // Try to update
    const res = await fetch(`${baseUrl}/${existingEventId}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(eventBody)
    });
    if (res.ok) {
      const data = await res.json();
      return { success: true, eventId: data.id };
    }
    // If 404 (deleted externally), fall through to create
    if (res.status !== 404) {
      console.error(`Calendar PATCH failed (${res.status}):`, await res.text());
      return { success: false, error: `PATCH failed: ${res.status}` };
    }
  }

  // Create new
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
 * Build calendar event body for ADMIN.
 */
function buildAdminEventBody(event) {
  const eventType = EVENT_TYPE_HEBREW[event.event_type] || 'אירוע';
  const childName = event.child_name || '';
  const familyName = event.family_name || '';

  // כותרת: סוג האירוע, של, שם החתן, שם המשפחה
  const summary = `${eventType}, של, ${childName}${childName ? ', ' : ''}${familyName}`.replace(/, ,/g, ',').replace(/,\s*$/,'');

  // גוף
  let description = `אירוע, ${eventType}, של, ${childName}${childName ? ', ' : ''}משפחת ${familyName}`;
  if (event.concept) {
    description += `, בקונספט, ${event.concept}`;
  }
  description += `.\nמספר משתתפים: ${event.guest_count || 'לא צוין'}`;

  const scheduleText = buildScheduleText(event.schedule);
  if (scheduleText) {
    description += `\n\nלוז האירוע:\n${scheduleText}`;
  }

  // חישוב שעות
  const { startDateTime, endDateTime } = calculateTimes(event.event_date, event.event_time, 0, 5);

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
 */
function buildSupplierEventBody(event, serviceName, supplierNote, companyName) {
  const eventType = EVENT_TYPE_HEBREW[event.event_type] || 'אירוע';
  const childName = event.child_name || '';
  const familyName = event.family_name || '';

  // כותרת: סוג האירוע, עם, שם החברה, שם השירות, הערה עבורך (הערה)
  let summary = `${eventType}, עם, ${companyName || ''}, ${serviceName}`;
  if (supplierNote) {
    summary += `, הערה עבורך (${supplierNote})`;
  }

  // גוף
  let description = `אירוע, ${eventType}, של, ${childName}${childName ? ', ' : ''}משפחת ${familyName}`;
  if (event.concept) {
    description += `, בקונספט, ${event.concept}`;
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
 * Calculate start and end times for a calendar event.
 * @param {string} eventDate - ISO date string (YYYY-MM-DD)
 * @param {string} eventTime - Time string (HH:MM)
 * @param {number} offsetMinutes - Minutes to offset start time (negative = before)
 * @param {number} durationHours - Duration in hours
 */
function calculateTimes(eventDate, eventTime, offsetMinutes, durationHours) {
  if (!eventTime) {
    // All-day event
    const nextDay = new Date(eventDate);
    nextDay.setDate(nextDay.getDate() + 1);
    return {
      startDateTime: { date: eventDate },
      endDateTime: { date: nextDay.toISOString().split('T')[0] }
    };
  }

  const [hours, minutes] = eventTime.split(':').map(Number);
  const startDate = new Date(eventDate + 'T00:00:00');
  startDate.setHours(hours, minutes + offsetMinutes, 0, 0);

  const endDate = new Date(startDate);
  endDate.setHours(endDate.getHours() + durationHours);

  return {
    startDateTime: { dateTime: startDate.toISOString(), timeZone: 'Asia/Jerusalem' },
    endDateTime: { dateTime: endDate.toISOString(), timeZone: 'Asia/Jerusalem' }
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const body = await req.json();
    // Support both direct call and automation trigger
    const eventId = body.eventId || body.data?.id || body.event?.entity_id;
    const triggerAction = body.action || body.event?.type; // 'create', 'update', 'delete'
    const eventServiceId = body.eventServiceId; // for targeted supplier sync
    const entityName = body.event?.entity_name; // 'Event' or 'EventService'

    if (!eventId && !eventServiceId) {
      return Response.json({ error: 'Missing eventId or eventServiceId' }, { status: 400 });
    }

    // Check global settings
    const allSettings = await base44.asServiceRole.entities.AppSettings.list();
    const settingsMap = allSettings.reduce((acc, s) => { acc[s.setting_key] = s.setting_value; return acc; }, {});

    const adminSyncEnabled = settingsMap.google_calendar_admin_sync_enabled === 'true';
    const supplierSyncEnabled = settingsMap.google_calendar_supplier_sync_enabled === 'true';
    // Backward compat: if old single toggle is on but new ones aren't set, treat both as enabled
    const legacyEnabled = settingsMap.google_calendar_sync_enabled === 'true';
    const isAdminSyncOn = adminSyncEnabled || (legacyEnabled && settingsMap.google_calendar_admin_sync_enabled === undefined);
    const isSupplierSyncOn = supplierSyncEnabled || (legacyEnabled && settingsMap.google_calendar_supplier_sync_enabled === undefined);

    if (!isAdminSyncOn && !isSupplierSyncOn) {
      return Response.json({ skipped: true, message: 'Google Calendar sync is disabled for both admins and suppliers' });
    }

    // Admin emails whitelist (comma-separated in settings)
    const adminEmailsRaw = settingsMap.google_calendar_admin_emails || '';
    const adminEmailsWhitelist = adminEmailsRaw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

    const companyName = settingsMap.company_name || '';

    // Determine the actual eventId if triggered from EventService
    let actualEventId = eventId;
    let targetEventService = null;

    if (entityName === 'EventService' || eventServiceId) {
      const esId = eventServiceId || body.event?.entity_id;
      if (esId) {
        try {
          targetEventService = await base44.asServiceRole.entities.EventService.get(esId);
          actualEventId = targetEventService?.event_id || eventId;
        } catch (e) {
          // EventService may have been deleted
          console.log(`EventService ${esId} not found (may have been deleted)`);
        }
      }
    }

    if (!actualEventId) {
      return Response.json({ error: 'Could not determine eventId' }, { status: 400 });
    }

    // Load event
    let event;
    try {
      event = await base44.asServiceRole.entities.Event.get(actualEventId);
    } catch (e) {
      // Event may have been deleted
      console.log(`Event ${actualEventId} not found - handling as delete`);
    }

    // Load all event services
    const allEventServices = event ? await base44.asServiceRole.entities.EventService.filter({ event_id: actualEventId }) : [];
    const allServices = await base44.asServiceRole.entities.Service.list();
    const servicesMap = allServices.reduce((acc, s) => { acc[s.id] = s; return acc; }, {});

    // Load all suppliers
    const allSuppliers = await base44.asServiceRole.entities.Supplier.list();
    const suppliersMap = allSuppliers.reduce((acc, s) => { acc[s.id] = s; return acc; }, {});

    // Load users
    const allUsers = await base44.asServiceRole.entities.User.list();
    // Admin users: connected + in whitelist (if whitelist not empty)
    const adminUsers = isAdminSyncOn 
      ? allUsers.filter(u => u.user_type === 'admin' && u.google_calendar_connected && u.google_calendar_refresh_token
          && (adminEmailsWhitelist.length === 0 || adminEmailsWhitelist.includes((u.email || '').toLowerCase())))
      : [];

    // Build map of supplier email -> User record (for token access)
    const supplierUserMap = {};
    if (isSupplierSyncOn) {
      for (const u of allUsers) {
        if (u.user_type === 'supplier' && u.google_calendar_connected && u.google_calendar_refresh_token) {
          supplierUserMap[u.email] = u;
        }
      }
    }

    const results = [];
    const isDeleteAction = triggerAction === 'delete' || !event;

    // ============================================
    // ADMIN SYNC
    // ============================================
    for (const adminUser of adminUsers) {
      try {
        const accessToken = await getValidAccessToken(base44, adminUser);
        if (!accessToken) {
          results.push({ target: 'admin', userId: adminUser.id, success: false, error: 'No valid token' });
          continue;
        }

        const calendarId = adminUser.google_calendar_id || 'primary';
        const existingEventId = event?.google_calendar_event_id;

        if (isDeleteAction) {
          const delResult = await deleteCalendarEvent(accessToken, calendarId, existingEventId);
          results.push({ target: 'admin', userId: adminUser.id, ...delResult, action: 'delete' });
          if (delResult.success && event) {
            await base44.asServiceRole.entities.Event.update(actualEventId, { google_calendar_event_id: null });
          }
        } else {
          const eventBody = buildAdminEventBody(event);
          const upsertResult = await upsertCalendarEvent(accessToken, calendarId, existingEventId, eventBody);
          results.push({ target: 'admin', userId: adminUser.id, ...upsertResult, action: existingEventId ? 'update' : 'create' });

          if (upsertResult.success && upsertResult.eventId !== existingEventId) {
            await base44.asServiceRole.entities.Event.update(actualEventId, { google_calendar_event_id: upsertResult.eventId });
          }
        }
      } catch (err) {
        console.error(`Admin sync error for user ${adminUser.id}:`, err);
        results.push({ target: 'admin', userId: adminUser.id, success: false, error: err.message });
      }
    }

    // ============================================
    // SUPPLIER SYNC
    // ============================================
    // Determine which event services to process
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

        // Find the User record for this supplier (match by email)
        let supplierUser = null;
        for (const email of (supplier.contact_emails || [])) {
          if (supplierUserMap[email]) {
            supplierUser = supplierUserMap[email];
            break;
          }
        }

        if (!supplierUser) {
          // Supplier has no connected Google Calendar user - skip
          if (existingCalEventId) {
            // Can't delete without token, just clear the reference
            delete supplierCalendarIds[suppId];
            calendarIdsChanged = true;
          }
          continue;
        }

        try {
          const accessToken = await getValidAccessToken(base44, supplierUser);
          if (!accessToken) {
            results.push({ target: 'supplier', supplierId: suppId, esId: es.id, success: false, error: 'No valid token' });
            continue;
          }

          const calendarId = supplierUser.google_calendar_id || 'primary';

          if (isDeleteAction || !isConfirmed) {
            // Delete: event deleted, or supplier no longer confirmed
            if (existingCalEventId) {
              const delResult = await deleteCalendarEvent(accessToken, calendarId, existingCalEventId);
              results.push({ target: 'supplier', supplierId: suppId, esId: es.id, ...delResult, action: 'delete' });
              if (delResult.success) {
                delete supplierCalendarIds[suppId];
                calendarIdsChanged = true;
              }
            }
          } else {
            // Create or update: supplier is confirmed
            const note = supplierNotes[suppId] || '';
            const eventBody = buildSupplierEventBody(event, serviceName, note, companyName);
            const upsertResult = await upsertCalendarEvent(accessToken, calendarId, existingCalEventId, eventBody);
            results.push({ target: 'supplier', supplierId: suppId, esId: es.id, ...upsertResult, action: existingCalEventId ? 'update' : 'create' });

            if (upsertResult.success) {
              supplierCalendarIds[suppId] = upsertResult.eventId;
              calendarIdsChanged = true;
            }
          }
        } catch (err) {
          console.error(`Supplier sync error for supplier ${suppId}:`, err);
          results.push({ target: 'supplier', supplierId: suppId, esId: es.id, success: false, error: err.message });
        }
      }

      // Also handle suppliers that were removed (have calendar IDs but no longer in supplier_ids)
      for (const oldSuppId of Object.keys(supplierCalendarIds)) {
        if (!supplierIds.includes(oldSuppId) && supplierCalendarIds[oldSuppId]) {
          const supplier = suppliersMap[oldSuppId];
          let supplierUser = null;
          if (supplier) {
            for (const email of (supplier.contact_emails || [])) {
              if (supplierUserMap[email]) {
                supplierUser = supplierUserMap[email];
                break;
              }
            }
          }

          if (supplierUser) {
            try {
              const accessToken = await getValidAccessToken(base44, supplierUser);
              if (accessToken) {
                const calendarId = supplierUser.google_calendar_id || 'primary';
                await deleteCalendarEvent(accessToken, calendarId, supplierCalendarIds[oldSuppId]);
              }
            } catch (e) {
              console.error(`Failed to delete orphaned calendar event for supplier ${oldSuppId}:`, e);
            }
          }

          delete supplierCalendarIds[oldSuppId];
          calendarIdsChanged = true;
        }
      }

      // Save updated calendar IDs
      if (calendarIdsChanged) {
        await base44.asServiceRole.entities.EventService.update(es.id, {
          supplier_calendar_ids: JSON.stringify(supplierCalendarIds)
        });
      }
    }

    return Response.json({ success: true, results });

  } catch (error) {
    console.error('Error in syncEventToGoogleCalendars:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});