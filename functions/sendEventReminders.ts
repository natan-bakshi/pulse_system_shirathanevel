import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Sends event reminders to suppliers and admins before events
 * Should be run periodically (e.g., every hour) via scheduled automation
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }
        
        console.log('[EventReminders] Starting event reminder check...');
        
        // Get both reminder templates
        const allTemplates = await base44.asServiceRole.entities.NotificationTemplate.filter({
            is_active: true
        });
        
        const supplierTemplate = allTemplates.find(t => t.type === 'SUPPLIER_EVENT_REMINDER');
        const adminTemplate = allTemplates.find(t => t.type === 'ADMIN_EVENT_REMINDER');
        
        if (!supplierTemplate && !adminTemplate) {
            console.log('[EventReminders] No active event reminder templates found');
            return Response.json({ success: true, message: 'No active templates', processed: 0 });
        }
        
        // Get all events
        const allEvents = await base44.asServiceRole.entities.Event.list();
        const now = new Date();
        
        // Get all event services
        const allEventServices = await base44.asServiceRole.entities.EventService.list();
        
        // Get all suppliers
        const suppliers = await base44.asServiceRole.entities.Supplier.list();
        const suppliersMap = new Map(suppliers.map(s => [s.id, s]));
        
        // Get all users
        const allUsers = await base44.asServiceRole.entities.User.list();
        const adminUsers = allUsers.filter(u => u.role === 'admin');
        
        // Get existing notifications to avoid duplicates
        const existingNotifications = await base44.asServiceRole.entities.InAppNotification.filter({
            is_resolved: false
        });
        
        let sentCount = 0;
        let skippedCount = 0;
        
        for (const event of allEvents) {
            if (event.status === 'cancelled') continue;
            
            const eventDate = new Date(event.event_date);
            if (eventDate < now) continue; // Skip past events
            
            // Check supplier reminders
            if (supplierTemplate) {
                const timingValue = supplierTemplate.timing_value || 1;
                const timingUnit = supplierTemplate.timing_unit || 'days';
                
                // Calculate Event Time in UTC (Assuming input is Israel Time)
                const eventDateTime = getIsraelEventDate(event.event_date, event.event_time);
                
                const reminderCutoff = new Date(eventDateTime);
                switch (timingUnit) {
                    case 'hours': reminderCutoff.setHours(reminderCutoff.getHours() - timingValue); break;
                    case 'days': reminderCutoff.setDate(reminderCutoff.getDate() - timingValue); break;
                    case 'weeks': reminderCutoff.setDate(reminderCutoff.getDate() - (timingValue * 7)); break;
                }
                
                // console.log(`[EventReminders] Event: ${event.event_name}, Date: ${eventDateTime.toISOString()}, Cutoff: ${reminderCutoff.toISOString()}, Now: ${now.toISOString()}`);

                // Check if it's time to send reminder
                if (now >= reminderCutoff) {
                    // Get approved suppliers for this event
                    const eventServices = allEventServices.filter(es => es.event_id === event.id);
                    
                    for (const es of eventServices) {
                        if (!es.supplier_ids || !es.supplier_statuses) continue;
                        
                        let supplierIds = [];
                        let supplierStatuses = {};
                        
                        try {
                            supplierIds = JSON.parse(es.supplier_ids);
                            supplierStatuses = JSON.parse(es.supplier_statuses);
                        } catch (e) {
                            continue;
                        }
                        
                        for (const supplierId of supplierIds) {
                            // Only remind approved/confirmed suppliers
                            const status = supplierStatuses[supplierId];
                            if (status !== 'approved' && status !== 'confirmed') continue;
                            
                            const supplier = suppliersMap.get(supplierId);
                            if (!supplier) continue;
                            
                            // Find user for supplier
                            const supplierUser = allUsers.find(u => 
                                supplier.contact_emails?.includes(u.email)
                            );
                            
                            if (!supplierUser) continue;
                            
                            // Check for existing reminder
                            const hasExisting = existingNotifications.some(n => 
                                n.template_type === 'SUPPLIER_EVENT_REMINDER' &&
                                n.related_event_id === event.id &&
                                n.user_id === supplierUser.id
                            );
                            
                            if (hasExisting) {
                                skippedCount++;
                                continue;
                            }
                            
                            // Send reminder
                            const contextData = {
                                event_name: event.event_name,
                                family_name: event.family_name,
                                event_date: formatDate(event.event_date),
                                event_time: event.event_time || '',
                                event_location: event.location || '',
                                supplier_name: supplier.supplier_name,
                                event_id: event.id
                            };
                            
                            const title = replacePlaceholders(supplierTemplate.title_template, contextData);
                            const message = replacePlaceholders(supplierTemplate.body_template, contextData);
                            const link = buildDeepLink(supplierTemplate.deep_link_base, supplierTemplate.deep_link_params_map, contextData);
                            
                            try {
                                // Create in-app notification directly using service role
                                await base44.asServiceRole.entities.InAppNotification.create({
                                    user_id: supplierUser.id,
                                    user_email: supplierUser.email,
                                    title,
                                    message,
                                    link,
                                    is_read: false,
                                    template_type: 'SUPPLIER_EVENT_REMINDER',
                                    related_event_id: event.id,
                                    related_event_service_id: es.id,
                                    related_supplier_id: supplierId,
                                    push_sent: false,
                                    reminder_count: 0,
                                    is_resolved: false
                                });
                                sentCount++;
                            } catch (error) {
                                console.error(`[EventReminders] Error sending to supplier:`, error);
                            }
                        }
                    }
                }
            }
            
            // Check admin reminders
            if (adminTemplate) {
                const timingValue = adminTemplate.timing_value || 1;
                const timingUnit = adminTemplate.timing_unit || 'days';
                
                const reminderCutoff = new Date(eventDate);
                switch (timingUnit) {
                    case 'hours': reminderCutoff.setHours(reminderCutoff.getHours() - timingValue); break;
                    case 'days': reminderCutoff.setDate(reminderCutoff.getDate() - timingValue); break;
                    case 'weeks': reminderCutoff.setDate(reminderCutoff.getDate() - (timingValue * 7)); break;
                }
                
                if (now >= reminderCutoff) {
                    for (const admin of adminUsers) {
                        // Check for existing reminder
                        const hasExisting = existingNotifications.some(n => 
                            n.template_type === 'ADMIN_EVENT_REMINDER' &&
                            n.related_event_id === event.id &&
                            n.user_id === admin.id
                        );
                        
                        if (hasExisting) {
                            skippedCount++;
                            continue;
                        }
                        
                        const contextData = {
                            event_name: event.event_name,
                            family_name: event.family_name,
                            event_date: formatDate(event.event_date),
                            event_time: event.event_time || '',
                            event_location: event.location || '',
                            event_id: event.id
                        };
                        
                        const title = replacePlaceholders(adminTemplate.title_template, contextData);
                        const message = replacePlaceholders(adminTemplate.body_template, contextData);
                        const link = buildDeepLink(adminTemplate.deep_link_base, adminTemplate.deep_link_params_map, contextData);
                        
                        try {
                            // Create in-app notification directly using service role
                            await base44.asServiceRole.entities.InAppNotification.create({
                                user_id: admin.id,
                                user_email: admin.email,
                                title,
                                message,
                                link,
                                is_read: false,
                                template_type: 'ADMIN_EVENT_REMINDER',
                                related_event_id: event.id,
                                push_sent: false,
                                reminder_count: 0,
                                is_resolved: false
                            });
                            sentCount++;
                        } catch (error) {
                            console.error(`[EventReminders] Error sending to admin:`, error);
                        }
                    }
                }
            }
        }
        
        console.log(`[EventReminders] Completed. Sent: ${sentCount}, Skipped: ${skippedCount}`);
        
        return Response.json({
            success: true,
            sent: sentCount,
            skipped: skippedCount
        });
        
    } catch (error) {
        console.error('[EventReminders] Error:', error);
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

function getIsraelEventDate(dateStr, timeStr) {
    let time = timeStr || '00:00';
    if (!time.match(/^\d{1,2}:\d{2}$/)) time = '00:00';
    
    // Create UTC date from string (e.g. 2026-02-16T09:00:00Z)
    const d = new Date(`${dateStr}T${time}:00Z`);
    
    // Israel is UTC+2 in Winter, UTC+3 in Summer
    // Simple heuristic: Summer clock is roughly Apr-Oct
    const month = d.getMonth() + 1;
    const isSummer = month >= 4 && month <= 10;
    const offsetHours = isSummer ? 3 : 2;
    
    // Subtract offset to get true UTC moment corresponding to Israel time
    d.setHours(d.getHours() - offsetHours);
    return d;
}