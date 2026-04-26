import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Manual Trigger for Notification Templates
 * Allows admins to force-send a notification for a specific event/entity immediately.
 *
 * Uses the SAME recipient/condition/content logic as the automated/scheduled triggers
 * (mirrors handleEntityEvents.sendNotification) to guarantee identical behavior:
 * - Same target audiences (suppliers / clients / admins) per template config
 * - Same template conditions (e.g. supplier status filters)
 * - Same content (title/body/whatsapp_body)
 * - Same channels (push / whatsapp)
 *
 * Bypasses: timing/scheduled checks, Shabbat block (admin manually pressed send).
 * Honors: quiet hours (queues WhatsApp), template conditions, allowed channels.
 *
 * NOTE: Local imports between functions are not supported in Base44, so the
 * shared helpers below are intentionally duplicated from handleEntityEvents.js.
 * Keep them in sync if you change one of them.
 */
Deno.serve(async (req) => {
    const logs = [];
    const log = (msg) => {
        console.log(msg);
        logs.push(msg);
    };

    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user || user.role !== 'admin') {
            return Response.json({ error: 'Unauthorized', logs }, { status: 403 });
        }

        const payload = await req.json();
        const { template_id, event_id } = payload;

        if (!template_id || !event_id) {
            return Response.json({ error: 'Missing template_id or event_id', logs }, { status: 400 });
        }

        log(`[ManualTrigger] Triggering template ${template_id} for event ${event_id}`);

        // 1. Fetch Template & Event
        const template = await base44.asServiceRole.entities.NotificationTemplate.get(template_id);
        const event = await base44.asServiceRole.entities.Event.get(event_id);

        if (!template || !event) {
            return Response.json({ error: 'Template or Event not found', logs }, { status: 404 });
        }

        // 2. Enrich event data (mirrors handleEntityEvents enrichment)
        let enrichedData = { ...event };
        try {
            const [payments, services] = await Promise.all([
                base44.asServiceRole.entities.Payment.filter({ event_id: event.id }),
                base44.asServiceRole.entities.EventService.filter({ event_id: event.id })
            ]);

            const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
            const totalPrice = event.total_override || event.all_inclusive_price || event.total_price || 0;
            const balance = totalPrice - totalPaid;
            const paymentPercentage = totalPrice > 0 ? (totalPaid / totalPrice) * 100 : 0;

            const assignedSupplierIds = new Set();
            services.forEach(s => {
                const sIds = s.supplier_ids;
                if (sIds) {
                    try {
                        const ids = typeof sIds === 'string' ? JSON.parse(sIds) : sIds;
                        if (Array.isArray(ids)) ids.forEach(id => assignedSupplierIds.add(id));
                    } catch (e) {}
                }
            });

            if (event.event_date) {
                const eventDate = new Date(event.event_date);
                const now = new Date();
                const daysUntil = Math.ceil((eventDate - now) / (1000 * 60 * 60 * 24));
                const daysSinceCreated = event.created_date
                    ? Math.ceil((now - new Date(event.created_date)) / (1000 * 60 * 60 * 24))
                    : 0;
                const month = eventDate.getMonth() + 1;
                const dayOfWeek = eventDate.getDay();
                const isWeekend = dayOfWeek === 5 || dayOfWeek === 6;

                enrichedData = {
                    ...enrichedData,
                    total_paid: totalPaid,
                    balance: balance,
                    payment_percentage: paymentPercentage,
                    is_fully_paid: balance <= 0,
                    supplier_count: assignedSupplierIds.size,
                    days_until_event: daysUntil,
                    creation_date_age: daysSinceCreated,
                    event_month: month,
                    is_weekend: isWeekend
                };
            }
        } catch (e) {
            log(`[ManualTrigger] Error enriching event data: ${e.message}`);
        }

        // 3. Synthetic event object (same shape sendNotification expects)
        const syntheticEvent = {
            type: 'manual',
            entity_name: 'Event',
            entity_id: event.id
        };

        const audiences = template.target_audiences || template.targetaudiences || [];
        const allowedChannels = template.allowed_channels || template.allowedchannels || ['push'];
        const sendPush = allowedChannels.includes('push');
        const sendWhatsApp = allowedChannels.includes('whatsapp');

        let suppliersNotified = 0;
        let clientsNotified = 0;
        let adminsNotified = 0;
        let suppliersChecked = 0;
        let suppliersSkipped = 0;

        // 4. Supplier audience: iterate over every EventService + supplier in the event
        // and evaluate template conditions per (event + service + supplier) context.
        // This makes the manual trigger behave like an automatic trigger that fires
        // for each relevant assignment, but without any time gating.
        if (audiences.includes('supplier')) {
            let services = [];
            try {
                services = await base44.asServiceRole.entities.EventService.filter({ event_id: event.id });
            } catch (e) {
                log(`[ManualTrigger] Error loading services: ${e.message}`);
            }

            for (const serviceObj of services) {
                // Parse supplier ids
                let supplierIds = [];
                const sIds = serviceObj.supplier_ids || serviceObj.supplierids;
                if (sIds) {
                    try { supplierIds = typeof sIds === 'string' ? JSON.parse(sIds) : sIds; } catch (e) {}
                }
                if (!Array.isArray(supplierIds) || supplierIds.length === 0) continue;

                // Parse supplier statuses (object: { supplierId: status })
                let supplierStatuses = {};
                const stRaw = serviceObj.supplier_statuses || serviceObj.supplierstatuses;
                if (stRaw) {
                    try {
                        const parsed = typeof stRaw === 'string' ? JSON.parse(stRaw) : stRaw;
                        if (parsed && typeof parsed === 'object') supplierStatuses = parsed;
                    } catch (e) {}
                }

                for (const supId of supplierIds) {
                    suppliersChecked++;
                    let currentSupplierObj = null;
                    try { currentSupplierObj = await base44.asServiceRole.entities.Supplier.get(supId); } catch (e) {}
                    if (!currentSupplierObj) {
                        suppliersSkipped++;
                        continue;
                    }

                    // Build enriched context that exposes event, service and supplier-level fields
                    // to the condition evaluator (top-level keys only, mirroring entity fields).
                    const supplierStatus = supplierStatuses[supId] || '';
                    const enrichedContext = {
                        ...enrichedData,                  // event-level fields (incl. computed)
                        ...serviceObj,                    // event-service fields (overrides where keys collide)
                        id: enrichedData.id,              // keep event id as primary id for {{event_id}} resolution
                        event_id: enrichedData.id,
                        event_service_id: serviceObj.id,
                        supplier_id: supId,
                        supplier_status: supplierStatus,
                        current_supplier_status: supplierStatus,
                        // Surface the most relevant supplier fields without overriding event-level ones
                        supplier_name: currentSupplierObj.supplier_name || currentSupplierObj.contact_person || '',
                        supplier_phone: currentSupplierObj.phone || '',
                        supplier_whatsapp_enabled: currentSupplierObj.whatsapp_enabled !== false
                    };

                    const conditionsMet = await checkConditions(template, enrichedContext, null, 'manual');
                    if (!conditionsMet) {
                        suppliersSkipped++;
                        continue;
                    }

                    // Send WhatsApp
                    if (sendWhatsApp) {
                        const isEnabled = currentSupplierObj.whatsapp_enabled !== false;
                        if (isEnabled && currentSupplierObj.phone) {
                            await triggerWhatsApp(base44, template, currentSupplierObj.phone, enrichedData, currentSupplierObj, serviceObj, null);
                        }
                    }

                    // Send Push / In-App
                    if (sendPush) {
                        const emails = currentSupplierObj.contact_emails || currentSupplierObj.contactemails;
                        if (emails && Array.isArray(emails)) {
                            for (const email of emails) {
                                if (!email) continue;
                                const users = await base44.asServiceRole.entities.User.filter({ email });
                                for (const u of users) {
                                    await triggerInApp(base44, template, u, enrichedData, currentSupplierObj, serviceObj);
                                }
                            }
                        }
                    }

                    suppliersNotified++;
                }
            }

            log(`[ManualTrigger] Supplier scan: checked=${suppliersChecked}, notified=${suppliersNotified}, skipped=${suppliersSkipped}`);
        }

        // 5. Client / Admin audiences: handle once at the event level (no per-supplier iteration).
        const nonSupplierAudiences = audiences.filter(a => a !== 'supplier');
        if (nonSupplierAudiences.length > 0) {
            // Evaluate conditions at the event level for non-supplier audiences
            const conditionsMet = await checkConditions(template, enrichedData, null, 'manual');
            if (conditionsMet) {
                // Build a template-like clone with only the non-supplier audiences so
                // sendNotification won't re-send to suppliers (which we already handled above).
                const templateForOthers = { ...template, target_audiences: nonSupplierAudiences };
                const result = await sendNotification(base44, templateForOthers, enrichedData, syntheticEvent, 'Event', log);
                clientsNotified = result.clients_notified || 0;
                adminsNotified = result.admins_notified || 0;
            } else {
                log(`[ManualTrigger] Event-level conditions not met for non-supplier audiences`);
            }
        }

        return Response.json({
            success: true,
            results: {
                conditions_met: true,
                suppliers_checked: suppliersChecked,
                suppliers_notified: suppliersNotified,
                suppliers_skipped: suppliersSkipped,
                clients_notified: clientsNotified,
                admins_notified: adminsNotified
            },
            logs
        });

    } catch (error) {
        console.error('[ManualTrigger] Error:', error);
        return Response.json({ error: error.message, logs }, { status: 500 });
    }
});


