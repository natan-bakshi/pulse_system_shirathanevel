import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Called when admin confirms to reassign the same suppliers to an event after a date change.
 * - Resets the supplier statuses to 'pending' for all assigned suppliers
 * - Sends the existing 'event_critical_update' notification (SUPPLIER_ASSIGNMENT_UPDATE) to each supplier
 * - Clears the date_change_pending_action flag on the Event
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        // Verify admin
        const user = await base44.auth.me();
        if (!user || user.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const payload = await req.json();
        const { event_id } = payload;
        if (!event_id) {
            return Response.json({ error: 'event_id is required' }, { status: 400 });
        }

        const event = await base44.asServiceRole.entities.Event.get(event_id);
        if (!event) {
            return Response.json({ error: 'Event not found' }, { status: 404 });
        }

        // 1. Reset all supplier statuses to 'pending' on every EventService of this event
        const services = await base44.asServiceRole.entities.EventService.filter({ event_id });
        for (const service of services) {
            let supplierIds = [];
            try {
                supplierIds = typeof service.supplier_ids === 'string' 
                    ? JSON.parse(service.supplier_ids || '[]') 
                    : (Array.isArray(service.supplier_ids) ? service.supplier_ids : []);
            } catch (e) {
                supplierIds = [];
            }

            if (!Array.isArray(supplierIds) || supplierIds.length === 0) continue;

            // Reset all supplier statuses to 'pending'
            const newStatuses = {};
            for (const supId of supplierIds) {
                newStatuses[supId] = 'pending';
            }

            await base44.asServiceRole.entities.EventService.update(service.id, {
                supplier_statuses: JSON.stringify(newStatuses)
            });
        }

        // 2. Send 'event_critical_update' notification (SUPPLIER_ASSIGNMENT_UPDATE) to each assigned supplier
        // We invoke handleEntityEvents-like logic by directly fetching templates and dispatching
        const templates = await base44.asServiceRole.entities.NotificationTemplate.filter({
            is_active: true,
            trigger_type: 'event_critical_update'
        });

        let notificationsSent = 0;

        for (const template of templates) {
            const audiences = template.target_audiences || [];
            if (!audiences.includes('supplier')) continue;

            // Collect all assigned suppliers across all services
            const supplierIdsSet = new Set();
            for (const service of services) {
                let sIds = [];
                try {
                    sIds = typeof service.supplier_ids === 'string'
                        ? JSON.parse(service.supplier_ids || '[]')
                        : (Array.isArray(service.supplier_ids) ? service.supplier_ids : []);
                } catch (e) { sIds = []; }
                if (Array.isArray(sIds)) {
                    sIds.forEach(id => supplierIdsSet.add(id));
                }
            }

            for (const supId of supplierIdsSet) {
                try {
                    const supplier = await base44.asServiceRole.entities.Supplier.get(supId);
                    if (!supplier) continue;

                    // Find the service this supplier is assigned to (for service_name resolution)
                    const supService = services.find(s => {
                        try {
                            const ids = typeof s.supplier_ids === 'string' 
                                ? JSON.parse(s.supplier_ids || '[]') 
                                : s.supplier_ids;
                            return Array.isArray(ids) && ids.includes(supId);
                        } catch (e) { return false; }
                    });

                    let resolvedServiceName = '';
                    let supplierNote = '';
                    if (supService) {
                        if (supService.service_id) {
                            try {
                                const svc = await base44.asServiceRole.entities.Service.get(supService.service_id);
                                if (svc) resolvedServiceName = svc.service_name || '';
                            } catch (e) {}
                        }
                        if (supService.supplier_notes) {
                            try {
                                const notes = typeof supService.supplier_notes === 'string' 
                                    ? JSON.parse(supService.supplier_notes) 
                                    : supService.supplier_notes;
                                if (notes && typeof notes === 'object') supplierNote = notes[supId] || '';
                            } catch (e) {}
                        }
                    }

                    const allowedChannels = template.allowed_channels || ['push'];
                    const sendPush = allowedChannels.includes('push');
                    const sendWhatsApp = allowedChannels.includes('whatsapp');

                    let title = template.title_template || '';
                    let message = template.body_template || '';
                    let waMessage = template.whatsapp_body_template || message;

                    title = replaceVariables(title, event, supplier, supService, null, resolvedServiceName, supplierNote);
                    message = replaceVariables(message, event, supplier, supService, null, resolvedServiceName, supplierNote);
                    waMessage = replaceVariables(waMessage, event, supplier, supService, null, resolvedServiceName, supplierNote);

                    // Clean empty placeholders
                    waMessage = waMessage.replace(/~\s*~/g, '').replace(/\n\s*\n\s*\n/g, '\n\n').trim();

                    // WhatsApp - send via Green API
                    if (sendWhatsApp && supplier.whatsapp_enabled !== false && supplier.phone) {
                        await sendWhatsAppGreenAPI(supplier.phone, waMessage);
                    }

                    // Push - via createNotification (which handles in-app + push)
                    if (sendPush) {
                        const emails = supplier.contact_emails || [];
                        if (Array.isArray(emails)) {
                            for (const email of emails) {
                                if (!email) continue;
                                const users = await base44.asServiceRole.entities.User.filter({ email });
                                for (const u of users) {
                                    try {
                                        await base44.asServiceRole.functions.invoke('createNotification', {
                                            target_user_id: u.id,
                                            target_user_email: u.email,
                                            title,
                                            message,
                                            template_type: template.type,
                                            related_event_id: event.id,
                                            related_supplier_id: supplier.id,
                                            related_event_service_id: supService?.id,
                                            send_push: true
                                        });
                                    } catch (e) {
                                        console.error('createNotification failed', e);
                                    }
                                }
                            }
                        }
                    }

                    notificationsSent++;
                } catch (e) {
                    console.error(`Failed processing supplier ${supId}:`, e);
                }
            }
        }

        // 3. Clear the pending flag
        await base44.asServiceRole.entities.Event.update(event_id, {
            date_change_pending_action: false,
            previous_event_date: '',
            previous_event_time: ''
        });

        return Response.json({ success: true, notifications_sent: notificationsSent });

    } catch (error) {
        console.error('[confirmReassignAfterDateChange] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});

async function sendWhatsAppGreenAPI(phone, message) {
    try {
        const GREEN_API_INSTANCE_ID = Deno.env.get("GREEN_API_INSTANCE_ID");
        const GREEN_API_TOKEN = Deno.env.get("GREEN_API_TOKEN");
        if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN) return;

        let cleanPhone = phone.toString().replace(/[^0-9]/g, '');
        if (cleanPhone.startsWith('05')) cleanPhone = '972' + cleanPhone.substring(1);
        else if (cleanPhone.length === 9 && cleanPhone.startsWith('5')) cleanPhone = '972' + cleanPhone;

        const chatId = `${cleanPhone}@c.us`;
        await fetch(`https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatId, message })
        });
    } catch (e) {
        console.error('WhatsApp send failed:', e);
    }
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
        'event_name': getVal(eventObj, ['event_name']),
        'event_date': getVal(eventObj, ['event_date']),
        'event_time': getVal(eventObj, ['event_time']),
        'event_location': getVal(eventObj, ['location']),
        'event_type': getVal(eventObj, ['event_type']),
        'guest_count': getVal(eventObj, ['guest_count']),
        'city': getVal(eventObj, ['city']),
        'family_name': getVal(eventObj, ['family_name']),
        'child_name': getVal(eventObj, ['child_name']),
        'event_id': getVal(eventObj, ['id']),
        'supplier_name': getVal(supplierObj, ['contact_person']) || getVal(supplierObj, ['supplier_name']),
        'supplier_phone': getVal(supplierObj, ['phone']),
        'service_name': resolvedServiceName || getVal(serviceObj, ['service_name']),
        'supplier_note': supplierNote ? `📝 הערה עבורך: ${supplierNote}` : '',
        'user_name': getVal(userObj, ['full_name', 'name'])
    };

    if (eventObj && eventObj.parents) {
        const parents = typeof eventObj.parents === 'string' ? JSON.parse(eventObj.parents) : eventObj.parents;
        if (Array.isArray(parents) && parents.length > 0) {
            vars['client_name'] = parents[0].name;
            vars['client_phone'] = parents[0].phone;
        }
    }

    return text.replace(/\{\{?([\w_]+)\}?}/g, (match, key) => {
        return vars[key] !== undefined ? vars[key] : match;
    });
}