import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

const EVENT_TYPE_HEBREW = {
  bar_mitzvah: 'בר מצווה',
  bat_mitzvah: 'בת מצווה',
  wedding: 'חתונה',
  other: 'אירוע'
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { action, eventId, eventServiceId, supplierId, userType } = body;

    // action: 'create', 'delete'
    // userType: 'admin', 'client', 'supplier'

    if (!action || !eventId) {
      return Response.json({ error: 'Missing required fields: action, eventId' }, { status: 400 });
    }

    // Get access token for the current user's Google Calendar
    let accessToken;
    try {
      accessToken = await base44.connectors.getAccessToken("googlecalendar");
    } catch (tokenError) {
      console.error("Failed to get user's Google Calendar access token:", tokenError);
      return Response.json({ 
        error: 'Google Calendar not connected. Please connect your Google Calendar first.',
        needsAuth: true 
      }, { status: 401 });
    }

    // Get event details
    const event = await base44.asServiceRole.entities.Event.get(eventId);
    if (!event) {
      return Response.json({ error: 'Event not found' }, { status: 404 });
    }

    // Build event title: "[סוג האירוע] של [שם החתן/כלה] [שם משפחה]"
    const eventTypeHebrew = EVENT_TYPE_HEBREW[event.event_type] || 'אירוע';
    const childName = event.child_name || '';
    const familyName = event.family_name || '';
    const eventTitle = `${eventTypeHebrew} של ${childName} ${familyName}`.trim();

    // Build event description
    let description = '';
    if (event.concept) {
      description += `קונספט: ${event.concept}\n`;
    }
    if (event.notes) {
      description += `הערות: ${event.notes}\n`;
    }
    if (event.location) {
      description += `מיקום: ${event.location}\n`;
    }

    // Parse event date and time
    const eventDate = event.event_date;
    let startDateTime, endDateTime;

    if (event.event_time) {
      // If time is provided, create datetime
      const [hours, minutes] = event.event_time.split(':');
      const startDate = new Date(eventDate);
      startDate.setHours(parseInt(hours) || 0, parseInt(minutes) || 0, 0, 0);
      
      // Default event duration: 4 hours
      const endDate = new Date(startDate);
      endDate.setHours(endDate.getHours() + 4);

      startDateTime = { dateTime: startDate.toISOString(), timeZone: 'Asia/Jerusalem' };
      endDateTime = { dateTime: endDate.toISOString(), timeZone: 'Asia/Jerusalem' };
    } else {
      // All-day event
      startDateTime = { date: eventDate };
      const nextDay = new Date(eventDate);
      nextDay.setDate(nextDay.getDate() + 1);
      endDateTime = { date: nextDay.toISOString().split('T')[0] };
    }

    const calendarEvent = {
      summary: eventTitle,
      description: description,
      location: event.location || '',
      start: startDateTime,
      end: endDateTime
    };

    // Determine which calendar event ID field to use based on userType
    let calendarEventIdField;
    let existingCalendarEventId;

    if (userType === 'admin') {
      calendarEventIdField = 'google_calendar_event_id';
      existingCalendarEventId = event.google_calendar_event_id;
    } else if (userType === 'client') {
      calendarEventIdField = 'client_google_calendar_event_id';
      existingCalendarEventId = event.client_google_calendar_event_id;
    } else if (userType === 'supplier' && eventServiceId && supplierId) {
      // For suppliers, we need to handle it differently - stored in EventService
      const eventService = await base44.asServiceRole.entities.EventService.get(eventServiceId);
      if (!eventService) {
        return Response.json({ error: 'EventService not found' }, { status: 404 });
      }

      let supplierCalendarIds = {};
      try {
        supplierCalendarIds = JSON.parse(eventService.supplier_calendar_ids || '{}');
      } catch (e) {
        supplierCalendarIds = {};
      }

      existingCalendarEventId = supplierCalendarIds[supplierId];

      if (action === 'create') {
        // Create event in Google Calendar
        const createResponse = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(calendarEvent)
        });

        if (!createResponse.ok) {
          const errorData = await createResponse.text();
          console.error("Google Calendar API error:", errorData);
          return Response.json({ error: 'Failed to create calendar event', details: errorData }, { status: 500 });
        }

        const createdEvent = await createResponse.json();
        
        // Save the calendar event ID
        supplierCalendarIds[supplierId] = createdEvent.id;
        await base44.asServiceRole.entities.EventService.update(eventServiceId, {
          supplier_calendar_ids: JSON.stringify(supplierCalendarIds)
        });

        return Response.json({ success: true, calendarEventId: createdEvent.id });

      } else if (action === 'delete' && existingCalendarEventId) {
        // Delete event from Google Calendar
        const deleteResponse = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${existingCalendarEventId}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        });

        if (!deleteResponse.ok && deleteResponse.status !== 404) {
          const errorData = await deleteResponse.text();
          console.error("Google Calendar delete error:", errorData);
        }

        // Remove the calendar event ID
        delete supplierCalendarIds[supplierId];
        await base44.asServiceRole.entities.EventService.update(eventServiceId, {
          supplier_calendar_ids: JSON.stringify(supplierCalendarIds)
        });

        return Response.json({ success: true });
      }

      return Response.json({ success: true, message: 'No action needed for supplier' });
    } else {
      return Response.json({ error: 'Invalid userType' }, { status: 400 });
    }

    // Handle admin and client calendar sync
    if (action === 'create') {
      // Create event in Google Calendar
      const createResponse = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(calendarEvent)
      });

      if (!createResponse.ok) {
        const errorData = await createResponse.text();
        console.error("Google Calendar API error:", errorData);
        return Response.json({ error: 'Failed to create calendar event', details: errorData }, { status: 500 });
      }

      const createdEvent = await createResponse.json();
      
      // Save the calendar event ID to the Event entity
      await base44.asServiceRole.entities.Event.update(eventId, {
        [calendarEventIdField]: createdEvent.id
      });

      return Response.json({ success: true, calendarEventId: createdEvent.id });

    } else if (action === 'delete' && existingCalendarEventId) {
      // Delete event from Google Calendar
      const deleteResponse = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${existingCalendarEventId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      if (!deleteResponse.ok && deleteResponse.status !== 404) {
        const errorData = await deleteResponse.text();
        console.error("Google Calendar delete error:", errorData);
      }

      // Remove the calendar event ID from the Event entity
      await base44.asServiceRole.entities.Event.update(eventId, {
        [calendarEventIdField]: null
      });

      return Response.json({ success: true });
    }

    return Response.json({ success: true, message: 'No action needed' });

  } catch (error) {
    console.error('Error in syncGoogleCalendar:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});