// =====================================================================
// Helpers below are MIRRORED from functions/handleEntityEvents.js
// (local imports between Base44 functions are not supported).
// Keep these in sync with handleEntityEvents.js if you change one.
// =====================================================================

async function checkConditions(template, data, oldData, triggerType) {
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

    for (const cond of allConditions) {
        let met = false;

        if (cond.operator === 'changed') {
            // For manual trigger we have no oldData — treat as "passed" so manual sends are not blocked
            // by 'changed' conditions (admin explicitly chose to send now).
            met = true;
        } else {
            met = checkSingleCondition(data, cond);
        }

        if (logic === 'and' && !met) return false;
        if (logic === 'or' && met) return true;
    }

    return logic === 'and' ? true : false;
}

function checkSingleCondition(entityData, condition) {
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

async function sendNotification(base44, template, entityData, event, entityName, log) {
    let relatedEventId;
    let eventObj = null;
    let supplierObj = null;
    let serviceObj = null;

    if (entityName === 'Event') {
        relatedEventId = entityData.id;
        eventObj = entityData;
    }

    const allowedChannels = template.allowed_channels || template.allowedchannels || ['push'];
    const sendPush = allowedChannels.includes('push');
    const sendWhatsApp = allowedChannels.includes('whatsapp');
    const audiences = template.target_audiences || template.targetaudiences || [];

    let suppliersNotified = 0;
    let clientsNotified = 0;
    let adminsNotified = 0;

    // --- 1. Supplier Audience ---
    if (audiences.includes('supplier')) {
        let suppliersToSend = [];

        if (eventObj) {
            try {
                const services = await base44.asServiceRole.entities.EventService.filter({ event_id: eventObj.id });
                for (const s of services) {
                    const sIds = s.supplier_ids || s.supplierids;
                    if (!sIds) continue;
                    let ids = [];
                    try { ids = typeof sIds === 'string' ? JSON.parse(sIds) : sIds; } catch (e) {}
                    if (Array.isArray(ids)) suppliersToSend.push(...ids);
                }
            } catch (e) {
                log && log(`[ManualTrigger] Error loading services: ${e.message}`);
            }
        }

        suppliersToSend = [...new Set(suppliersToSend)];
        log && log(`[ManualTrigger] Suppliers to notify: ${suppliersToSend.length}`);

        for (const supId of suppliersToSend) {
            let currentSupplierObj = null;
            try { currentSupplierObj = await base44.asServiceRole.entities.Supplier.get(supId); } catch (e) {}
            if (!currentSupplierObj) continue;

            // Resolve EventService context for this supplier
            let currentServiceObj = null;
            if (eventObj) {
                try {
                    const services = await base44.asServiceRole.entities.EventService.filter({ event_id: eventObj.id });
                    currentServiceObj = services.find(s => {
                        const sIds = s.supplier_ids || s.supplierids;
                        if (!sIds) return false;
                        try {
                            const ids = typeof sIds === 'string' ? JSON.parse(sIds) : sIds;
                            return Array.isArray(ids) && ids.includes(supId);
                        } catch (e) { return false; }
                    });
                } catch (e) {}
            }

            if (sendWhatsApp) {
                const isEnabled = currentSupplierObj.whatsapp_enabled !== false;
                if (isEnabled && currentSupplierObj.phone) {
                    await triggerWhatsApp(base44, template, currentSupplierObj.phone, eventObj, currentSupplierObj, currentServiceObj, null);
                }
            }

            if (sendPush) {
                const emails = currentSupplierObj.contact_emails || currentSupplierObj.contactemails;
                if (emails && Array.isArray(emails)) {
                    for (const email of emails) {
                        if (!email) continue;
                        const users = await base44.asServiceRole.entities.User.filter({ email });
                        for (const u of users) {
                            await triggerInApp(base44, template, u, eventObj, currentSupplierObj, currentServiceObj);
                        }
                    }
                }
            }

            suppliersNotified++;
        }
    }

    // --- 2. Client Audience ---
    if (audiences.includes('client') && eventObj && eventObj.parents) {
        let parents = [];
        try { parents = typeof eventObj.parents === 'string' ? JSON.parse(eventObj.parents) : eventObj.parents; } catch (e) {}

        if (Array.isArray(parents)) {
            for (const p of parents) {
                if (sendWhatsApp && p.phone) {
                    await triggerWhatsApp(base44, template, p.phone, eventObj, null, null, p);
                }
                if (sendPush && p.email) {
                    const users = await base44.asServiceRole.entities.User.filter({ email: p.email });
                    for (const u of users) {
                        await triggerInApp(base44, template, u, eventObj, null, null);
                    }
                }
                clientsNotified++;
            }
        }
    }

    // --- 3. Admin Audience ---
    if (audiences.includes('admin') || audiences.includes('system_creator')) {
        const admins = await base44.asServiceRole.entities.User.filter({ role: 'admin' });
        for (const admin of admins) {
            if (audiences.includes('system_creator') && !audiences.includes('admin')) {
                if (admin.email !== 'natib8000@gmail.com') continue;
            }
            if (sendWhatsApp && admin.phone) {
                await triggerWhatsApp(base44, template, admin.phone, eventObj, supplierObj, serviceObj, admin);
            }
            if (sendPush) {
                await triggerInApp(base44, template, admin, eventObj, supplierObj, serviceObj);
            }
            adminsNotified++;
        }
    }

    return { suppliers_notified: suppliersNotified, clients_notified: clientsNotified, admins_notified: adminsNotified };
}

async function triggerWhatsApp(base44, template, phone, eventObj, supplierObj, serviceObj, userObj) {
    if (!phone) return;

    let resolvedServiceName = '';
    let supplierNote = '';
    if (serviceObj) {
        const svcId = serviceObj.service_id || serviceObj.serviceid;
        if (svcId) {
            try {
                const svc = await base44.asServiceRole.entities.Service.get(svcId);
                if (svc) resolvedServiceName = svc.service_name || '';
            } catch (e) {}
        }
        if (supplierObj && serviceObj.supplier_notes) {
            try {
                const notes = typeof serviceObj.supplier_notes === 'string' ? JSON.parse(serviceObj.supplier_notes) : serviceObj.supplier_notes;
                if (notes && typeof notes === 'object') {
                    supplierNote = notes[supplierObj.id] || '';
                }
            } catch (e) {}
        }
    }

    let message = template.whatsapp_body_template || template.body_template || template.body || '';
    message = replaceVariables(message, eventObj, supplierObj, serviceObj, userObj, resolvedServiceName, supplierNote);
    message = message.replace(/~\s*~/g, '').replace(/\n\s*\n\s*\n/g, '\n\n').trim();

    const DEFAULT_QUIET_START = 22;
    const DEFAULT_QUIET_END = 8;
    const inQuietHours = isInQuietHours(DEFAULT_QUIET_START, DEFAULT_QUIET_END);

    if (inQuietHours) {
        try {
            const quietEnd = getQuietHoursEndTime(DEFAULT_QUIET_END);
            const userId = userObj?.id || (supplierObj ? `virtual_supplier_${supplierObj.id}` : 'virtual_unknown');
            const userEmail = userObj?.email || supplierObj?.contact_emails?.[0] || '';

            await base44.asServiceRole.entities.PendingPushNotification.create({
                user_id: userId,
                user_email: userEmail,
                title: replaceVariables(template.title_template || '', eventObj, supplierObj, serviceObj, userObj),
                message,
                link: '',
                scheduled_for: quietEnd.toISOString(),
                template_type: template.type,
                is_sent: false,
                data: JSON.stringify({ send_whatsapp: true, whatsapp_message: message, phone })
            });
        } catch (qErr) {
            console.error('[ManualTrigger] Failed to queue WhatsApp:', qErr);
        }
        return;
    }

    try {
        const GREEN_API_INSTANCE_ID = Deno.env.get("GREEN_API_INSTANCE_ID");
        const GREEN_API_TOKEN = Deno.env.get("GREEN_API_TOKEN");

        if (GREEN_API_INSTANCE_ID && GREEN_API_TOKEN) {
            let cleanPhone = phone.toString().replace(/[^0-9]/g, '');
            if (cleanPhone.startsWith('05')) cleanPhone = '972' + cleanPhone.substring(1);
            else if (cleanPhone.length === 9 && cleanPhone.startsWith('5')) cleanPhone = '972' + cleanPhone;

            const chatId = `${cleanPhone}@c.us`;
            const body = { chatId, message };

            await fetch(`https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        }
    } catch (e) {
        console.error('[ManualTrigger] WhatsApp send failed', e);
    }
}

async function triggerInApp(base44, template, user, eventObj, supplierObj, serviceObj) {
    if (!user || !user.id) return;

    let resolvedServiceName = '';
    let supplierNote = '';
    if (serviceObj) {
        const svcId = serviceObj.service_id || serviceObj.serviceid;
        if (svcId) {
            try {
                const svc = await base44.asServiceRole.entities.Service.get(svcId);
                if (svc) resolvedServiceName = svc.service_name || '';
            } catch (e) {}
        }
        if (supplierObj && serviceObj.supplier_notes) {
            try {
                const notes = typeof serviceObj.supplier_notes === 'string' ? JSON.parse(serviceObj.supplier_notes) : serviceObj.supplier_notes;
                if (notes && typeof notes === 'object') {
                    supplierNote = notes[supplierObj.id] || '';
                }
            } catch (e) {}
        }
    }

    let title = template.title_template || template.title || '';
    let message = template.body_template || template.body || '';

    title = replaceVariables(title, eventObj, supplierObj, serviceObj, user, resolvedServiceName, supplierNote);
    message = replaceVariables(message, eventObj, supplierObj, serviceObj, user, resolvedServiceName, supplierNote);

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
        console.error('[ManualTrigger] InApp Trigger failed', e);
    }
}

function isInQuietHours(quietStart, quietEnd, timezone = 'Asia/Jerusalem') {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: timezone });
    const currentHour = parseInt(formatter.format(now), 10);
    if (quietStart > quietEnd) return currentHour >= quietStart || currentHour < quietEnd;
    return currentHour >= quietStart && currentHour < quietEnd;
}

function getQuietHoursEndTime(quietEnd, timezone = 'Asia/Jerusalem') {
    const now = new Date();
    const israelDateFormatter = new Intl.DateTimeFormat('en-US', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
        timeZone: timezone
    });
    const parts = israelDateFormatter.formatToParts(now);
    const year = parts.find(p => p.type === 'year')?.value;
    const month = parts.find(p => p.type === 'month')?.value;
    const day = parts.find(p => p.type === 'day')?.value;
    let endDate = new Date(`${year}-${month}-${day}T${String(quietEnd).padStart(2, '0')}:00:00`);
    const m = parseInt(month, 10);
    const isSummer = m >= 4 && m <= 10;
    const offsetHours = isSummer ? 3 : 2;
    endDate = new Date(endDate.getTime() - offsetHours * 60 * 60 * 1000);
    if (now >= endDate) endDate.setDate(endDate.getDate() + 1);
    return endDate;
}

function replaceVariables(text, eventObj, supplierObj, serviceObj, userObj, resolvedServiceName, supplierNote) {
    if (!text) return '';

    const getVal = (obj, keys) => {
        if (!obj) return '';
        for (const key of keys) {
            if (obj[key] !== undefined && obj[key] !== null) return obj[key];
        }
        return '';
    };

    const vars = {
        'event_name': getVal(eventObj, ['event_name', 'eventname']),
        'eventname': getVal(eventObj, ['event_name', 'eventname']),
        'event_date': getVal(eventObj, ['event_date', 'eventdate']),
        'eventdate': getVal(eventObj, ['event_date', 'eventdate']),
        'event_time': getVal(eventObj, ['event_time', 'eventtime']),
        'eventtime': getVal(eventObj, ['event_time', 'eventtime']),
        'event_location': getVal(eventObj, ['location']),
        'eventlocation': getVal(eventObj, ['location']),
        'event_type': getVal(eventObj, ['event_type', 'eventtype']),
        'guest_count': getVal(eventObj, ['guest_count', 'guestcount']),
        'city': getVal(eventObj, ['city']),
        'family_name': getVal(eventObj, ['family_name', 'familyname']),
        'familyname': getVal(eventObj, ['family_name', 'familyname']),
        'child_name': getVal(eventObj, ['child_name', 'childname']),
        'event_id': getVal(eventObj, ['id']),
        'supplier_name': getVal(supplierObj, ['contact_person']) || getVal(supplierObj, ['supplier_name', 'suppliername']),
        'suppliername': getVal(supplierObj, ['contact_person']) || getVal(supplierObj, ['supplier_name', 'suppliername']),
        'supplier_phone': getVal(supplierObj, ['phone']),
        'service_name': resolvedServiceName || getVal(serviceObj, ['service_name', 'servicename']) || getVal(eventObj, ['service_name', 'serviceName']),
        'servicename': resolvedServiceName || getVal(serviceObj, ['service_name', 'servicename']),
        'supplier_note': supplierNote ? `📝 הערה עבורך: ${supplierNote}` : '',
        'total_price': getVal(eventObj, ['total_price', 'totalprice', 'total_override', 'totaloverride', 'all_inclusive_price', 'allinclusiveprice']),
        'balance': getVal(eventObj, ['balance']),
        'user_name': getVal(userObj, ['full_name', 'fullname', 'name']),
        'username': getVal(userObj, ['full_name', 'fullname', 'name'])
    };

    if (eventObj && eventObj.parents) {
        try {
            const parents = typeof eventObj.parents === 'string' ? JSON.parse(eventObj.parents) : eventObj.parents;
            if (Array.isArray(parents) && parents.length > 0) {
                vars['client_name'] = parents[0].name;
                vars['clientname'] = parents[0].name;
                vars['client_phone'] = parents[0].phone;
            }
        } catch (e) {}
    }
    if (!vars['client_name']) vars['client_name'] = vars['user_name'];

    return text.replace(/\{\{?([\w_]+)\}?}/g, (match, key) => {
        return vars[key] !== undefined ? vars[key] : match;
    });
}