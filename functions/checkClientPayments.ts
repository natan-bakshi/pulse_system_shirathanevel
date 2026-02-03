import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Checks for completed events with outstanding payments and notifies clients
 * Should be run daily via scheduled automation
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }
        
        console.log('[ClientPayments] Starting check for outstanding payments...');
        
        // Get the notification template
        const templates = await base44.asServiceRole.entities.NotificationTemplate.filter({
            type: 'CLIENT_PAYMENT_REMINDER',
            is_active: true
        });
        
        if (templates.length === 0) {
            console.log('[ClientPayments] Template CLIENT_PAYMENT_REMINDER not found or inactive');
            return Response.json({ success: true, message: 'Template not active', processed: 0 });
        }
        
        const template = templates[0];
        const timingValue = template.timing_value || 1;
        const timingUnit = template.timing_unit || 'days';
        const reminderIntervalValue = template.reminder_interval_value || 7;
        const reminderIntervalUnit = template.reminder_interval_unit || 'days';
        const maxReminders = template.max_reminders || 4;
        
        // Get all events
        const allEvents = await base44.asServiceRole.entities.Event.list();
        const today = new Date();
        
        // Filter events that have passed and are not cancelled
        const pastEvents = allEvents.filter(e => {
            const eventDate = new Date(e.event_date);
            eventDate.setDate(eventDate.getDate() + timingValue); // Add timing_value days after event
            return eventDate <= today && e.status !== 'cancelled';
        });
        
        // Get all payments
        const allPayments = await base44.asServiceRole.entities.Payment.list();
        
        // Get all event services for price calculation
        const allEventServices = await base44.asServiceRole.entities.EventService.list();
        
        // Get all users
        const allUsers = await base44.asServiceRole.entities.User.list();
        
        // Get VAT rate from settings
        const appSettings = await base44.asServiceRole.entities.AppSettings.list();
        const vatSetting = appSettings.find(s => s.setting_key === 'vat_rate');
        const vatRate = vatSetting ? parseFloat(vatSetting.setting_value) / 100 : 0.17;
        
        // Get existing notifications
        const existingNotifications = await base44.asServiceRole.entities.InAppNotification.filter({
            template_type: 'CLIENT_PAYMENT_REMINDER',
            is_resolved: false
        });
        
        let sentCount = 0;
        let skippedCount = 0;
        
        for (const event of pastEvents) {
            // Calculate total cost for event
            let totalCost = 0;
            
            if (event.all_inclusive && event.all_inclusive_price) {
                totalCost = event.all_inclusive_price;
                if (!event.all_inclusive_includes_vat) {
                    totalCost = totalCost * (1 + vatRate);
                }
            } else if (event.total_override) {
                totalCost = event.total_override;
                if (!event.total_override_includes_vat) {
                    totalCost = totalCost * (1 + vatRate);
                }
            } else {
                // Calculate from services
                const eventServices = allEventServices.filter(es => es.event_id === event.id);
                for (const es of eventServices) {
                    const price = es.custom_price || es.total_price || 0;
                    const quantity = es.quantity || 1;
                    let serviceCost = price * quantity;
                    if (!es.includes_vat) {
                        serviceCost = serviceCost * (1 + vatRate);
                    }
                    totalCost += serviceCost;
                }
            }
            
            // Apply discount if any
            if (event.discount_amount) {
                totalCost = Math.max(0, totalCost - event.discount_amount);
            }
            
            // Calculate total paid
            const eventPayments = allPayments.filter(p => 
                p.event_id === event.id && p.payment_status === 'completed'
            );
            const totalPaid = eventPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
            
            // Calculate balance
            const balance = totalCost - totalPaid;
            
            // Skip if no balance due
            if (balance <= 0) continue;
            
            // Find client user(s) associated with this event
            // Clients are identified by having parent email matching a user
            const clientUsers = [];
            if (event.parents && Array.isArray(event.parents)) {
                for (const parent of event.parents) {
                    if (parent.email) {
                        const clientUser = allUsers.find(u => 
                            u.email?.toLowerCase() === parent.email.toLowerCase()
                        );
                        if (clientUser) {
                            clientUsers.push(clientUser);
                        }
                    }
                }
            }
            
            if (clientUsers.length === 0) {
                console.log(`[ClientPayments] No client users found for event ${event.event_name}`);
                continue;
            }
            
            for (const clientUser of clientUsers) {
                // Check for existing notification
                const existingNotification = existingNotifications.find(n => 
                    n.related_event_id === event.id &&
                    n.user_id === clientUser.id
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
                    balance: formatCurrency(balance),
                    event_id: event.id
                };
                
                const title = replacePlaceholders(template.title_template, contextData);
                const message = replacePlaceholders(template.body_template, contextData);
                const link = buildDeepLink(template.deep_link_base, template.deep_link_params_map, contextData);
                
                try {
                    await base44.functions.invoke('createNotification', {
                        target_user_id: clientUser.id,
                        target_user_email: clientUser.email,
                        title,
                        message,
                        link,
                        template_type: 'CLIENT_PAYMENT_REMINDER',
                        related_event_id: event.id,
                        send_push: true,
                        check_quiet_hours: true
                    });
                    sentCount++;
                    console.log(`[ClientPayments] Sent payment reminder to ${clientUser.email} for event ${event.event_name}, balance: ${balance}`);
                } catch (error) {
                    console.error(`[ClientPayments] Error sending to ${clientUser.email}:`, error);
                }
            }
        }
        
        console.log(`[ClientPayments] Completed. Sent: ${sentCount}, Skipped: ${skippedCount}`);
        
        return Response.json({
            success: true,
            sent: sentCount,
            skipped: skippedCount
        });
        
    } catch (error) {
        console.error('[ClientPayments] Error:', error);
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

function formatCurrency(amount) {
    return new Intl.NumberFormat('he-IL', {
        style: 'decimal',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount);
}