import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Handles EventService changes and sends appropriate notifications
 * Called via entity automation on EventService create/update
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }
        
        const payload = await req.json();
        const { event, data, old_data } = payload;
        
        if (!data) {
            return Response.json({ success: true, message: 'No data provided' });
        }
        
        console.log(`[AssignmentChange] Processing EventService change: ${event?.type}`);
        
        // Get event details
        const events = await base44.asServiceRole.entities.Event.filter({ id: data.event_id });
        const eventData = events.length > 0 ? events[0] : null;
        
        if (!eventData) {
            console.log('[AssignmentChange] Event not found');
            return Response.json({ success: true, message: 'Event not found' });
        }
        
        // Get service details
        const services = await base44.asServiceRole.entities.Service.list();
        const servicesMap = new Map(services.map(s => [s.id, s]));
        const service = servicesMap.get(data.service_id);
        
        // Get suppliers
        const suppliers = await base44.asServiceRole.entities.Supplier.list();
        const suppliersMap = new Map(suppliers.map(s => [s.id, s]));
        
        // Get users
        const allUsers = await base44.asServiceRole.entities.User.list();
        const adminUsers = allUsers.filter(u => u.role === 'admin');
        
        // Get templates
        const templates = await base44.asServiceRole.entities.NotificationTemplate.filter({ is_active: true });
        
        // Parse supplier data
        let currentSupplierIds = [];
        let currentStatuses = {};
        let oldSupplierIds = [];
        let oldStatuses = {};
        
        try {
            if (data.supplier_ids) currentSupplierIds = JSON.parse(data.supplier_ids);
            if (data.supplier_statuses) currentStatuses = JSON.parse(data.supplier_statuses);
            if (old_data?.supplier_ids) oldSupplierIds = JSON.parse(old_data.supplier_ids);
            if (old_data?.supplier_statuses) oldStatuses = JSON.parse(old_data.supplier_statuses);
        } catch (e) {
            console.warn('[AssignmentChange] Error parsing supplier data:', e);
        }
        
        let notificationsSent = 0;
        
        // Check if this service type has notifications enabled
        const shouldNotifySuppliers = service?.send_supplier_notifications !== false;
        
        // Check for new assignments
        const newAssignmentTemplate = templates.find(t => t.type === 'SUPPLIER_NEW_ASSIGNMENT');
        if (newAssignmentTemplate && shouldNotifySuppliers) {
            for (const supplierId of currentSupplierIds) {
                const isNew = !oldSupplierIds.includes(supplierId);
                const statusChanged = oldStatuses[supplierId] !== currentStatuses[supplierId];
                
                // Notify if new assignment or status changed to pending/approved
                if (isNew || (statusChanged && ['pending', 'approved'].includes(currentStatuses[supplierId]))) {
                    const supplier = suppliersMap.get(supplierId);
                    if (!supplier) continue;
                    
                    const supplierUser = allUsers.find(u => 
                        supplier.contact_emails?.includes(u.email)
                    );
                    
                    if (!supplierUser) continue;
                    
                    // Get supplier note for this assignment
                    let supplierNotes = {};
                    try {
                        if (data.supplier_notes) supplierNotes = JSON.parse(data.supplier_notes);
                    } catch (e) {}
                    const supplierNote = supplierNotes[supplierId] || '';
                    
                    const contextData = {
                        event_name: eventData.event_name,
                        family_name: eventData.family_name,
                        event_date: formatDate(eventData.event_date),
                        event_time: eventData.event_time || '',
                        event_location: eventData.location || '',
                        supplier_name: supplier.supplier_name,
                        service_name: service?.service_name || '',
                        supplier_note: supplierNote,
                        event_id: eventData.id
                    };
                    
                    const title = replacePlaceholders(newAssignmentTemplate.title_template, contextData);
                    const message = replacePlaceholders(newAssignmentTemplate.body_template, contextData);
                    const link = buildDeepLink(newAssignmentTemplate.deep_link_base, newAssignmentTemplate.deep_link_params_map, contextData);
                    
                    try {
                        await base44.functions.invoke('createNotification', {
                            target_user_id: supplierUser.id,
                            target_user_email: supplierUser.email,
                            title,
                            message,
                            link,
                            template_type: 'SUPPLIER_NEW_ASSIGNMENT',
                            related_event_id: eventData.id,
                            related_event_service_id: data.id,
                            related_supplier_id: supplierId,
                            send_push: true,
                            check_quiet_hours: true
                        });
                        notificationsSent++;
                        console.log(`[AssignmentChange] Notified supplier ${supplier.supplier_name} of new assignment`);
                    } catch (error) {
                        console.error('[AssignmentChange] Error notifying supplier:', error);
                    }
                }
            }
        }
        
        // Check for rejections - notify admins (always notify admins regardless of service notification setting)
        const rejectionTemplate = templates.find(t => t.type === 'ADMIN_ASSIGNMENT_REJECTED');
        if (rejectionTemplate) {
            for (const supplierId of currentSupplierIds) {
                const wasRejected = oldStatuses[supplierId] !== 'rejected' && currentStatuses[supplierId] === 'rejected';
                
                if (wasRejected) {
                    const supplier = suppliersMap.get(supplierId);
                    if (!supplier) continue;
                    
                    const contextData = {
                        event_name: eventData.event_name,
                        family_name: eventData.family_name,
                        event_date: formatDate(eventData.event_date),
                        supplier_name: supplier.supplier_name,
                        service_name: service?.service_name || '',
                        event_id: eventData.id
                    };
                    
                    const title = replacePlaceholders(rejectionTemplate.title_template, contextData);
                    const message = replacePlaceholders(rejectionTemplate.body_template, contextData);
                    const link = buildDeepLink(rejectionTemplate.deep_link_base, rejectionTemplate.deep_link_params_map, contextData);
                    
                    // Notify all admins
                    for (const admin of adminUsers) {
                        try {
                            await base44.functions.invoke('createNotification', {
                                target_user_id: admin.id,
                                target_user_email: admin.email,
                                title,
                                message,
                                link,
                                template_type: 'ADMIN_ASSIGNMENT_REJECTED',
                                related_event_id: eventData.id,
                                related_event_service_id: data.id,
                                related_supplier_id: supplierId,
                                send_push: true,
                                check_quiet_hours: true
                            });
                            notificationsSent++;
                        } catch (error) {
                            console.error('[AssignmentChange] Error notifying admin:', error);
                        }
                    }
                    
                    console.log(`[AssignmentChange] Notified admins of rejection by ${supplier.supplier_name}`);
                }
            }
        }
        
        // Check for assignment updates (status changes other than rejection)
        const updateTemplate = templates.find(t => t.type === 'SUPPLIER_ASSIGNMENT_UPDATE');
        if (updateTemplate && shouldNotifySuppliers) {
            for (const supplierId of currentSupplierIds) {
                if (!oldSupplierIds.includes(supplierId)) continue; // Already handled as new
                
                const statusChanged = oldStatuses[supplierId] !== currentStatuses[supplierId];
                const wasRejected = currentStatuses[supplierId] === 'rejected';
                
                // Notify supplier of status updates (but not rejections - they already know)
                if (statusChanged && !wasRejected && currentStatuses[supplierId] === 'cancelled') {
                    const supplier = suppliersMap.get(supplierId);
                    if (!supplier) continue;
                    
                    const supplierUser = allUsers.find(u => 
                        supplier.contact_emails?.includes(u.email)
                    );
                    
                    if (!supplierUser) continue;
                    
                    const contextData = {
                        event_name: eventData.event_name,
                        family_name: eventData.family_name,
                        event_date: formatDate(eventData.event_date),
                        supplier_name: supplier.supplier_name,
                        event_id: eventData.id
                    };
                    
                    const title = replacePlaceholders(updateTemplate.title_template, contextData);
                    const message = replacePlaceholders(updateTemplate.body_template, contextData);
                    const link = buildDeepLink(updateTemplate.deep_link_base, updateTemplate.deep_link_params_map, contextData);
                    
                    try {
                        await base44.functions.invoke('createNotification', {
                            target_user_id: supplierUser.id,
                            target_user_email: supplierUser.email,
                            title,
                            message,
                            link,
                            template_type: 'SUPPLIER_ASSIGNMENT_UPDATE',
                            related_event_id: eventData.id,
                            related_event_service_id: data.id,
                            related_supplier_id: supplierId,
                            send_push: true,
                            check_quiet_hours: true
                        });
                        notificationsSent++;
                    } catch (error) {
                        console.error('[AssignmentChange] Error notifying supplier of update:', error);
                    }
                }
            }
        }
        
        return Response.json({
            success: true,
            notifications_sent: notificationsSent
        });
        
    } catch (error) {
        console.error('[AssignmentChange] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});

// Helper functions
function replacePlaceholders(template, data) {
    if (!template) return '';
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        const value = data[key];
        return value !== undefined && value !== null ? String(value) : match;
    });
}

function buildDeepLink(basePage, paramsMapJson, data) {
    if (!basePage) return '/';
    let url = `/${basePage}`;
    
    if (paramsMapJson) {
        try {
            const paramsMap = JSON.parse(paramsMapJson);
            const params = new URLSearchParams();
            for (const [key, valueTemplate] of Object.entries(paramsMap)) {
                const value = replacePlaceholders(valueTemplate, data);
                if (value && !value.includes('{{')) {
                    params.append(key, value);
                }
            }
            const paramString = params.toString();
            if (paramString) url += `?${paramString}`;
        } catch (e) {
            console.warn('Failed to parse deep_link_params_map:', e);
        }
    }
    return url;
}

function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('he-IL');
}