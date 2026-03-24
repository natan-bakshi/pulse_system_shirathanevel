import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Checks for pending supplier assignments and sends reminder notifications
 * Should be run periodically (e.g., every hour) via scheduled automation
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }
        
        console.log('[PendingAssignments] Starting check for pending supplier assignments...');
        
        // Get the notification template
        const templates = await base44.asServiceRole.entities.NotificationTemplate.filter({
            type: 'SUPPLIER_PENDING_REMINDER',
            is_active: true
        });
        
        if (templates.length === 0) {
            console.log('[PendingAssignments] Template SUPPLIER_PENDING_REMINDER not found or inactive');
            return Response.json({ success: true, message: 'Template not active', processed: 0 });
        }
        
        const template = templates[0];
        const timingValue = template.timing_value || 24;
        const timingUnit = template.timing_unit || 'hours';
        const reminderIntervalValue = template.reminder_interval_value || 24;
        const reminderIntervalUnit = template.reminder_interval_unit || 'hours';
        const maxReminders = template.max_reminders || 3;
        
        // Calculate the cutoff time
        const cutoffTime = new Date();
        switch (timingUnit) {
            case 'minutes': cutoffTime.setMinutes(cutoffTime.getMinutes() - timingValue); break;
            case 'hours': cutoffTime.setHours(cutoffTime.getHours() - timingValue); break;
            case 'days': cutoffTime.setDate(cutoffTime.getDate() - timingValue); break;
            case 'weeks': cutoffTime.setDate(cutoffTime.getDate() - (timingValue * 7)); break;
            case 'months': cutoffTime.setMonth(cutoffTime.getMonth() - timingValue); break;
        }
        
        // Get all EventServices with pending suppliers
        const allEventServices = await base44.asServiceRole.entities.EventService.list();
        
        // Get all events for context
        const events = await base44.asServiceRole.entities.Event.list();
        const eventsMap = new Map(events.map(e => [e.id, e]));
        
        // Get all suppliers for context
        const suppliers = await base44.asServiceRole.entities.Supplier.list();
        const suppliersMap = new Map(suppliers.map(s => [s.id, s]));
        
        // Get all users for linking suppliers to users
        const users = await base44.asServiceRole.entities.User.list();
        
        // Get existing notifications to check for duplicates
        const existingNotifications = await base44.asServiceRole.entities.InAppNotification.filter({
            template_type: 'SUPPLIER_PENDING_REMINDER',
            is_resolved: false
        });
        
        let sentCount = 0;
        let skippedCount = 0;
        
        for (const es of allEventServices) {
            if (!es.supplier_ids || !es.supplier_statuses) continue;
            
            const event = eventsMap.get(es.event_id);
            if (!event) continue;
            
            // Skip past events
            if (new Date(event.event_date) < new Date()) continue;
            
            let supplierIds = [];
            let supplierStatuses = {};
            
            try {
                supplierIds = JSON.parse(es.supplier_ids);
                supplierStatuses = JSON.parse(es.supplier_statuses);
            } catch (e) {
                continue;
            }
            
            for (const supplierId of supplierIds) {
                const status = supplierStatuses[supplierId];
                
                // Only process pending assignments
                if (status !== 'pending') continue;
                
                const supplier = suppliersMap.get(supplierId);
                if (!supplier) continue;
                
                // Find the user associated with this supplier
                const supplierUser = users.find(u => 
                    supplier.contact_emails?.includes(u.email) ||
                    (u.phone && supplier.phone === u.phone)
                );
                
                if (!supplierUser) {
                    console.log(`[PendingAssignments] No user found for supplier ${supplier.supplier_name}`);
                    continue;
                }
                
                // Check if we already sent a notification for this specific assignment
                const existingNotification = existingNotifications.find(n => 
                    n.related_event_service_id === es.id &&
                    n.related_supplier_id === supplierId &&
                    n.user_id === supplierUser.id
                );
                
                if (existingNotification) {
                    // Check if it's time for a reminder
                    const lastSentTime = new Date(existingNotification.created_date);
                    const reminderCutoff = new Date();
                    
                    switch (reminderIntervalUnit) {
                        case 'hours': reminderCutoff.setHours(reminderCutoff.getHours() - reminderIntervalValue); break;
                        case 'days': reminderCutoff.setDate(reminderCutoff.getDate() - reminderIntervalValue); break;
                        case 'weeks': reminderCutoff.setDate(reminderCutoff.getDate() - (reminderIntervalValue * 7)); break;
                    }
                    
                    // Skip if reminder interval hasn't passed
                    if (lastSentTime > reminderCutoff) {
                        skippedCount++;
                        continue;
                    }
                    
                    // Skip if max reminders reached
                    if (existingNotification.reminder_count >= maxReminders) {
                        skippedCount++;
                        continue;
                    }
                }
                
                // Build notification content
                const contextData = {
                    event_name: event.event_name,
                    family_name: event.family_name,
                    event_date: formatDate(event.event_date),
                    event_time: event.event_time || '',
                    event_location: event.location || '',
                    supplier_name: supplier.supplier_name,
                    event_id: event.id
                };
                
                const title = replacePlaceholders(template.title_template, contextData);
                const message = replacePlaceholders(template.body_template, contextData);
                const link = buildDeepLink(template.deep_link_base, template.deep_link_params_map, contextData);
                
                // Send notification
                try {
                    await base44.functions.invoke('createNotification', {
                        target_user_id: supplierUser.id,
                        target_user_email: supplierUser.email,
                        title,
                        message,
                        link,
                        template_type: 'SUPPLIER_PENDING_REMINDER',
                        related_event_id: event.id,
                        related_event_service_id: es.id,
                        related_supplier_id: supplierId,
                        send_push: true,
                        check_quiet_hours: true
                    });
                    
                    sentCount++;
                    console.log(`[PendingAssignments] Sent reminder to ${supplier.supplier_name} for event ${event.event_name}`);
                } catch (error) {
                    console.error(`[PendingAssignments] Error sending notification:`, error);
                }
            }
        }
        
        console.log(`[PendingAssignments] Completed. Sent: ${sentCount}, Skipped: ${skippedCount}`);
        
        return Response.json({
            success: true,
            sent: sentCount,
            skipped: skippedCount
        });
        
    } catch (error) {
        console.error('[PendingAssignments] Error:', error);
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