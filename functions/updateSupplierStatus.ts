import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { eventServiceId, newStatus } = body;

    if (!eventServiceId || !newStatus) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (!['pending', 'confirmed', 'rejected'].includes(newStatus)) {
      return Response.json({ error: 'Invalid status value' }, { status: 400 });
    }

    // Find the supplier that matches the current user
    const allSuppliers = await base44.asServiceRole.entities.Supplier.list();
    const userEmail = user.email?.toLowerCase();
    const userPhone = user.phone;
    
    const matchingSupplier = allSuppliers.find(s => 
      (userEmail && Array.isArray(s.contact_emails) && s.contact_emails.some(email => email.toLowerCase() === userEmail)) ||
      (userPhone && s.phone === userPhone)
    );

    if (!matchingSupplier) {
      return Response.json({ error: 'No supplier profile found for this user' }, { status: 403 });
    }

    // Get the event service
    const eventService = await base44.asServiceRole.entities.EventService.get(eventServiceId);
    
    if (!eventService) {
      return Response.json({ error: 'Event service not found' }, { status: 404 });
    }

    // Verify the supplier is assigned to this service
    let supplierIds = [];
    try {
      supplierIds = JSON.parse(eventService.supplier_ids || '[]');
      if (!Array.isArray(supplierIds)) supplierIds = [];
    } catch (e) {
      supplierIds = [];
    }

    if (!supplierIds.includes(matchingSupplier.id)) {
      return Response.json({ error: 'Supplier not assigned to this service' }, { status: 403 });
    }

    // Update the status
    let supplierStatuses = {};
    try {
      supplierStatuses = JSON.parse(eventService.supplier_statuses || '{}');
      if (typeof supplierStatuses !== 'object' || supplierStatuses === null) {
        supplierStatuses = {};
      }
    } catch (e) {
      supplierStatuses = {};
    }

    supplierStatuses[matchingSupplier.id] = newStatus;

    await base44.asServiceRole.entities.EventService.update(eventServiceId, {
      supplier_statuses: JSON.stringify(supplierStatuses)
    });

    return Response.json({ success: true, status: newStatus });

  } catch (error) {
    console.error('Error in updateSupplierStatus:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});