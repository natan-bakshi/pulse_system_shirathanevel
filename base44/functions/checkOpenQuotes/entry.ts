import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Checks for open quotes that haven't been converted and sends reminders to admins
 * Should be run daily via scheduled automation
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }
        
        console.log('[OpenQuotes] Starting check for open quotes...');
        
        // Get the notification template
        const templates = await base44.asServiceRole.entities.NotificationTemplate.filter({
            type: 'ADMIN_QUOTE_FOLLOWUP',
            is_active: true
        });
        
        if (templates.length === 0) {
            console.log('[OpenQuotes] Template ADMIN_QUOTE_FOLLOWUP not found or inactive');
            return Response.json({ success: true, message: 'Template not active', processed: 0 });
        }
        
        const template = templates[0];
        const timingValue = template.timing_value || 7;
        const timingUnit = template.timing_unit || 'days';
        const reminderIntervalValue = template.reminder_interval_value || 3;
        const reminderIntervalUnit = template.reminder_interval_unit || 'days';
        const maxReminders = template.max_reminders || 3;
        
        // Calculate cutoff time for quotes
        const cutoffTime = new Date();
        switch (timingUnit) {
            case 'days': cutoffTime.setDate(cutoffTime.getDate() - timingValue); break;
            case 'weeks': cutoffTime.setDate(cutoffTime.getDate() - (timingValue * 7)); break;
            case 'months': cutoffTime.setMonth(cutoffTime.getMonth() - timingValue); break;
        }
        
        // Get all events with quote status
        const allEvents = await base44.asServiceRole.entities.Event.list();
        const quoteEvents = allEvents.filter(e => 
            e.status === 'quote' && 
            new Date(e.created_date) <= cutoffTime
        );
        
        // Get admin users
        const allUsers = await base44.asServiceRole.entities.User.list();
        const adminUsers = allUsers.filter(u => u.role === 'admin');
        
        // Get existing notifications
        const existingNotifications = await base44.asServiceRole.entities.InAppNotification.filter({
            template_type: 'ADMIN_QUOTE_FOLLOWUP',
            is_resolved: false
        });
        
        let sentCount = 0;
        let skippedCount = 0;
        
        for (const event of quoteEvents) {
            // Calculate days the quote has been open
            const createdDate = new Date(event.created_date);
            const daysOpen = Math.floor((new Date() - createdDate) / (1000 * 60 * 60 * 24));
            
            for (const admin of adminUsers) {
                // Check for existing notification
                const existingNotification = existingNotifications.find(n => 
                    n.related_event_id === event.id &&
                    n.user_id === admin.id
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
                    days_open: daysOpen,
                    event_id: event.id
                };
                
                const title = replacePlaceholders(template.title_template, contextData);
                const message = replacePlaceholders(template.body_template, contextData);
                const link = buildDeepLink(template.deep_link_base, template.deep_link_params_map, contextData);
                
                try {
                    // Create in-app notification directly using service role
                    await base44.asServiceRole.entities.InAppNotification.create({
                        user_id: admin.id,
                        user_email: admin.email,
                        title,
                        message,
                        link,
                        is_read: false,
                        template_type: 'ADMIN_QUOTE_FOLLOWUP',
                        related_event_id: event.id,
                        push_sent: false,
                        reminder_count: existingNotification ? (existingNotification.reminder_count || 0) + 1 : 0,
                        is_resolved: false
                    });
                    sentCount++;
                    console.log(`[OpenQuotes] Sent reminder for quote: ${event.event_name} (${daysOpen} days open)`);
                } catch (error) {
                    console.error(`[OpenQuotes] Error sending to admin ${admin.email}:`, error);
                }
            }
        }
        
        console.log(`[OpenQuotes] Completed. Sent: ${sentCount}, Skipped: ${skippedCount}`);
        
        return Response.json({
            success: true,
            sent: sentCount,
            skipped: skippedCount,
            open_quotes_found: quoteEvents.length
        });
        
    } catch (error) {
        console.error('[OpenQuotes] Error:', error);
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