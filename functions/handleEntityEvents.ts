import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Handle Entity Events (Create/Update) for Notification Triggers
 * 
 * Triggered by: Entity Automation (Event/EventService create/update)
 * Purpose: Check 'entity_create' and 'entity_update' notification templates and send alerts.
 * Supports: 'changed' operator to detect specific field updates.
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const payload = await req.json();
        
        // Payload: { event: { type, entity_name, entity_id }, data: {...}, old_data: {...} }
        const { event, data, old_data } = payload;
        
        if (!event || !data) {
            return Response.json({ skipped: true, reason: 'Invalid payload' });
        }
        
        const triggerType = event.type === 'create' ? 'entity_create' : 'entity_update';
        console.log(`[HandleEntityEvents] Processing ${event.entity_name} ${triggerType}`);
        
        // 1. Fetch relevant templates
        // We filter by trigger_type AND entity_name (if we added entity_name to template schema, which we did)
        // If entity_name is empty in template, it might be a general one (rare) or scheduled.
        // We only want templates for THIS entity type.
        
        // Determine extra trigger types based on logic (e.g., assignment create/delete)
        let triggerTypesToFetch = [triggerType]; // Default: entity_create or entity_update

        // Special logic for EventService (Supplier Assignments)
        if (event.entity_name === 'EventService' && triggerType === 'entity_update') {
            const oldIds = old_data?.supplier_ids ? JSON.parse(old_data.supplier_ids || '[]') : [];
            const newIds = data?.supplier_ids ? JSON.parse(data.supplier_ids || '[]') : [];

            // Check if supplier added
            const added = newIds.filter(id => !oldIds.includes(id));
            if (added.length > 0) {
                triggerTypesToFetch.push('supplier_assignment_create');
                console.log(`[HandleEntityEvents] Detected supplier assignment creation. Added suppliers: ${added.join(', ')}`);
            }

            // Check if supplier removed
            const removed = oldIds.filter(id => !newIds.includes(id));
            if (removed.length > 0) {
                triggerTypesToFetch.push('supplier_assignment_delete');
                console.log(`[HandleEntityEvents] Detected supplier assignment deletion. Removed suppliers: ${removed.join(', ')}`);
            }

            // Check if supplier status changed (Approved/Rejected/Signed)
            const oldStatuses = old_data?.supplier_statuses ? JSON.parse(old_data.supplier_statuses || '{}') : {};
            const newStatuses = data?.supplier_statuses ? JSON.parse(data.supplier_statuses || '{}') : {};
            
            // We need to identify WHICH supplier changed status to target notifications correctly
            // We'll store this in a special context field on the event object for the next steps
            event.changed_status_supplier_ids = [];
            
            for (const [supId, newStatus] of Object.entries(newStatuses)) {
                if (oldStatuses[supId] !== newStatus) {
                    triggerTypesToFetch.push('assignment_status_change');
                    event.changed_status_supplier_ids.push({ id: supId, status: newStatus, old_status: oldStatuses[supId] });
                    console.log(`[HandleEntityEvents] Detected status change for supplier ${supId}: ${oldStatuses[supId]} -> ${newStatus}`);
                }
            }
        }

        // Special logic for Event (Critical Updates)
        if (event.entity_name === 'Event' && triggerType === 'entity_update' && old_data) {
            const criticalFields = ['event_date', 'event_time', 'location', 'concept'];
            const changedFields = criticalFields.filter(field => data[field] !== old_data[field]);
            
            if (changedFields.length > 0) {
                triggerTypesToFetch.push('event_critical_update');
                console.log(`[HandleEntityEvents] Detected critical event update. Fields: ${changedFields.join(', ')}`);
            }
        }

        // Enrich Data with Calculated Fields (for Events)
        let enrichedData = { ...data };
        
        if (event.entity_name === 'Event') {
            try {
                // Fetch context
                const [payments, services] = await Promise.all([
                    base44.asServiceRole.entities.Payment.filter({ event_id: data.id }),
                    base44.asServiceRole.entities.EventService.filter({ event_id: data.id })
                ]);

                // Financials
                const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
                const totalPrice = data.total_override || data.all_inclusive_price || data.total_price || 0;
                const balance = totalPrice - totalPaid;
                const paymentPercentage = totalPrice > 0 ? (totalPaid / totalPrice) * 100 : 0;
                
                // Suppliers
                const assignedSupplierIds = new Set();
                services.forEach(s => {
                    if (s.supplier_ids) {
                        try {
                            const ids = typeof s.supplier_ids === 'string' ? JSON.parse(s.supplier_ids) : s.supplier_ids;
                            ids.forEach(id => assignedSupplierIds.add(id));
                        } catch (e) {}
                    }
                });
                
                // Dates
                const eventDate = new Date(data.event_date);
                const now = new Date();
                const daysUntil = Math.ceil((eventDate - now) / (1000 * 60 * 60 * 24));
                const daysSinceCreated = Math.ceil((now - new Date(data.created_date)) / (1000 * 60 * 60 * 24));
                const month = eventDate.getMonth() + 1;
                const dayOfWeek = eventDate.getDay(); // 0-6
                const isWeekend = dayOfWeek === 5 || dayOfWeek === 6; // Fri/Sat

                enrichedData = {
                    ...enrichedData,
                    total_paid: totalPaid,
                    balance: balance,
                    payment_percentage: paymentPercentage,
                    is_fully_paid: balance <= 0,
                    supplier_count: assignedSupplierIds.size,
                    has_missing_suppliers: services.some(s => {
                        const required = s.min_suppliers || 0;
                        let current = 0;
                        try {
                            const ids = typeof s.supplier_ids === 'string' ? JSON.parse(s.supplier_ids) : s.supplier_ids;
                            current = ids.length;
                        } catch (e) {}
                        return current < required;
                    }),
                    days_until_event: daysUntil,
                    creation_date_age: daysSinceCreated,
                    event_month: month,
                    is_weekend: isWeekend
                };
            } catch (e) {
                console.error('[HandleEntityEvents] Error enriching event data:', e);
            }
        }

        // Fetch all matching templates
        // We use $in operator if available, otherwise multiple queries
        // Assuming base44.entities.filter supports simple key-value, we might need multiple calls or a more complex query if SDK supports it.
        // For simplicity and reliability, let's fetch for each trigger type and combine.
        let templates = [];
        for (const type of triggerTypesToFetch) {
            const res = await base44.asServiceRole.entities.NotificationTemplate.filter({
                is_active: true,
                trigger_type: type,
                entity_name: event.entity_name
            });
            templates = [...templates, ...res];
        }
        
        console.log(`[HandleEntityEvents] Found ${templates.length} templates for ${event.entity_name} (Types: ${triggerTypesToFetch.join(', ')})`);
        
        let notificationsSent = 0;
        
        for (const template of templates) {
            try {
                // Check Conditions (pass enrichedData instead of raw data)
                const conditionsMet = await checkConditions(base44, template, enrichedData, old_data, event);
                
                if (conditionsMet) {
                    // Smart Targeting Logic
                    // If this is a specific supplier status change, ONLY send to that supplier (if audience is supplier)
                    // or regarding that supplier (if audience is admin)
                    
                    if (template.trigger_type === 'assignment_status_change' && event.changed_status_supplier_ids?.length > 0) {
                        // Iterate over each changed supplier and send context-specific notification
                        for (const changeContext of event.changed_status_supplier_ids) {
                            // Clone event to pass specific context
                            const specificEvent = { ...event, specific_recipient_id: changeContext.id };
                            await sendNotification(base44, template, enrichedData, specificEvent);
                            notificationsSent++;
                        }
                    } else {
                        // Standard broadcast (filtered by audience logic in sendNotification)
                        await sendNotification(base44, template, enrichedData, event);
                        notificationsSent++;
                    }
                }
            } catch (e) {
                console.error(`[HandleEntityEvents] Error processing template ${template.type}:`, e);
            }
        }
        
        return Response.json({ success: true, notifications_sent: notificationsSent });
        
    } catch (error) {
        console.error('[HandleEntityEvents] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});

async function checkConditions(base44, template, data, oldData, event) {
    // 1. Legacy & New Condition Logic (AND/OR)
    const logic = template.condition_logic || 'and';
    let result = logic === 'and' ? true : false;
    
    let allConditions = [];
    if (template.condition_field && template.condition_value) {
        allConditions.push({
            field: template.condition_field,
            operator: template.condition_operator || 'equals',
            value: template.condition_value
        });
    }
    if (template.event_filter_condition) {
        try {
            const parsed = JSON.parse(template.event_filter_condition);
            if (Array.isArray(parsed)) allConditions = [...allConditions, ...parsed];
        } catch (e) {}
    }
    
    if (allConditions.length === 0) return true; // No conditions = pass
    
    // Evaluate
    for (const cond of allConditions) {
        let met = false;
        
        // Handle 'changed' operator specially
        if (cond.operator === 'changed') {
            if (event.type === 'create') {
                met = true; // Everything "changed" from null to something on create
            } else if (event.type === 'update' && oldData) {
                const newVal = data[cond.field];
                const oldVal = oldData[cond.field];
                // Check if value actually changed (loose equality for strings/numbers)
                met = newVal != oldVal && JSON.stringify(newVal) !== JSON.stringify(oldVal);
            }
        } else {
            // Standard check against CURRENT data
            met = await checkSingleCondition(base44, data, cond);
        }
        
        if (logic === 'and') {
            if (!met) return false;
        } else {
            if (met) return true;
        }
    }
    
    return logic === 'and' ? true : false; // If AND loop finished, all passed. If OR loop finished, none passed.
}

async function checkSingleCondition(base44, entityData, condition) {
    let val = entityData[condition.field];
    const reqVal = condition.value;
    const op = condition.operator || 'equals';
    
    // Simple comparisons
    switch (op) {
        case 'equals': return String(val) == String(reqVal);
        case 'not_equals': return String(val) != String(reqVal);
        case 'greater_than': return parseFloat(val) > parseFloat(reqVal);
        case 'less_than': return parseFloat(val) < parseFloat(reqVal);
        case 'contains': return String(val || '').includes(reqVal);
        case 'is_empty': return !val || val === '' || (Array.isArray(val) && val.length === 0);
        case 'is_not_empty': return !!val && val !== '' && (!Array.isArray(val) || val.length > 0);
        default: return false;
    }
}

async function sendNotification(base44, template, entityData, event) {
    // Resolve Context (Event, Supplier, User) based on Entity Type
    let relatedEventId = '';
    let relatedSupplierId = '';
    let relatedServiceId = '';
    
    let eventObj = null;
    let supplierObj = null;
    
    if (event.entity_name === 'Event') {
        relatedEventId = entityData.id;
        eventObj = entityData;
    } else if (event.entity_name === 'EventService') {
        relatedEventId = entityData.event_id;
        relatedServiceId = entityData.id;
        // Fetch Event
        const evs = await base44.asServiceRole.entities.Event.filter({ id: relatedEventId });
        eventObj = evs[0];
        
        // Try to get supplier from list (first one) if exists
        if (entityData.supplier_ids) {
            let ids = [];
            try { ids = typeof entityData.supplier_ids === 'string' ? JSON.parse(entityData.supplier_ids) : entityData.supplier_ids; } catch(e){}
            if (ids.length > 0) relatedSupplierId = ids[0];
        }
    } else if (event.entity_name === 'Supplier') {
        relatedSupplierId = entityData.id;
        supplierObj = entityData;
    }
    
    // Determine Audience & Send
    const audiences = template.target_audiences || [];
    
    // 1. Supplier Audience
    if (audiences.includes('supplier')) {
        let suppliersToSend = [];
        
        // SMART TARGETING: If specific recipient defined in context (from handleEntityEvents loop), ONLY send to them.
        if (event.specific_recipient_id) {
            suppliersToSend.push(event.specific_recipient_id);
        } 
        // Otherwise use standard logic
        else if (relatedSupplierId) {
            suppliersToSend.push(relatedSupplierId);
        } else if (eventObj && event.entity_name === 'Event') {
            // Broadcast to all event suppliers (e.g. Critical Event Change)
            const services = await base44.asServiceRole.entities.EventService.filter({ event_id: eventObj.id });
            for (const s of services) {
                let ids = [];
                try { ids = typeof s.supplier_ids === 'string' ? JSON.parse(s.supplier_ids) : s.supplier_ids; } catch(e){}
                suppliersToSend.push(...ids);
            }
        }
        
        // Unique suppliers
        suppliersToSend = [...new Set(suppliersToSend)];
        
        for (const supId of suppliersToSend) {
            // Optimization: Don't refetch if we already have the object
            let currentSupplierObj = supplierObj && supplierObj.id === supId ? supplierObj : null;
            
            if (!currentSupplierObj) {
                const s = await base44.asServiceRole.entities.Supplier.filter({ id: supId });
                if (s.length > 0) currentSupplierObj = s[0];
            }
            
            if (!currentSupplierObj) continue;
            
            // Determine Service Object Context
            let serviceObj = null;
            if (relatedServiceId) {
                // If the event came from EventService, we know the service
                try { serviceObj = await base44.asServiceRole.entities.EventService.get(relatedServiceId); } catch(e){}
            } else if (event.entity_name === 'Event') {
                // If it's a broadcast from Event, we need to find which service this supplier belongs to in this event
                // This gives context like {{service_name}} to the message
                const services = await base44.asServiceRole.entities.EventService.filter({ event_id: eventObj.id });
                for (const s of services) {
                    if (s.supplier_ids && s.supplier_ids.includes(supId)) {
                        serviceObj = s;
                        break; // Assume 1 service per supplier per event for now
                    }
                }
            }

            // Find User(s) for Supplier OR Send to Unregistered via Phone
            let sentToUser = false;
            if (currentSupplierObj.contact_emails && Array.isArray(currentSupplierObj.contact_emails)) {
                for (const email of currentSupplierObj.contact_emails) {
                    if (!email) continue;
                    const users = await base44.asServiceRole.entities.User.filter({ email: email });
                    
                    if (users.length > 0) {
                        for (const user of users) {
                            await trigger(base44, template, user, eventObj, currentSupplierObj, serviceObj);
                            sentToUser = true;
                        }
                    }
                }
            }
            
            // If no registered user found, construct a "Virtual User" to trigger WhatsApp
            if (!sentToUser && currentSupplierObj.phone) {
                console.log(`[Notification] No registered user for supplier ${currentSupplierObj.supplier_name}. Sending to phone: ${currentSupplierObj.phone}`);
                const virtualUser = {
                    id: `virtual_sup_${currentSupplierObj.id}`,
                    email: currentSupplierObj.contact_emails?.[0] || '',
                    full_name: currentSupplierObj.contact_person || currentSupplierObj.supplier_name,
                    phone: currentSupplierObj.phone,
                    role: 'supplier',
                    // Default preferences for unregistered users
                    push_enabled: false,
                    whatsapp_enabled: true 
                };
                await trigger(base44, template, virtualUser, eventObj, currentSupplierObj, serviceObj);
            }
        }
    }
    
    // 2. Client Audience
    if (audiences.includes('client') && eventObj) {
        if (eventObj.parents && Array.isArray(eventObj.parents)) {
            for (const p of eventObj.parents) {
                if (p.email) {
                    const users = await base44.asServiceRole.entities.User.filter({ email: p.email });
                    for (const user of users) {
                        await trigger(base44, template, user, eventObj, null, null);
                    }
                }
            }
        }
    }
    
    // 3. Admin Audience
    if (audiences.includes('admin')) {
        const admins = await base44.asServiceRole.entities.User.filter({ role: 'admin' });
        for (const admin of admins) {
            await trigger(base44, template, admin, eventObj, supplierObj, null);
        }
    }
}

async function trigger(base44, template, user, eventObj, supplierObj, serviceObj) {
    // Variable Replacement
    let title = template.title_template;
    let message = template.body_template;
    let whatsapp_message = template.whatsapp_body_template || message;
    
    const vars = {
        event_name: eventObj ? eventObj.event_name : '',
        event_date: eventObj ? eventObj.event_date : '',
        event_time: eventObj ? eventObj.event_time : '',
        event_location: eventObj ? eventObj.location : '',
        event_type: eventObj ? eventObj.event_type : '',
        guest_count: eventObj ? eventObj.guest_count : '',
        city: eventObj ? eventObj.city : '',
        family_name: eventObj ? eventObj.family_name : '',
        child_name: eventObj ? eventObj.child_name : '',
        event_id: eventObj ? eventObj.id : '',
        
        // Client details (from parents array if available)
        client_name: eventObj && eventObj.parents && eventObj.parents[0] ? eventObj.parents[0].name : '',
        client_phone: eventObj && eventObj.parents && eventObj.parents[0] ? eventObj.parents[0].phone : '',
        client_email: eventObj && eventObj.parents && eventObj.parents[0] ? eventObj.parents[0].email : '',
        
        // Supplier details
        supplier_name: supplierObj ? supplierObj.supplier_name : '',
        supplier_phone: supplierObj ? supplierObj.phone : '',
        supplier_email: supplierObj && supplierObj.contact_emails ? supplierObj.contact_emails[0] : '',
        
        // Service details (if related to assignment)
        service_name: serviceObj ? serviceObj.service_name : (eventObj && eventObj.serviceName ? eventObj.serviceName : ''),
        
        // Assignment details
        assignment_status: serviceObj && supplierObj && serviceObj.supplier_statuses ? JSON.parse(serviceObj.supplier_statuses)[supplierObj.id] : '',
        
        // Financials
        total_price: eventObj ? (eventObj.total_price || eventObj.all_inclusive_price) : '',
        discount_amount: eventObj ? eventObj.discount_amount : '',
        balance: eventObj && eventObj.balance !== undefined ? eventObj.balance : '', // Use enriched balance if available
        total_paid: eventObj && eventObj.total_paid !== undefined ? eventObj.total_paid : '',
        
        // User & System
        user_name: user.full_name,
        admin_name: 'מנהל המערכת' 
    };
    
    for (const [k, v] of Object.entries(vars)) {
        const regex = new RegExp(`{{${k}}}`, 'g');
        title = title.replace(regex, v || '');
        message = message.replace(regex, v || '');
        whatsapp_message = whatsapp_message.replace(regex, v || '');
    }
    
    try {
        // Base URL for links (Assuming hardcoded app URL or similar)
        // Since we are in backend automation, we don't have window.location
        const baseUrl = 'https://app.base44.com/preview'; // TODO: Update with real domain
        
        await base44.asServiceRole.functions.invoke('createNotification', {
            target_user_id: user.id,
            target_user_email: user.email,
            title,
            message,
            whatsapp_message,
            template_type: template.type,
            related_event_id: eventObj ? eventObj.id : undefined,
            related_supplier_id: supplierObj ? supplierObj.id : undefined,
            base_url: baseUrl,
            // Let createNotification handle channels based on template
        });
        console.log(`[HandleEntityEvents] Triggered for ${user.email}`);
    } catch (e) {
        console.error('Trigger failed', e);
    }
}