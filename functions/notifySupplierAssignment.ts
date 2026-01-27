import { createClientFromRequest } from 'npm:@base44/sdk@0.7.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    // Ensure the call is coming from an authenticated admin
    const adminUser = await base44.auth.me();
    if (!adminUser || adminUser.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Unauthorized: Admin role required.' }), { status: 401, headers: { "Content-Type": "application/json" } });
    }

    const { supplierIds, eventId, serviceName } = await req.json();

    if (!Array.isArray(supplierIds) || supplierIds.length === 0 || !eventId || !serviceName) {
      return new Response(JSON.stringify({ error: 'Missing required parameters: supplierIds, eventId, serviceName.' }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    // Use service role to fetch data across the system
    const event = await base44.asServiceRole.entities.Event.get(eventId);
    if (!event) {
      return new Response(JSON.stringify({ error: 'Event not found.' }), { status: 404, headers: { "Content-Type": "application/json" } });
    }

    // Get all users and suppliers in one go
    const allUsers = await base44.asServiceRole.entities.User.list();
    const allSuppliers = await base44.asServiceRole.entities.Supplier.list();

    const targetUserIds = [];
    
    // Find the user accounts corresponding to the supplied supplier IDs
    supplierIds.forEach(supplierId => {
        const supplier = allSuppliers.find(s => s.id === supplierId);
        if (!supplier) return;

        const supplierUser = allUsers.find(u => 
            (u.email && Array.isArray(supplier.contact_emails) && supplier.contact_emails.map(e => e.toLowerCase()).includes(u.email.toLowerCase())) ||
            (u.phone && supplier.phone === u.phone)
        );

        if (supplierUser) {
            targetUserIds.push(supplierUser.id);
        }
    });

    if (targetUserIds.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No user accounts found for the given suppliers to notify.' }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    
    const formattedDate = new Date(event.event_date).toLocaleDateString('he-IL');
    const title = `שיבוץ חדש לאירוע`;
    const body = `שובצת לשירות '${serviceName}' באירוע של משפחת ${event.family_name} בתאריך ${formattedDate}.`;

    // Invoke the other backend function to send the actual push notification
    const notificationResult = await base44.asServiceRole.functions.invoke('sendPushNotification', {
      userIds: targetUserIds,
      title,
      body,
      data: {
        click_action: `/EventDetails?id=${eventId}`,
        type: 'supplier_assignment'
      }
    });

    return new Response(JSON.stringify({ success: true, message: 'Notification process initiated.', details: notificationResult.data }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (error) {
    console.error('Error in notifySupplierAssignment:', error);
    return new Response(JSON.stringify({ error: 'Failed to notify supplier.', details: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});