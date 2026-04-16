import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * createAndShareUserCalendar - Creates a new Google Calendar in the connected account
 * and shares it with the requesting user.
 * 
 * Called when a user enables calendar_sync_approved.
 * Returns the new calendar's ID to be saved on the user entity.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Determine the display name for the calendar
    let calendarName = '';
    const userType = user.user_type || 'client';

    if (userType === 'supplier') {
      // For suppliers, use the contact_person name from the Supplier entity
      const allSuppliers = await base44.asServiceRole.entities.Supplier.list();
      const supplier = allSuppliers.find(s => s.contact_emails && s.contact_emails.includes(user.email));
      const contactName = supplier?.contact_person || supplier?.supplier_name || user.full_name || user.email;
      calendarName = `שירת הנבל - ${contactName}`;
    } else {
      // For admins and clients, use the user's full name
      calendarName = `שירת הנבל - ${user.full_name || user.email}`;
    }

    // Get access token from shared connector
    let accessToken;
    try {
      const connection = await base44.asServiceRole.connectors.getConnection("googlecalendar");
      accessToken = connection.accessToken;
    } catch (e) {
      console.error('Failed to get Google Calendar connector token:', e);
      return Response.json({ error: 'Google Calendar connector not authorized' }, { status: 500 });
    }

    // Step 1: Create a new calendar in the connected account
    const createRes = await fetch('https://www.googleapis.com/calendar/v3/calendars', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        summary: calendarName,
        timeZone: 'Asia/Jerusalem'
      })
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      console.error(`Failed to create calendar (${createRes.status}):`, errText);
      return Response.json({ error: 'Failed to create calendar', details: errText }, { status: 500 });
    }

    const newCalendar = await createRes.json();
    const newCalendarId = newCalendar.id;

    console.log(`Created calendar "${calendarName}" with ID: ${newCalendarId}`);

    // Step 2: Share the calendar with the user's email (writer access)
    const shareRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(newCalendarId)}/acl`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          role: 'writer',
          scope: {
            type: 'user',
            value: user.email
          }
        })
      }
    );

    if (!shareRes.ok) {
      const errText = await shareRes.text();
      console.error(`Failed to share calendar (${shareRes.status}):`, errText);
      // Calendar was created but sharing failed - still return the ID
      return Response.json({ 
        calendarId: newCalendarId, 
        calendarName,
        shareError: errText,
        warning: 'Calendar created but sharing failed. User may need manual sharing.' 
      });
    }

    console.log(`Shared calendar "${calendarName}" with ${user.email}`);

    // Step 3: Save the calendar ID on the user entity
    await base44.asServiceRole.entities.User.update(user.id, {
      google_calendar_id: newCalendarId,
      calendar_sync_approved: true
    });

    return Response.json({ 
      success: true, 
      calendarId: newCalendarId, 
      calendarName,
      sharedWith: user.email
    });

  } catch (error) {
    console.error('Error in createAndShareUserCalendar:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});