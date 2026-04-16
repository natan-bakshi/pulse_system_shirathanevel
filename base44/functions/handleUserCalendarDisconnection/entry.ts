import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * handleUserCalendarDisconnection - Handles cleanup when a user disables calendar sync
 * or changes their calendar ID.
 * 
 * Triggered by User entity update automation when calendar_sync_approved or google_calendar_id changes.
 * Deletes all synced Google Calendar events for the affected user.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();

    // Support both automation trigger and direct call
    const userId = body.userId || body.event?.entity_id;
    const oldData = body.oldData || body.old_data;
    const newData = body.newData || body.data;

    if (!userId || !oldData || !newData) {
      return Response.json({ skipped: true, message: 'Missing data' });
    }

    const wasSyncApproved = oldData.calendar_sync_approved === true;
    const isSyncApproved = newData.calendar_sync_approved === true;
    const oldCalendarId = oldData.google_calendar_id || '';
    const newCalendarId = newData.google_calendar_id || '';

    // Determine if we need to clean up the OLD calendar
    const syncDisabled = wasSyncApproved && !isSyncApproved;
    const calendarChanged = wasSyncApproved && oldCalendarId && oldCalendarId !== newCalendarId;

    if (!syncDisabled && !calendarChanged) {
      return Response.json({ skipped: true, message: 'No cleanup needed' });
    }

    // The calendar to delete events FROM is the OLD calendar
    const calendarToClean = oldCalendarId || 'primary';
    const userEmail = newData.email || oldData.email;
    const userType = newData.user_type || oldData.user_type;
    const userRole = newData.role || oldData.role;

    // Get access token
    let accessToken;
    try {
      const connection = await base44.asServiceRole.connectors.getConnection("googlecalendar");
      accessToken = connection.accessToken;
    } catch (e) {
      console.error('Failed to get Google Calendar connector token:', e);
      return Response.json({ error: 'Google Calendar connector not authorized' }, { status: 500 });
    }

    const results = [];

    // Helper to delete a calendar event
    async function deleteEvent(calendarId, eventId) {
      if (!eventId || !calendarId) return { success: true };
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
        { method: 'DELETE', headers: { 'Authorization': `Bearer ${accessToken}` } }
      );
      return { success: res.ok || res.status === 404 || res.status === 410 };
    }

    // ====================================================
    // CLEANUP FOR ADMIN USERS
    // ====================================================
    if (userRole === 'admin') {
      // Clean up admin_other_google_calendar_ids entries
      const allEvents = await base44.asServiceRole.entities.Event.list();
      
      for (const event of allEvents) {
        let adminOtherIds = {};
        try { adminOtherIds = JSON.parse(event.admin_other_google_calendar_ids || '{}'); } catch (e) {}

        if (adminOtherIds[userId]) {
          await deleteEvent(calendarToClean, adminOtherIds[userId]);
          delete adminOtherIds[userId];
          await base44.asServiceRole.entities.Event.update(event.id, {
            admin_other_google_calendar_ids: JSON.stringify(adminOtherIds)
          });
          results.push({ eventId: event.id, target: 'admin_other', action: 'delete' });
        }
      }
    }

    // ====================================================
    // CLEANUP FOR SUPPLIER USERS
    // ====================================================
    if (userType === 'supplier' && userEmail) {
      // Find the supplier entity matching this user
      const allSuppliers = await base44.asServiceRole.entities.Supplier.list();
      const supplier = allSuppliers.find(s => s.contact_emails && s.contact_emails.includes(userEmail));

      if (supplier) {
        const allEventServices = await base44.asServiceRole.entities.EventService.list();

        for (const es of allEventServices) {
          let supplierCalendarIds = {};
          try { supplierCalendarIds = JSON.parse(es.supplier_calendar_ids || '{}'); } catch (e) {}

          if (supplierCalendarIds[supplier.id]) {
            const calId = calendarToClean || supplier.google_calendar_id || userEmail;
            await deleteEvent(calId, supplierCalendarIds[supplier.id]);
            delete supplierCalendarIds[supplier.id];
            await base44.asServiceRole.entities.EventService.update(es.id, {
              supplier_calendar_ids: JSON.stringify(supplierCalendarIds)
            });
            results.push({ eventServiceId: es.id, target: 'supplier', action: 'delete' });
          }
        }
      }
    }

    // ====================================================
    // CLEANUP FOR CLIENT USERS
    // ====================================================
    if (userType === 'client' && userEmail) {
      const allEvents = await base44.asServiceRole.entities.Event.list();

      for (const event of allEvents) {
        // Check if this client is linked to this event
        const isClientOfEvent = event.parents?.some(p => p.email === userEmail);
        
        if (isClientOfEvent && event.client_google_calendar_event_id) {
          const calId = calendarToClean || event.client_google_calendar_id || userEmail;
          await deleteEvent(calId, event.client_google_calendar_event_id);
          await base44.asServiceRole.entities.Event.update(event.id, {
            client_google_calendar_event_id: null
          });
          results.push({ eventId: event.id, target: 'client', action: 'delete' });
        }
      }
    }

    // If calendar changed (not disabled), trigger re-sync to new calendar
    if (calendarChanged && isSyncApproved) {
      console.log(`Calendar changed for user ${userId}, new sync will be triggered by next event update`);
    }

    return Response.json({ success: true, results, cleanedCalendar: calendarToClean });

  } catch (error) {
    console.error('Error in handleUserCalendarDisconnection:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});