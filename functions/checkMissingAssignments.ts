import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Checks for events approaching with missing essential assignments
 * Should be run daily via scheduled automation
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }
        
        console.log('[MissingAssignments] Starting check for missing assignments...');
        
        // Get the notification template
        const templates = await base44.asServiceRole.entities.NotificationTemplate.filter({
            type: 'ADMIN_MISSING_ASSIGNMENT',
            is_active: true
        });
        
        if (templates.length === 0) {
            console.log('[MissingAssignments] Template ADMIN_MISSING_ASSIGNMENT not found or inactive');
            return Response.json({ success: true, message: 'Template not active', processed: 0 });
        }
        
        const template = templates[0];
        const reminderIntervalValue = template.reminder_interval_value || 1;
        const reminderIntervalUnit = template.reminder_interval_unit || 'days';
        const maxReminders = template.max_reminders || 5;
        
        // Get all future events
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const allEvents = await base44.asServiceRole.entities.Event.list();
        const futureEvents = allEvents.filter(e => {
            const eventDate = new Date(e.event_date);
            return eventDate >= today && e.status !== 'cancelled';
        });
        
        // Get all services with alert thresholds
        const services = await base44.asServiceRole.entities.Service.list();
        const servicesWithAlerts = services.filter(s => s.alert_threshold_days > 0 && s.is_active);
        const servicesMap = new Map(services.map(s => [s.id, s]));
        
        if (servicesWithAlerts.length === 0) {
            console.log('[MissingAssignments] No services with alert_threshold_days configured');
            return Response.json({ success: true, message: 'No services with alerts', processed: 0 });
        }
        
        // Get all EventServices
        const allEventServices = await base44.asServiceRole.entities.EventService.list();
        
        // Get admin users to notify
        const allUsers = await base44.asServiceRole.entities.User.list();
        const adminUsers = allUsers.filter(u => u.role === 'admin');
        
        // Get existing notifications
        const existingNotifications = await base44.asServiceRole.entities.InAppNotification.filter({
            template_type: 'ADMIN_MISSING_ASSIGNMENT',
            is_resolved: false
        });
        
        let sentCount = 0;
        let skippedCount = 0;
        
        for (const event of futureEvents) {
            const eventDate = new Date(event.event_date);
            const daysUntilEvent = Math.ceil((eventDate - today) / (1000 * 60 * 60 * 24));
            
            // Get event services
            const eventServices = allEventServices.filter(es => es.event_id === event.id);
            
            for (const service of servicesWithAlerts) {
                // Check if this service's alert threshold applies
                if (daysUntilEvent > service.alert_threshold_days) {
                    continue; // Not yet time to alert for this service
                }
                
                // Find the EventService for this service type
                const eventService = eventServices.find(es => es.service_id === service.id);
                
                // Determine required suppliers
                const minSuppliers = eventService?.min_suppliers ?? service.default_min_suppliers ?? 0;
                
                if (minSuppliers === 0) continue; // No minimum required
                
                // Count approved suppliers
                let approvedCount = 0;
                if (eventService?.supplier_ids && eventService?.supplier_statuses) {
                    try {
                        const supplierIds = JSON.parse(eventService.supplier_ids);
                        const statuses = JSON.parse(eventService.supplier_statuses);
                        approvedCount = supplierIds.filter(id => statuses[id] === 'approved').length;
                    } catch (e) {
                        // No valid suppliers
                    }
                }
                
                // Check if we're short on suppliers
                if (approvedCount >= minSuppliers) continue;
                
                // Check for existing notification
                const existingNotification = existingNotifications.find(n => 
                    n.related_event_id === event.id &&
                    n.message?.includes(service.service_name)
                );
                
                if (existingNotification) {
                    // Check reminder interval
                    const lastSentTime = new Date(existingNotification.created_date);
                    const reminderCutoff = new Date();
                    
                    switch (reminderIntervalUnit) {
                        case 'hours': reminderCutoff.setHours(reminderCutoff.getHours() - reminderIntervalValue); break;
                        case 'days': reminderCutoff.setDate(reminderCutoff.getDate() - reminderIntervalValue); break;
                        case 'weeks': reminderCutoff.setDate(reminderCutoff.getDate() - (reminderIntervalValue * 7)); break;
                    }
                    
                    if (lastSentTime > reminderCutoff) {
                        skippedCount++;
                        continue;
                    }
                    
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
                    service_name: service.service_name,
                    min_suppliers: minSuppliers,
                    current_suppliers: approvedCount,
                    event_id: event.id
                };
                
                const title = replacePlaceholders(template.title_template, contextData);
                const message = replacePlaceholders(template.body_template, contextData);
                const link = buildDeepLink(template.deep_link_base, template.deep_link_params_map, contextData);
                
                // Send to all admins
                for (const admin of adminUsers) {
                    try {
                        await base44.functions.invoke('createNotification', {
                            target_user_id: admin.id,
                            target_user_email: admin.email,
                            title,
                            message,
                            link,
                            template_type: 'ADMIN_MISSING_ASSIGNMENT',
                            related_event_id: event.id,
                            related_event_service_id: eventService?.id || '',
                            send_push: true,
                            check_quiet_hours: true
                        });
                        sentCount++;
                    } catch (error) {
                        console.error(`[MissingAssignments] Error sending to admin ${admin.email}:`, error);
                    }
                }
                
                console.log(`[MissingAssignments] Alerted: ${event.event_name} missing ${service.service_name} (${approvedCount}/${minSuppliers})`);
            }
        }
        
        console.log(`[MissingAssignments] Completed. Sent: ${sentCount}, Skipped: ${skippedCount}`);
        
        return Response.json({
            success: true,
            sent: sentCount,
            skipped: skippedCount
        });
        
    } catch (error) {
        console.error('[MissingAssignments] Error:', error);
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