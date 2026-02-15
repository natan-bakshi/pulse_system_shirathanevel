import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Checks for automated notification triggers (Business Logic)
 * Runs periodically (e.g., hourly/daily)
 * Handles: Before/After Event Date, Status Checks, etc.
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        console.log('[AutomatedTriggers] Starting check...');
        
        // 1. Fetch active scheduled templates
        const templates = await base44.asServiceRole.entities.NotificationTemplate.filter({
            is_active: true,
            trigger_type: 'scheduled_check'
        });
        
        console.log(`[AutomatedTriggers] Found ${templates.length} active scheduled templates`);
        
        const results = {
            processed_templates: 0,
            notifications_created: 0,
            errors: 0
        };
        
        for (const template of templates) {
            try {
                results.processed_templates++;
                await processTemplate(base44, template, results);
            } catch (e) {
                console.error(`[AutomatedTriggers] Error processing template ${template.type}:`, e);
                results.errors++;
            }
        }
        
        return Response.json({ success: true, results });
        
    } catch (error) {
        console.error('[AutomatedTriggers] Critical Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});

async function processTemplate(base44, template, results) {
    if (!template.timing_value || !template.timing_unit || !template.timing_direction) {
        console.warn(`[AutomatedTriggers] Template ${template.type} missing timing configuration`);
        return;
    }
    
    // Determine Target Date Range
    const targetDateStart = new Date();
    const targetDateEnd = new Date();
    
    targetDateStart.setHours(0,0,0,0);
    targetDateEnd.setHours(23,59,59,999);
    
    const multiplier = template.timing_direction === 'before' ? 1 : (template.timing_direction === 'after' ? -1 : 0);
    
    const offset = template.timing_value * (template.timing_direction === 'after' ? -1 : 1);
    
    if (template.timing_direction === 'during') {
        // No offset needed
    } else {
        if (template.timing_unit === 'days') {
            targetDateStart.setDate(targetDateStart.getDate() + offset);
            targetDateEnd.setDate(targetDateEnd.getDate() + offset);
        } else if (template.timing_unit === 'weeks') {
            targetDateStart.setDate(targetDateStart.getDate() + (offset * 7));
            targetDateEnd.setDate(targetDateEnd.getDate() + (offset * 7));
        } else if (template.timing_unit === 'hours') {
            const now = new Date();
            now.setHours(now.getHours() + offset);
            targetDateStart.setTime(now.getTime() - 30 * 60000);
            targetDateEnd.setTime(now.getTime() + 30 * 60000);
        } else if (template.timing_unit === 'minutes') {
            const now = new Date();
            now.setMinutes(now.getMinutes() + offset);
            // Window of +/- 1 minute for precision
            targetDateStart.setTime(now.getTime() - 60000);
            targetDateEnd.setTime(now.getTime() + 60000);
        }
    }
    
    const dateStr = targetDateStart.toISOString().split('T')[0];
    
    let events = [];
    
    if (template.timing_reference === 'event_date' || !template.timing_reference) {
        console.log(`[AutomatedTriggers] Processing ${template.type}: Checking Event Date around ${dateStr}`);
        events = await base44.asServiceRole.entities.Event.filter({
            event_date: dateStr
        });
    } else if (template.timing_reference === 'event_end_time') {
        events = await base44.asServiceRole.entities.Event.filter({
            event_date: dateStr
        });
    }
    
    console.log(`[AutomatedTriggers] Found ${events.length} candidate events`);
    
    for (const event of events) {
        // --- Condition Logic Update (Support AND / OR) ---
        const logic = template.condition_logic || 'and';
        let conditionResult = logic === 'and' ? true : false; 
        
        // Combine Legacy + New conditions into one array for processing
        let allConditions = [];
        
        // 1. Legacy
        if (template.condition_field && template.condition_value) {
            allConditions.push({
                field: template.condition_field,
                operator: template.condition_operator || 'equals',
                value: template.condition_value
            });
        }
        
        // 2. New Conditions
        if (template.event_filter_condition) {
            try {
                const parsed = JSON.parse(template.event_filter_condition);
                if (Array.isArray(parsed)) {
                    allConditions = [...allConditions, ...parsed];
                }
            } catch (e) {}
        }

        // Process Logic
        if (allConditions.length > 0) {
            if (logic === 'and') {
                // AND: All must be true. If one fails, result is false.
                for (const cond of allConditions) {
                    const met = await checkSingleCondition(base44, event, cond);
                    if (!met) {
                        conditionResult = false;
                        break;
                    }
                }
            } else {
                // OR: Any must be true. If one succeeds, result is true.
                // Start with false (set above).
                for (const cond of allConditions) {
                    const met = await checkSingleCondition(base44, event, cond);
                    if (met) {
                        conditionResult = true;
                        break;
                    }
                }
            }
        } else {
            // No conditions = pass
            conditionResult = true;
        }

        if (!conditionResult) continue;
        
        // Check duplication
        const existingNotifs = await base44.asServiceRole.entities.InAppNotification.filter({
            related_event_id: event.id,
            template_type: template.type
        });
        
        if (existingNotifs.length > 0) {
            // Already sent logic (omitted for brevity)
            continue; 
        }
        
        // Determine Recipients & Send
        await sendToAudiences(base44, template, event, results);
    }
}

// Helper to check a single condition against an event
async function checkSingleCondition(base44, event, condition) {
    let eventValue = event[condition.field];
    const requiredValue = condition.value;
    const operator = condition.operator || 'equals';

    // --- Special Computed Fields ---
    if (condition.field === 'balance') {
        // Calculate balance: Total Price (with override) - Paid Payments
        try {
            const payments = await base44.asServiceRole.entities.Payment.filter({ event_id: event.id, payment_status: 'completed' });
            const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
            
            // Logic for total price (simplified)
            let totalPrice = event.total_override || event.all_inclusive_price || 0;
            // TODO: Add complex VAT logic if needed, currently raw numbers
            
            eventValue = totalPrice - totalPaid;
        } catch (e) {
            console.warn('Error calculating balance', e);
            eventValue = 0;
        }
    } else if (condition.field === 'has_missing_suppliers') {
        // Logic to check if suppliers are missing
        try {
            const eventServices = await base44.asServiceRole.entities.EventService.filter({ event_id: event.id });
            const missing = eventServices.some(es => !es.supplier_ids || es.supplier_ids === '[]' || JSON.parse(es.supplier_ids || '[]').length === 0);
            eventValue = missing ? 'true' : 'false';
        } catch (e) {
            eventValue = 'false';
        }
    } else if (condition.field === 'assignment_status') {
        // Logic: Does ANY supplier assignment for this event match the requested status?
        // Note: Supplier statuses are stored in EventService.supplier_statuses (JSON object: {supplier_id: status})
        try {
            const eventServices = await base44.asServiceRole.entities.EventService.filter({ event_id: event.id });
            let foundStatus = false;
            
            // We iterate all services and all suppliers in them to see if ANY matches the condition value
            for (const es of eventServices) {
                if (es.supplier_statuses) {
                    let statuses = {};
                    try {
                        statuses = typeof es.supplier_statuses === 'string' ? JSON.parse(es.supplier_statuses) : es.supplier_statuses;
                    } catch (e) {}
                    
                    // Check if any value in the statuses object matches condition.value
                    if (Object.values(statuses).some(s => s === requiredValue)) {
                        foundStatus = true;
                        break;
                    }
                }
            }
            // If we found the status, we set eventValue to requiredValue to make the 'equals' check pass
            // Or we handle the logic here and return directly
            if (operator === 'equals') return foundStatus;
            if (operator === 'not_equals') return !foundStatus;
            
            // For other operators, let's treat it as a string check on "true"/"false" if found? 
            // Simplest is to return the boolean result directly for equals/not_equals which are 99% of use cases for status
            return foundStatus;
            
        } catch (e) {
            return false;
        }
    }

    // --- Comparisons ---
    // Handle numeric comparisons safely
    if (['greater_than', 'less_than'].includes(operator)) {
        const numEvent = parseFloat(eventValue);
        const numReq = parseFloat(requiredValue);
        if (!isNaN(numEvent) && !isNaN(numReq)) {
            if (operator === 'greater_than') return numEvent > numReq;
            if (operator === 'less_than') return numEvent < numReq;
        }
    }

    switch (operator) {
        case 'equals': return String(eventValue) == String(requiredValue);
        case 'not_equals': return String(eventValue) != String(requiredValue);
        case 'contains': return String(eventValue || '').includes(requiredValue);
        case 'is_empty': return !eventValue || eventValue === '';
        case 'is_not_empty': return !!eventValue && eventValue !== '';
        default: return String(eventValue) == String(requiredValue);
    }
}

async function sendToAudiences(base44, template, event, results) {
    const audiences = template.target_audiences || [];
    
    // 1. Supplier Audience
    if (audiences.includes('supplier')) {
        const eventServices = await base44.asServiceRole.entities.EventService.filter({ event_id: event.id });
        for (const es of eventServices) {
            if (es.supplier_ids) {
                let supplierIds = [];
                try {
                    supplierIds = typeof es.supplier_ids === 'string' ? JSON.parse(es.supplier_ids) : es.supplier_ids;
                } catch (e) {}
                
                if (Array.isArray(supplierIds)) {
                    for (const supplierId of supplierIds) {
                        const supplier = (await base44.asServiceRole.entities.Supplier.filter({ id: supplierId }))[0];
                        if (!supplier) continue;
                        
                        let targetUsers = [];
                        if (supplier.contact_emails && supplier.contact_emails.length > 0) {
                             for (const email of supplier.contact_emails) {
                                 const users = await base44.asServiceRole.entities.User.filter({ email: email });
                                 targetUsers.push(...users);
                             }
                        }
                        
                        for (const user of targetUsers) {
                            await triggerNotification(base44, template, event, user, supplier, es, results);
                        }
                    }
                }
            }
        }
    }
    
    // 2. Client Audience
    if (audiences.includes('client')) {
        if (event.parents && Array.isArray(event.parents)) {
            for (const parent of event.parents) {
                if (parent.email) {
                    const users = await base44.asServiceRole.entities.User.filter({ email: parent.email });
                    for (const user of users) {
                        await triggerNotification(base44, template, event, user, null, null, results);
                    }
                }
            }
        }
    }
    
    // 3. Admin Audience
    if (audiences.includes('admin')) {
        const admins = await base44.asServiceRole.entities.User.filter({ role: 'admin' });
        for (const admin of admins) {
            await triggerNotification(base44, template, event, admin, null, null, results);
        }
    }
}

async function triggerNotification(base44, template, event, user, supplier, eventService, results) {
    // Replace variables
    let title = template.title_template || '';
    let message = template.body_template || '';
    let whatsapp_message = template.whatsapp_body_template || message;
    
    const variables = {
        event_name: event.event_name,
        event_date: event.event_date,
        event_time: event.event_time,
        event_location: event.location,
        family_name: event.family_name,
        supplier_name: supplier ? (supplier.contact_person || supplier.supplier_name) : '',
        service_name: eventService ? eventService.service_name : '',
        user_name: user ? user.full_name : '',
    };
    
    for (const [key, val] of Object.entries(variables)) {
        const regex = new RegExp(`{{${key}}}`, 'g');
        title = title.replace(regex, val || '');
        message = message.replace(regex, val || '');
        whatsapp_message = whatsapp_message.replace(regex, val || '');
    }
    
    // 1. Direct WhatsApp Send (Decoupled)
    let whatsappSent = false;
    let phoneToUse = null;

    if (supplier && supplier.phone && supplier.whatsapp_enabled !== false) {
        phoneToUse = supplier.phone;
    } else if (user && user.phone) {
        phoneToUse = user.phone;
    }

    if (phoneToUse && template.allowed_channels && template.allowed_channels.includes('whatsapp')) {
        try {
            await base44.asServiceRole.functions.invoke('sendWhatsAppMessage', {
                phone: phoneToUse,
                message: whatsapp_message,
                file_url: null
            });
            whatsappSent = true;
            console.log(`[AutomatedTriggers] DIRECT WhatsApp sent to ${phoneToUse}`);
        } catch (e) {
            console.error(`[AutomatedTriggers] Failed DIRECT WhatsApp to ${phoneToUse}`, e);
        }
    }

    // 2. Log to InAppNotification
    try {
        const targetUserId = user ? user.id : (supplier ? `virtual_supplier_${supplier.id}` : `virtual_event_${event.id}`);
        const targetUserEmail = user ? user.email : (supplier ? supplier.contact_emails?.[0] : '');

        await base44.asServiceRole.entities.InAppNotification.create({
            user_id: targetUserId,
            user_email: targetUserEmail,
            title: title,
            message: message,
            link: '', 
            template_type: template.type,
            related_event_id: event.id,
            related_supplier_id: supplier ? supplier.id : undefined,
            related_event_service_id: eventService ? eventService.id : undefined,
            whatsapp_sent: whatsappSent,
            push_sent: false, // We leave push to the legacy InApp logic or handle it separately if needed
            is_read: false,
            reminder_count: 0,
            is_resolved: false
        });
        results.notifications_created++;
        console.log(`[AutomatedTriggers] Log created for ${targetUserId}`);
    } catch (e) {
        console.error(`[AutomatedTriggers] Failed to create log for ${user?.id || supplier?.id}:`, e);
    }
}