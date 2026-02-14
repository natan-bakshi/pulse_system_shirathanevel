import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Handle Entity Events (Create/Update) for Notification Triggers
 * Triggered by Entity Automation: Event/EventService (create/update)
 * Purpose: Check 'entitycreate' and 'entityupdate' notification templates and send alerts.
 * Supports 'changed' operator to detect specific field updates.
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const payload = await req.json();
        // Payload: { event: { type, entityname, entityid }, data: {...}, olddata: {...} }
        const { event, data, olddata } = payload;

        if (!event || !data) return Response.json({ skipped: true, reason: 'Invalid payload' });

        const triggerType = event.type === 'create' ? 'entity_create' : 'entity_update';
        console.log(`[HandleEntityEvents] Processing ${event.entityname} ${triggerType}`);

        // 1. Fetch relevant templates
        // We filter by triggertype AND entityname (if we added entityname to template schema, which we did)
        // If entityname is empty in template, it might be a general one (rare) or scheduled. We only want templates for THIS entity type.

        // Determine extra trigger types based on logic (e.g., assignment create/delete)
        let triggerTypesToFetch = [triggerType]; // Default 'entitycreate' or 'entityupdate'

        // Special logic for EventService Supplier Assignments
        if (event.entityname === 'EventService' && triggerType === 'entityupdate') {
            const oldIds = olddata?.supplierids ? JSON.parse(olddata.supplierids) : [];
            const newIds = data?.supplierids ? JSON.parse(data.supplierids) : [];

            // Check if supplier added
            const added = newIds.filter(id => !oldIds.includes(id));
            if (added.length > 0) {
                triggerTypesToFetch.push('supplier_assignment_create');
                // FIX: Store specifically WHO was added so we don't broadcast to everyone later
                event.addedsupplierids = added; 
                console.log(`[HandleEntityEvents] Detected supplier assignment creation. Added suppliers: ${added.join(', ')}`);
            }

            // Check if supplier removed
            const removed = oldIds.filter(id => !newIds.includes(id));
            if (removed.length > 0) {
                triggerTypesToFetch.push('supplier_assignment_delete');
                // FIX: Store specifically WHO was removed
                event.removedsupplierids = removed;
                console.log(`[HandleEntityEvents] Detected supplier assignment deletion. Removed suppliers: ${removed.join(', ')}`);
            }

            // Check if supplier status changed (Approved/Rejected/Signed)
            const oldStatuses = olddata?.supplierstatuses ? JSON.parse(olddata.supplierstatuses) : {};
            const newStatuses = data?.supplierstatuses ? JSON.parse(data.supplierstatuses) : {};
            
            // We need to identify WHICH supplier changed status to target notifications correctly
            // We'll store this in a special context field on the event object for the next steps
            event.changedstatussupplierids = [];

            for (const [supId, newStatus] of Object.entries(newStatuses)) {
                if (oldStatuses[supId] !== newStatus) {
                    triggerTypesToFetch.push('assignment_status_change');
                    event.changedstatussupplierids.push({ id: supId, status: newStatus, oldstatus: oldStatuses[supId] });
                    console.log(`[HandleEntityEvents] Detected status change for supplier ${supId}: ${oldStatuses[supId]} -> ${newStatus}`);
                }
            }
        }
        
        // Special logic for Event Critical Updates
        if (event.entityname === 'Event' && triggerType === 'entityupdate' && olddata) {
             const criticalFields = ['eventdate', 'eventtime', 'location', 'concept'];
             const changedFields = criticalFields.filter(field => data[field] !== olddata[field]);
             if (changedFields.length > 0) {
                 triggerTypesToFetch.push('event_critical_update');
                 console.log(`[HandleEntityEvents] Detected critical event update. Fields: ${changedFields.join(', ')}`);
             }
        }

        // Enrich Data with Calculated Fields for Events
        let enrichedData = { ...data };
        if (event.entityname === 'Event') {
            try {
                // Fetch context
                const [payments, services] = await Promise.all([
                    base44.asServiceRole.entities.Payment.filter({ eventid: data.id }),
                    base44.asServiceRole.entities.EventService.filter({ eventid: data.id })
                ]);

                // Financials
                const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
                const totalPrice = data.totaloverride || data.allinclusiveprice || data.totalprice || 0;
                const balance = totalPrice - totalPaid;
                const paymentPercentage = totalPrice > 0 ? (totalPaid / totalPrice) * 100 : 0;

                // Suppliers
                const assignedSupplierIds = new Set();
                services.forEach(s => {
                    if (s.supplierids) {
                        try {
                            const ids = typeof s.supplierids === 'string' ? JSON.parse(s.supplierids) : s.supplierids;
                            ids.forEach(id => assignedSupplierIds.add(id));
                        } catch (e) {}
                    }
                });

                // Dates
                const eventDate = new Date(data.eventdate);
                const now = new Date();
                const daysUntil = Math.ceil((eventDate - now) / (1000 * 60 * 60 * 24));
                const daysSinceCreated = Math.ceil((now - new Date(data.createddate)) / (1000 * 60 * 60 * 24));
                const month = eventDate.getMonth() + 1;
                const dayOfWeek = eventDate.getDay(); // 0-6
                const isWeekend = dayOfWeek === 5 || dayOfWeek === 6; // Fri/Sat

                enrichedData = {
                    ...enrichedData,
                    totalpaid: totalPaid,
                    balance: balance,
                    paymentpercentage: paymentPercentage,
                    isfullypaid: balance <= 0,
                    suppliercount: assignedSupplierIds.size,
                    hasmissingsuppliers: services.some(s => {
                        const required = s.minsuppliers || 0;
                        let current = 0;
                        try {
                             const ids = typeof s.supplierids === 'string' ? JSON.parse(s.supplierids) : s.supplierids;
                             current = ids.length;
                        } catch (e) {}
                        return current < required;
                    }),
                    daysuntilevent: daysUntil,
                    creationdateage: daysSinceCreated,
                    eventmonth: month,
                    isweekend: isWeekend
                };

            } catch (e) {
                console.error('HandleEntityEvents Error enriching event data', e);
            }
        }

        // Fetch all matching templates
        // We use 'in' operator if available, otherwise multiple queries. 
        // Assuming base44.entities.filter supports simple key-value, we might need multiple calls or a more complex query if SDK supports it.
        // For simplicity and reliability, let's fetch for each trigger type and combine.
        let templates = [];
        for (const type of triggerTypesToFetch) {
            const res = await base44.asServiceRole.entities.NotificationTemplate.filter({ 
                isactive: true, 
                triggertype: type, 
                entityname: event.entityname 
            });
            templates = [...templates, ...res];
        }
        
        console.log(`[HandleEntityEvents] Found ${templates.length} templates for ${event.entityname} (Types: ${triggerTypesToFetch.join(', ')})`);

        let notificationsSent = 0;

        for (const template of templates) {
            try {
                // Check Conditions (pass enrichedData instead of raw data)
                const conditionsMet = await checkConditions(base44, template, enrichedData, olddata, event);
                
                if (conditionsMet) {
                    // Smart Targeting Logic
                    
                    // FIX: Case 1 - New Supplier Assignment (Only send to the NEW supplier)
                    if (template.triggertype === 'supplier_assignment_create' && event.addedsupplierids?.length > 0) {
                        for (const supId of event.addedsupplierids) {
                            // Clone event to pass specific context
                            const specificEvent = { ...event, specificrecipientid: supId };
                            await sendNotification(base44, template, enrichedData, specificEvent);
                            notificationsSent++;
                        }
                    }
                    // FIX: Case 2 - Supplier Removal (Only send to the REMOVED supplier)
                    else if (template.triggertype === 'supplier_assignment_delete' && event.removedsupplierids?.length > 0) {
                        for (const supId of event.removedsupplierids) {
                            const specificEvent = { ...event, specificrecipientid: supId };
                            await sendNotification(base44, template, enrichedData, specificEvent);
                            notificationsSent++;
                        }
                    }
                    // Case 3 - Status Change (Only send to the changed supplier)
                    else if (template.triggertype === 'assignment_status_change' && event.changedstatussupplierids?.length > 0) {
                        // Iterate over each changed supplier and send context-specific notification
                        for (const changeContext of event.changedstatussupplierids) {
                            // Clone event to pass specific context
                            const specificEvent = { 
                                ...event, 
                                specificrecipientid: changeContext.id,
                                ...changeContext // Pass status details
                            };
                            await sendNotification(base44, template, enrichedData, specificEvent);
                            notificationsSent++;
                        }
                    } 
                    // Case 4 - Broadcast (Standard behavior)
                    else {
                        // Standard broadcast filtered by audience logic in sendNotification
                        await sendNotification(base44, template, enrichedData, event);
                        notificationsSent++;
                    }
                }
            } catch (e) {
                console.error(`HandleEntityEvents Error processing template ${template.type}`, e);
            }
        }

        return Response.json({ success: true, notificationssent: notificationsSent });

    } catch (error) {
        console.error('[HandleEntityEvents] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});


async function checkConditions(base44, template, data, oldData, event) {
    // 1. Legacy/New Condition Logic (AND/OR)
    const logic = template.conditionlogic || 'and';
    let result = logic === 'and' ? true : false;
    
    let allConditions = [];
    if (template.conditionfield && template.conditionvalue) {
        allConditions.push({ field: template.conditionfield, operator: template.conditionoperator || 'equals', value: template.conditionvalue });
    }
    
    if (template.eventfiltercondition) {
        try {
            const parsed = JSON.parse(template.eventfiltercondition);
            if (Array.isArray(parsed)) {
                allConditions = [...allConditions, ...parsed];
            }
        } catch (e) {}
    }
    
    if (allConditions.length === 0) return true; // No conditions = pass

    // Evaluate
    for (const cond of allConditions) {
        let met = false;
        
        // Handle 'changed' operator specially
        if (cond.operator === 'changed') {
            if (event.type === 'create') {
                met = true; // Everything changed from null to something on create
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
        } else { // or
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
        case 'notequals': return String(val) != String(reqVal);
        case 'greaterthan': return parseFloat(val) > parseFloat(reqVal);
        case 'lessthan': return parseFloat(val) < parseFloat(reqVal);
        case 'contains': return String(val).includes(reqVal);
        case 'isempty': return !val || (Array.isArray(val) && val.length === 0);
        case 'isnotempty': return !!val && !(Array.isArray(val) && val.length === 0);
        default: return false;
    }
}

async function sendNotification(base44, template, entityData, event) {
    // Resolve Context (Event, Supplier, User) based on Entity Type
    let relatedEventId;
    let relatedSupplierId;
    let relatedServiceId;
    let eventObj = null;
    let supplierObj = null;

    if (event.entityname === 'Event') {
        relatedEventId = entityData.id;
        eventObj = entityData;
    } else if (event.entityname === 'EventService') {
        relatedEventId = entityData.eventid;
        relatedServiceId = entityData.id;
    } else if (event.entityname === 'Supplier') {
        relatedSupplierId = entityData.id;
        supplierObj = entityData;
    }

    // Fetch Event
    if (!eventObj && relatedEventId) {
        const evs = await base44.asServiceRole.entities.Event.filter({ id: relatedEventId });
        eventObj = evs[0];
    }

    // Try to get supplier from list (first one if exists)
    if (entityData.supplierids && !relatedSupplierId) {
        let ids = [];
        try { ids = typeof entityData.supplierids === 'string' ? JSON.parse(entityData.supplierids) : entityData.supplierids; } catch(e){}
        if (ids.length > 0) relatedSupplierId = ids[0];
    }

    // Determine Channels from Template
    const allowedChannels = template.allowed_channels || ['push'];
    const sendPush = allowedChannels.includes('push');
    const sendWhatsApp = allowedChannels.includes('whatsapp');

    // Determine Audience
    const audiences = template.targetaudiences || [];

    // --- 1. Supplier Audience ---
    if (audiences.includes('supplier')) {
        let suppliersToSend = [];
        
        // Smart Targeting: Specific recipient takes precedence
        if (event.specificrecipientid) {
            suppliersToSend.push(event.specificrecipientid);
        } 
        else if (relatedSupplierId) {
            suppliersToSend.push(relatedSupplierId);
        } 
        else if (eventObj && event.entityname === 'Event') {
            // Broadcast
            const services = await base44.asServiceRole.entities.EventService.filter({ eventid: eventObj.id });
            for (const s of services) {
                let ids = [];
                try { ids = typeof s.supplierids === 'string' ? JSON.parse(s.supplierids) : s.supplierids; } catch(e){}
                suppliersToSend.push(...ids);
            }
        }
        
        suppliersToSend = [...new Set(suppliersToSend)];

        for (const supId of suppliersToSend) {
            // Get Supplier Entity
            let currentSupplierObj = (supplierObj && supplierObj.id === supId) ? supplierObj : null;
            if (!currentSupplierObj) {
                try { currentSupplierObj = await base44.asServiceRole.entities.Supplier.get(supId); } catch(e){}
            }
            if (!currentSupplierObj) continue;

            // Resolve Service Context
            let serviceObj = null;
            if (relatedServiceId) {
                try { serviceObj = await base44.asServiceRole.entities.EventService.get(relatedServiceId); } catch(e){}
            } else if (eventObj) {
                 const services = await base44.asServiceRole.entities.EventService.filter({ eventid: eventObj.id });
                 serviceObj = services.find(s => s.supplierids && s.supplierids.includes(supId));
            }

            // --- A. WhatsApp (Direct to Entity Phone) ---
            if (sendWhatsApp && currentSupplierObj.phone) {
                await triggerWhatsApp(base44, template, currentSupplierObj.phone, eventObj, currentSupplierObj, serviceObj, null);
            }

            // --- B. Push/InApp (To User) ---
            if (sendPush && currentSupplierObj.contactemails && currentSupplierObj.contactemails.length > 0) {
                for (const email of currentSupplierObj.contactemails) {
                    if (!email) continue;
                    const users = await base44.asServiceRole.entities.User.filter({ email: email });
                    for (const user of users) {
                        await triggerInApp(base44, template, user, eventObj, currentSupplierObj, serviceObj);
                    }
                }
            }
        }
    }

    // --- 2. Client Audience ---
    if (audiences.includes('client') && eventObj && eventObj.parents) {
        for (const p of eventObj.parents) {
            // --- A. WhatsApp (Direct to Entity Phone) ---
            if (sendWhatsApp && p.phone) {
                 await triggerWhatsApp(base44, template, p.phone, eventObj, null, null, p); // Pass p as user context for names
            }

            // --- B. Push/InApp (To User) ---
            if (sendPush && p.email) {
                const users = await base44.asServiceRole.entities.User.filter({ email: p.email });
                for (const user of users) {
                    await triggerInApp(base44, template, user, eventObj, null, null);
                }
            }
        }
    }

    // --- 3. Admin Audience ---
    if (audiences.includes('admin')) {
        const admins = await base44.asServiceRole.entities.User.filter({ role: 'admin' });
        for (const admin of admins) {
            // --- A. WhatsApp (To User Phone for Admins) ---
            if (sendWhatsApp && admin.phone) {
                await triggerWhatsApp(base44, template, admin.phone, eventObj, supplierObj, null, admin);
            }
             // --- B. Push/InApp (To User) ---
            if (sendPush) {
                await triggerInApp(base44, template, admin, eventObj, supplierObj, null);
            }
        }
    }
}

async function triggerWhatsApp(base44, template, phone, eventObj, supplierObj, serviceObj, userObj) {
    if (!phone) return;
    
    // Replace Variables for WhatsApp
    let message = template.whatsapp_body_template || template.body_template || template.body || '';
    message = replaceVariables(message, eventObj, supplierObj, serviceObj, userObj);
    
    // Dynamic Link
    let link = '';
    const baseUrl = 'https://pulse-system.base44.app';
    if (template.dynamic_url_type && template.dynamic_url_type !== 'none') {
        const context = {
            event_id: eventObj?.id,
            supplier_id: supplierObj?.id,
            user_role: 'supplier' // Default context for link generation
        };
        // Simple link gen logic (duplicated from createNotification briefly for independence)
        switch (template.dynamic_url_type) {
            case 'event_page': link = `${baseUrl}/EventDetails?id=${context.event_id}`; break;
            case 'payment_page': link = `${baseUrl}/EventDetails?id=${context.event_id}&tab=payments`; break;
            case 'assignment_page': link = `${baseUrl}/SupplierDashboard`; break;
            case 'calendar_page': link = `${baseUrl}/EventManagement?tab=board`; break;
        }
    }

    // Call Independent WhatsApp Function
    try {
        await base44.asServiceRole.functions.invoke('sendWhatsAppMessage', {
            phone: phone,
            message: message,
            file_url: null // Support files in future if needed
        });
        console.log(`[HandleEntityEvents] WhatsApp sent to ${phone}`);
    } catch (e) {
        console.error(`[HandleEntityEvents] WhatsApp failed to ${phone}`, e);
    }
}

async function triggerInApp(base44, template, user, eventObj, supplierObj, serviceObj) {
    if (!user || !user.id) return;

    // Replace Variables for Push/InApp
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
        console.log(`[HandleEntityEvents] InApp/Push triggered for ${user.email}`);
    } catch (e) {
        console.error('InApp Trigger failed', e);
    }
}

function replaceVariables(text, eventObj, supplierObj, serviceObj, userObj) {
    if (!text) return '';
    
    const vars = {
        '{eventname}': eventObj ? eventObj.eventname : '',
        '{eventdate}': eventObj ? eventObj.eventdate : '',
        '{eventtime}': eventObj ? eventObj.eventtime : '',
        '{eventlocation}': eventObj ? eventObj.location : '',
        '{eventtype}': eventObj ? eventObj.eventtype : '',
        '{guestcount}': eventObj ? eventObj.guestcount : '',
        '{city}': eventObj ? eventObj.city : '',
        '{familyname}': eventObj ? eventObj.familyname : '',
        '{childname}': eventObj ? eventObj.childname : '',
        '{eventid}': eventObj ? eventObj.id : '',
        '{clientname}': eventObj && eventObj.parents && eventObj.parents[0] ? eventObj.parents[0].name : (userObj?.fullname || ''),
        '{clientphone}': eventObj && eventObj.parents && eventObj.parents[0] ? eventObj.parents[0].phone : (userObj?.phone || ''),
        '{suppliername}': supplierObj ? supplierObj.suppliername : '',
        '{supplierphone}': supplierObj ? supplierObj.phone : '',
        '{servicename}': serviceObj ? serviceObj.servicename : (eventObj && eventObj.serviceName ? eventObj.serviceName : ''),
        '{totalprice}': eventObj ? (eventObj.totalprice || eventObj.allinclusiveprice) : '',
        '{balance}': eventObj && eventObj.balance !== undefined ? eventObj.balance : '',
        '{username}': userObj ? (userObj.fullname || userObj.name) : ''
    };

    let result = text;
    for (const [k, v] of Object.entries(vars)) {
        const regex = new RegExp(k, 'g');
        result = result.replace(regex, v || '');
    }
    return result;
}