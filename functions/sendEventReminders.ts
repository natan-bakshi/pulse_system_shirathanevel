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
        
        // Get all suppliers (Limit 1000 to be safe)
        const suppliers = await base44.asServiceRole.entities.Supplier.list(); // TODO: Add pagination loop if > 50
        const suppliersMap = new Map(suppliers.map(s => [s.id, s]));
        
        // Get all users
        const allUsers = await base44.asServiceRole.entities.User.list();
        const adminUsers = allUsers.filter(u => u.role === 'admin');
        
        // Get existing notifications to avoid duplicates
        const existingNotifications = await base44.asServiceRole.entities.InAppNotification.filter({
            is_resolved: false
        });
        
        // Secrets for WA
        const GREEN_API_INSTANCE_ID = Deno.env.get("GREEN_API_INSTANCE_ID");
        const GREEN_API_TOKEN = Deno.env.get("GREEN_API_TOKEN");
        
        // Check quiet hours (default 22:00-08:00 Israel time)
        const DEFAULT_QUIET_START = 22;
        const DEFAULT_QUIET_END = 8;
        const currentlyInQuietHours = isInQuietHours(DEFAULT_QUIET_START, DEFAULT_QUIET_END);
        const quietHoursEndTime = currentlyInQuietHours ? getQuietHoursEndTime(DEFAULT_QUIET_END) : null;
        
        if (currentlyInQuietHours) {
            console.log(`[EventReminders] Currently in quiet hours (${DEFAULT_QUIET_START}:00-${DEFAULT_QUIET_END}:00). WhatsApp messages will be queued.`);
        }
        
        let sentCount = 0;
        let skippedCount = 0;
        let queuedCount = 0;
        
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
                    case 'minutes': reminderCutoff.setMinutes(reminderCutoff.getMinutes() - timingValue); break;
                    case 'hours': reminderCutoff.setHours(reminderCutoff.getHours() - timingValue); break;
                    case 'days': reminderCutoff.setDate(reminderCutoff.getDate() - timingValue); break;
                    case 'weeks': reminderCutoff.setDate(reminderCutoff.getDate() - (timingValue * 7)); break;
                }
                
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
                            
                            // Determine Target User ID (Virtual) - Decoupled from User entity
                            const targetUserId = `virtual_supplier_${supplierId}`;
                            const targetUserEmail = supplier.contact_emails?.[0] || '';

                            // Check for existing reminder in DB logs
                            const hasExisting = existingNotifications.some(n => 
                                n.template_type === 'SUPPLIER_EVENT_REMINDER' &&
                                n.related_event_id === event.id &&
                                n.related_supplier_id === supplierId
                            );

                            if (hasExisting) {
                                skippedCount++;
                                continue;
                            }

                            // Prepare Content
                            const contextData = {
                                event_name: event.event_name,
                                family_name: event.family_name,
                                event_date: formatDate(event.event_date),
                                event_time: event.event_time || '',
                                event_location: event.location || '',
                                supplier_name: supplier.contact_person || supplier.supplier_name,
                                supplier_phone: supplier.phone,
                                event_id: event.id
                            };

                            const title = replacePlaceholders(supplierTemplate.title_template, contextData);
                            let message = replacePlaceholders(supplierTemplate.body_template, contextData);
                            const whatsappMessage = replacePlaceholders(supplierTemplate.whatsapp_body_template || supplierTemplate.body_template, contextData);
                            const link = buildDeepLink(supplierTemplate.deep_link_base, supplierTemplate.deep_link_params_map, contextData);

                            // DIRECT SEND FIRST (Decoupled from InAppNotification)
                            let whatsappSent = false;
                            
                            // Always try to send if phone exists (user policy: no opt-out)
                            if (supplier.phone) {
                                try {
                                    if (GREEN_API_INSTANCE_ID && GREEN_API_TOKEN) {
                                        let cleanPhone = supplier.phone.toString().replace(/[^0-9]/g, '');
                                        if (cleanPhone.startsWith('05')) cleanPhone = '972' + cleanPhone.substring(1);
                                        else if (cleanPhone.length === 9 && cleanPhone.startsWith('5')) cleanPhone = '972' + cleanPhone;

                                        const chatId = `${cleanPhone}@c.us`;
                                        const body = { chatId, message: whatsappMessage };

                                        const response = await fetch(`https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`, {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify(body)
                                        });
                                        
                                        if (response.ok) {
                                            whatsappSent = true;
                                            console.log(`[EventReminders] DIRECT WhatsApp sent to ${supplier.supplier_name} (${supplier.phone})`);
                                        } else {
                                            const err = await response.text();
                                            console.error(`[EventReminders] Green API Error: ${err}`);
                                        }
                                    }
                                } catch (waError) {
                                    console.error(`[EventReminders] DIRECT WhatsApp failed for ${supplier.supplier_name}:`, waError);
                                }
                            }

                            // THEN CREATE LOG (InAppNotification)
                            try {
                                await base44.asServiceRole.entities.InAppNotification.create({
                                    user_id: targetUserId,
                                    user_email: targetUserEmail,
                                    title,
                                    message,
                                    link,
                                    is_read: false,
                                    template_type: 'SUPPLIER_EVENT_REMINDER',
                                    related_event_id: event.id,
                                    related_event_service_id: es.id,
                                    related_supplier_id: supplierId,
                                    push_sent: false,
                                    whatsapp_sent: whatsappSent,
                                    reminder_count: 0,
                                    is_resolved: false
                                });
                                sentCount++;
                            } catch (error) {
                                console.error(`[EventReminders] Error creating log for supplier ${supplier.supplier_name}:`, error);
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
                    case 'minutes': reminderCutoff.setMinutes(reminderCutoff.getMinutes() - timingValue); break;
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
                            event_id: event.id,
                            admin_name: admin.full_name,
                            user_name: admin.full_name
                        };
                        
                        const title = replacePlaceholders(adminTemplate.title_template, contextData);
                        const message = replacePlaceholders(adminTemplate.body_template, contextData);
                        const whatsappMessage = replacePlaceholders(adminTemplate.whatsapp_body_template || adminTemplate.body_template, contextData);
                        const link = buildDeepLink(adminTemplate.deep_link_base, adminTemplate.deep_link_params_map, contextData);
                        
                        // DIRECT SEND FIRST (Added for Admin)
                        let whatsappSent = false;
                        
                        if (admin.phone) {
                            try {
                                if (GREEN_API_INSTANCE_ID && GREEN_API_TOKEN) {
                                    let cleanPhone = admin.phone.toString().replace(/[^0-9]/g, '');
                                    if (cleanPhone.startsWith('05')) cleanPhone = '972' + cleanPhone.substring(1);
                                    else if (cleanPhone.length === 9 && cleanPhone.startsWith('5')) cleanPhone = '972' + cleanPhone;

                                    const chatId = `${cleanPhone}@c.us`;
                                    const body = { chatId, message: whatsappMessage };

                                    const response = await fetch(`https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify(body)
                                    });
                                    
                                    if (response.ok) {
                                        whatsappSent = true;
                                        console.log(`[EventReminders] DIRECT WhatsApp sent to admin ${admin.full_name}`);
                                    } else {
                                        const err = await response.text();
                                        console.error(`[EventReminders] Green API Error (Admin): ${err}`);
                                    }
                                }
                            } catch (waError) {
                                console.error(`[EventReminders] DIRECT WhatsApp failed for admin ${admin.full_name}:`, waError);
                            }
                        }

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
                                whatsapp_sent: whatsappSent,
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
    let time = timeStr || '09:00';
    if (!time.match(/^\d{1,2}:\d{2}$/)) time = '09:00';
    
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