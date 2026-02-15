import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Handle Entity Events (Create/Update) for Notification Triggers
 * Triggered by Entity Automation: Event/EventService (create/update)
 * Purpose: Check 'entity_create' and 'entity_update' notification templates and send alerts.
 * Supports 'changed' operator to detect specific field updates.
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const payload = await req.json();
        // Payload: { event: { type, entity_name, entity_id }, data: {...}, old_data: {...} }
        const { event, data, old_data } = payload;
        
        // Handle variations in payload keys (snake_case vs lowercase)
        const oldData = old_data || payload.olddata;

        if (!event || !data) return Response.json({ skipped: true, reason: 'Invalid payload' });

        // FIX: Handle both snake_case and lowercase variations from SDK
        const entityName = event.entity_name || event.entityname;
        const entityId = event.entity_id || event.entityid;
        
        if (!entityName) {
            console.error('[HandleEntityEvents] Entity name missing in event payload:', event);
            return Response.json({ skipped: true, reason: 'Missing entity name' });
        }

        const triggerType = event.type === 'create' ? 'entity_create' : 'entity_update';
        console.log(`[HandleEntityEvents] Processing ${entityName} ${triggerType}`);

        // 1. Fetch relevant templates
        let triggerTypesToFetch = [triggerType]; 

        // Helper for safe parsing
        const safeParse = (val) => {
            if (!val) return [];
            if (Array.isArray(val) || typeof val === 'object') return val;
            try { return JSON.parse(val); } catch (e) { return []; }
        };

        // Special logic for EventService Supplier Assignments
        if (entityName === 'EventService' && triggerType === 'entity_update') {
            const oldIds = safeParse(oldData?.supplier_ids || oldData?.supplierids);
            const newIds = safeParse(data.supplier_ids || data.supplierids);

            // Check if supplier added
            // Ensure IDs are strings for comparison
            const oldIdsStr = Array.isArray(oldIds) ? oldIds.map(String) : [];
            const newIdsStr = Array.isArray(newIds) ? newIds.map(String) : [];

            const added = newIdsStr.filter(id => !oldIdsStr.includes(id));
            if (added.length > 0) {
                triggerTypesToFetch.push('supplier_assignment_create');
                event.added_supplier_ids = added; 
                console.log(`[HandleEntityEvents] Detected supplier assignment creation. Added suppliers: ${added.join(', ')}`);
            }

            // Check if supplier removed
            const removed = oldIdsStr.filter(id => !newIdsStr.includes(id));
            if (removed.length > 0) {
                triggerTypesToFetch.push('supplier_assignment_delete');
                event.removed_supplier_ids = removed;
                console.log(`[HandleEntityEvents] Detected supplier assignment deletion. Removed suppliers: ${removed.join(', ')}`);
            }

            // Check if supplier status changed (Approved/Rejected/Signed)
            const oldStatuses = safeParse(oldData?.supplier_statuses || oldData?.supplierstatuses);
            const newStatuses = safeParse(data.supplier_statuses || data.supplierstatuses);
            
            event.changed_status_supplier_ids = [];

            if (newStatuses && typeof newStatuses === 'object') {
                for (const [supId, newStatus] of Object.entries(newStatuses)) {
                    if (oldStatuses[supId] !== newStatus) {
                        triggerTypesToFetch.push('assignment_status_change');
                        event.changed_status_supplier_ids.push({ id: supId, status: newStatus, old_status: oldStatuses[supId] });
                        console.log(`[HandleEntityEvents] Detected status change for supplier ${supId}: ${oldStatuses[supId]} -> ${newStatus}`);
                    }
                }
            }
        }
        
        // Special logic for Event Critical Updates
        if (entityName === 'Event' && triggerType === 'entity_update' && oldData) {
             const criticalFields = ['event_date', 'eventdate', 'event_time', 'eventtime', 'location', 'concept'];
             const changedFields = criticalFields.filter(field => {
                 const newVal = data[field];
                 const oldVal = oldData[field];
                 return newVal && oldVal && newVal !== oldVal;
             });
             
             if (changedFields.length > 0) {
                 triggerTypesToFetch.push('event_critical_update');
                 console.log(`[HandleEntityEvents] Detected critical event update. Fields: ${changedFields.join(', ')}`);
             }
        }

        // Enrich Data with Calculated Fields for Events
        let enrichedData = { ...data };
        if (entityName === 'Event') {
            try {
                // Fetch context
                const [payments, services] = await Promise.all([
                    base44.asServiceRole.entities.Payment.filter({ event_id: data.id }),
                    base44.asServiceRole.entities.EventService.filter({ event_id: data.id })
                ]);

                // Financials
                const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
                // Handle different casing/naming
                const totalPrice = data.total_override || data.totaloverride || data.all_inclusive_price || data.allinclusiveprice || data.total_price || data.totalprice || 0;
                const balance = totalPrice - totalPaid;
                const paymentPercentage = totalPrice > 0 ? (totalPaid / totalPrice) * 100 : 0;

                // Suppliers
                const assignedSupplierIds = new Set();
                services.forEach(s => {
                    const sIds = s.supplier_ids || s.supplierids;
                    if (sIds) {
                        const ids = safeParse(sIds);
                        if (Array.isArray(ids)) ids.forEach(id => assignedSupplierIds.add(id));
                    }
                });

                // Dates
                const eventDateStr = data.event_date || data.eventdate;
                const createdDateStr = data.created_date || data.createddate;
                
                if (eventDateStr) {
                    const eventDate = new Date(eventDateStr);
                    const now = new Date();
                    const daysUntil = Math.ceil((eventDate - now) / (1000 * 60 * 60 * 24));
                    const daysSinceCreated = createdDateStr ? Math.ceil((now - new Date(createdDateStr)) / (1000 * 60 * 60 * 24)) : 0;
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
                            const required = s.min_suppliers || s.minsuppliers || 0;
                            const sIds = s.supplier_ids || s.supplierids;
                            const ids = safeParse(sIds);
                            return (Array.isArray(ids) ? ids.length : 0) < required;
                        }),
                        days_until_event: daysUntil,
                        creation_date_age: daysSinceCreated,
                        event_month: month,
                        is_weekend: isWeekend
                    };
                }

            } catch (e) {
                console.error('[HandleEntityEvents] Error enriching event data', e);
            }
        }

        // Fetch all matching templates
        let templates = [];
        for (const type of triggerTypesToFetch) {
            // Support both trigger_type and triggertype keys in query
            // Base44 filters are exact match, so we should match the schema key 'trigger_type' and 'entity_name'
            const res = await base44.asServiceRole.entities.NotificationTemplate.filter({ 
                is_active: true, 
                trigger_type: type, 
                entity_name: entityName 
            });
            templates = [...templates, ...res];
        }
        
        console.log(`[HandleEntityEvents] Found ${templates.length} templates for ${entityName} (Types: ${triggerTypesToFetch.join(', ')})`);

        let notificationsSent = 0;

        for (const template of templates) {
            try {
                // Check Conditions
                const conditionsMet = await checkConditions(base44, template, enrichedData, oldData, event, triggerType);
                
                if (conditionsMet) {
                    // Smart Targeting Logic
                    
                    // Case 1 - New Supplier Assignment
                    if (template.trigger_type === 'supplier_assignment_create' && event.added_supplier_ids?.length > 0) {
                        for (const supId of event.added_supplier_ids) {
                            const specificEvent = { ...event, specific_recipient_id: supId };
                            await sendNotification(base44, template, enrichedData, specificEvent, entityName);
                            notificationsSent++;
                        }
                    }
                    // Case 2 - Supplier Removal
                    else if (template.trigger_type === 'supplier_assignment_delete' && event.removed_supplier_ids?.length > 0) {
                        for (const supId of event.removed_supplier_ids) {
                            const specificEvent = { ...event, specific_recipient_id: supId };
                            await sendNotification(base44, template, enrichedData, specificEvent, entityName);
                            notificationsSent++;
                        }
                    }
                    // Case 3 - Status Change
                    else if (template.trigger_type === 'assignment_status_change' && event.changed_status_supplier_ids?.length > 0) {
                        for (const changeContext of event.changed_status_supplier_ids) {
                            const specificEvent = { 
                                ...event, 
                                specific_recipient_id: changeContext.id,
                                ...changeContext 
                            };
                            await sendNotification(base44, template, enrichedData, specificEvent, entityName);
                            notificationsSent++;
                        }
                    } 
                    // Case 4 - Broadcast
                    else {
                        await sendNotification(base44, template, enrichedData, event, entityName);
                        notificationsSent++;
                    }
                }
            } catch (e) {
                console.error(`[HandleEntityEvents] Error processing template ${template.type}`, e);
            }
        }

        return Response.json({ success: true, notifications_sent: notificationsSent });

    } catch (error) {
        console.error('[HandleEntityEvents] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});


async function checkConditions(base44, template, data, oldData, event, triggerType) {
    const logic = template.condition_logic || template.conditionlogic || 'and';
    
    let allConditions = [];
    const condField = template.condition_field || template.conditionfield;
    const condVal = template.condition_value || template.conditionvalue;
    const condOp = template.condition_operator || template.conditionoperator;

    if (condField && condVal) {
        allConditions.push({ field: condField, operator: condOp || 'equals', value: condVal });
    }
    
    const eventFilter = template.event_filter_condition || template.eventfiltercondition;
    if (eventFilter) {
        try {
            const parsed = JSON.parse(eventFilter);
            if (Array.isArray(parsed)) {
                allConditions = [...allConditions, ...parsed];
            }
        } catch (e) {}
    }
    
    if (allConditions.length === 0) return true;

    // Evaluate
    for (const cond of allConditions) {
        let met = false;
        
        if (cond.operator === 'changed') {
            if (triggerType === 'entity_create') {
                met = true;
            } else if (triggerType === 'entity_update' && oldData) {
                const newVal = data[cond.field];
                const oldVal = oldData[cond.field];
                met = newVal != oldVal && JSON.stringify(newVal) !== JSON.stringify(oldVal);
            }
        } else {
            met = await checkSingleCondition(data, cond);
        }

        if (logic === 'and' && !met) return false;
        if (logic === 'or' && met) return true;
    }
    
    return logic === 'and' ? true : false;
}

async function checkSingleCondition(entityData, condition) {
    let val = entityData[condition.field];
    const reqVal = condition.value;
    const op = condition.operator || 'equals';

    switch (op) {
        case 'equals': return String(val) == String(reqVal);
        case 'not_equals': 
        case 'notequals': return String(val) != String(reqVal);
        case 'greater_than':
        case 'greaterthan': return parseFloat(val) > parseFloat(reqVal);
        case 'less_than':
        case 'lessthan': return parseFloat(val) < parseFloat(reqVal);
        case 'contains': return String(val).includes(reqVal);
        case 'is_empty':
        case 'isempty': return !val || (Array.isArray(val) && val.length === 0);
        case 'is_not_empty':
        case 'isnotempty': return !!val && !(Array.isArray(val) && val.length === 0);
        default: return false;
    }
}

async function sendNotification(base44, template, entityData, event, entityName) {
    let relatedEventId;
    let relatedSupplierId;
    let relatedServiceId;
    let eventObj = null;
    let supplierObj = null;
    let serviceObj = null;

    // Resolve IDs based on Entity Type
    if (entityName === 'Event') {
        relatedEventId = entityData.id;
        eventObj = entityData;
    } else if (entityName === 'EventService') {
        relatedEventId = entityData.event_id || entityData.eventid;
        relatedServiceId = entityData.id;
        serviceObj = entityData;
    } else if (entityName === 'Supplier') {
        relatedSupplierId = entityData.id;
        supplierObj = entityData;
    }

    // Fetch Missing Event
    if (!eventObj && relatedEventId) {
        const evs = await base44.asServiceRole.entities.Event.filter({ id: relatedEventId });
        eventObj = evs[0];
    }

    // Fetch Missing Service
    if (!serviceObj && relatedServiceId) {
        try { 
            const srvs = await base44.asServiceRole.entities.EventService.filter({ id: relatedServiceId });
            serviceObj = srvs[0];
        } catch(e){}
    }

    // Resolve Supplier from data if not main entity
    if (!relatedSupplierId && entityData.supplier_ids) {
        try { 
            const ids = typeof entityData.supplier_ids === 'string' ? JSON.parse(entityData.supplier_ids) : entityData.supplier_ids;
            if (Array.isArray(ids) && ids.length > 0) relatedSupplierId = ids[0];
        } catch(e){}
    }

    // Determine Channels
    const allowedChannels = template.allowed_channels || template.allowedchannels || ['push'];
    const sendPush = allowedChannels.includes('push');
    const sendWhatsApp = allowedChannels.includes('whatsapp');

    // Determine Audience
    const audiences = template.target_audiences || template.targetaudiences || [];

    // --- 1. Supplier Audience ---
    if (audiences.includes('supplier')) {
        let suppliersToSend = [];
        
        if (event.specific_recipient_id) {
            suppliersToSend.push(event.specific_recipient_id);
        } 
        else if (relatedSupplierId) {
            suppliersToSend.push(relatedSupplierId);
        } 
        else if (eventObj && entityName === 'Event') {
            // Broadcast to all suppliers of the event
            try {
                const services = await base44.asServiceRole.entities.EventService.filter({ event_id: eventObj.id });
                for (const s of services) {
                    let ids = [];
                    const sIds = s.supplier_ids || s.supplierids;
                    if (sIds) {
                        try { ids = typeof sIds === 'string' ? JSON.parse(sIds) : sIds; } catch(e){}
                        if (Array.isArray(ids)) suppliersToSend.push(...ids);
                    }
                }
            } catch(e) {}
        }
        
        suppliersToSend = [...new Set(suppliersToSend)];

        for (const supId of suppliersToSend) {
            let currentSupplierObj = (supplierObj && supplierObj.id === supId) ? supplierObj : null;
            if (!currentSupplierObj) {
                try { currentSupplierObj = await base44.asServiceRole.entities.Supplier.get(supId); } catch(e){}
            }
            if (!currentSupplierObj) continue;

            // Resolve Service Context for this supplier if missing
            let currentServiceObj = serviceObj;
            if (!currentServiceObj && eventObj) {
                 const services = await base44.asServiceRole.entities.EventService.filter({ event_id: eventObj.id });
                 currentServiceObj = services.find(s => {
                     const sIds = s.supplier_ids || s.supplierids;
                     if (!sIds) return false;
                     const ids = typeof sIds === 'string' ? JSON.parse(sIds) : sIds;
                     return Array.isArray(ids) && ids.includes(supId);
                 });
            }

            // WhatsApp
            if (sendWhatsApp) {
                if (currentSupplierObj.whatsapp_enabled !== false && currentSupplierObj.phone) {
                    await triggerWhatsApp(base44, template, currentSupplierObj.phone, eventObj, currentSupplierObj, currentServiceObj, null);
                } else {
                    console.log(`[HandleEntityEvents] WhatsApp skipped for supplier ${currentSupplierObj.supplier_name} (disabled or no phone)`);
                }
            }

            // Push
            if (sendPush) {
                const emails = currentSupplierObj.contact_emails || currentSupplierObj.contactemails;
                if (emails && Array.isArray(emails)) {
                    for (const email of emails) {
                        if (!email) continue;
                        const users = await base44.asServiceRole.entities.User.filter({ email: email });
                        for (const user of users) {
                            await triggerInApp(base44, template, user, eventObj, currentSupplierObj, currentServiceObj);
                        }
                    }
                }
            }
        }
    }

    // --- 2. Client Audience ---
    if (audiences.includes('client') && eventObj && eventObj.parents) {
        const parents = typeof eventObj.parents === 'string' ? JSON.parse(eventObj.parents) : eventObj.parents;
        if (Array.isArray(parents)) {
            for (const p of parents) {
                if (sendWhatsApp && p.phone) {
                     await triggerWhatsApp(base44, template, p.phone, eventObj, null, null, p);
                }
                if (sendPush && p.email) {
                    const users = await base44.asServiceRole.entities.User.filter({ email: p.email });
                    for (const user of users) {
                        await triggerInApp(base44, template, user, eventObj, null, null);
                    }
                }
            }
        }
    }

    // --- 3. Admin Audience ---
    if (audiences.includes('admin') || audiences.includes('system_creator')) {
        const admins = await base44.asServiceRole.entities.User.filter({ role: 'admin' });
        for (const admin of admins) {
            if (sendWhatsApp && admin.phone) {
                await triggerWhatsApp(base44, template, admin.phone, eventObj, supplierObj, serviceObj, admin);
            }
            if (sendPush) {
                await triggerInApp(base44, template, admin, eventObj, supplierObj, serviceObj);
            }
        }
    }
}

async function triggerWhatsApp(base44, template, phone, eventObj, supplierObj, serviceObj, userObj) {
    if (!phone) return;
    
    let message = template.whatsapp_body_template || template.body_template || template.body || '';
    message = replaceVariables(message, eventObj, supplierObj, serviceObj, userObj);
    
    // Dynamic Link Logic
    let fileUrl = null; // Support file in future if needed
    
    // Call Independent WhatsApp Function
    try {
        await base44.asServiceRole.functions.invoke('sendWhatsAppMessage', {
            phone: phone,
            message: message,
            file_url: fileUrl
        });
        console.log(`[HandleEntityEvents] WhatsApp sent to ${phone}`);
    } catch (e) {
        console.error(`[HandleEntityEvents] WhatsApp failed to ${phone}`, e);
    }
}

async function triggerInApp(base44, template, user, eventObj, supplierObj, serviceObj) {
    if (!user || !user.id) return;

    let title = template.title_template || template.title || '';
    let message = template.body_template || template.body || '';
    
    title = replaceVariables(title, eventObj, supplierObj, serviceObj, user);
    message = replaceVariables(message, eventObj, supplierObj, serviceObj, user);

    try {
         await base44.asServiceRole.functions.invoke('createNotification', {
            target_user_id: user.id,
            target_user_email: user.email,
            title, 
            message, 
            template_type: template.type,
            related_event_id: eventObj ? eventObj.id : undefined,
            related_supplier_id: supplierObj ? supplierObj.id : undefined,
            related_event_service_id: serviceObj ? serviceObj.id : undefined,
            send_push: true
        });
    } catch (e) {
        console.error('InApp Trigger failed', e);
    }
}

function replaceVariables(text, eventObj, supplierObj, serviceObj, userObj) {
    if (!text) return '';
    
    // Helper to safe access properties
    const getVal = (obj, keys) => {
        if (!obj) return '';
        for (const key of keys) {
            if (obj[key] !== undefined && obj[key] !== null) return obj[key];
        }
        return '';
    };

    const vars = {
        '{event_name}': getVal(eventObj, ['event_name', 'eventname']),
        '{eventname}': getVal(eventObj, ['event_name', 'eventname']),
        '{event_date}': getVal(eventObj, ['event_date', 'eventdate']),
        '{eventdate}': getVal(eventObj, ['event_date', 'eventdate']),
        '{event_time}': getVal(eventObj, ['event_time', 'eventtime']),
        '{eventtime}': getVal(eventObj, ['event_time', 'eventtime']),
        '{event_location}': getVal(eventObj, ['location']),
        '{eventlocation}': getVal(eventObj, ['location']),
        '{event_type}': getVal(eventObj, ['event_type', 'eventtype']),
        '{guest_count}': getVal(eventObj, ['guest_count', 'guestcount']),
        '{city}': getVal(eventObj, ['city']),
        '{family_name}': getVal(eventObj, ['family_name', 'familyname']),
        '{familyname}': getVal(eventObj, ['family_name', 'familyname']),
        '{child_name}': getVal(eventObj, ['child_name', 'childname']),
        '{event_id}': getVal(eventObj, ['id']),
        '{supplier_name}': getVal(supplierObj, ['supplier_name', 'suppliername']),
        '{suppliername}': getVal(supplierObj, ['supplier_name', 'suppliername']),
        '{supplier_phone}': getVal(supplierObj, ['phone']),
        '{service_name}': getVal(serviceObj, ['service_name', 'servicename']) || getVal(eventObj, ['service_name', 'serviceName']),
        '{servicename}': getVal(serviceObj, ['service_name', 'servicename']),
        '{total_price}': getVal(eventObj, ['total_price', 'totalprice', 'total_override', 'totaloverride', 'all_inclusive_price', 'allinclusiveprice']),
        '{balance}': getVal(eventObj, ['balance']),
        '{user_name}': getVal(userObj, ['full_name', 'fullname', 'name']),
        '{username}': getVal(userObj, ['full_name', 'fullname', 'name'])
    };

    // Client Name/Phone Logic
    if (eventObj && eventObj.parents) {
        const parents = typeof eventObj.parents === 'string' ? JSON.parse(eventObj.parents) : eventObj.parents;
        if (Array.isArray(parents) && parents.length > 0) {
            vars['{client_name}'] = parents[0].name;
            vars['{clientname}'] = parents[0].name;
            vars['{client_phone}'] = parents[0].phone;
        }
    }
    // Fallback to user obj if parents not found
    if (!vars['{client_name}']) vars['{client_name}'] = vars['{user_name}'];

    let result = text;
    for (const [k, v] of Object.entries(vars)) {
        // Replace all occurrences
        result = result.split(k).join(v || '');
    }
    return result;
}