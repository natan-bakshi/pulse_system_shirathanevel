import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Handles a change to supplier_arrival_time on a specific EventService.
 * Called by the admin AFTER they updated the field, to choose what to do with the assigned suppliers.
 *
 * Modes (sent in payload.mode):
 *  - 'notify'  -> send the supplier_assignment_update template ONLY to suppliers of this service
 *  - 'cancel'  -> remove all suppliers from this service and send them a cancellation notification
 *  - 'nothing' -> do nothing (no notifications, no cancellations). Only used to keep the API symmetrical.
 *
 * Note: This function operates on a single EventService (not the whole event). It uses the
 * 'event_critical_update' template for notifications (same one used after a date change),
 * and 'supplier_assignment_delete' for cancellations.
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        const user = await base44.auth.me();
        if (!user || user.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const payload = await req.json();
        const { event_service_id, mode } = payload;

        if (!event_service_id) {
            return Response.json({ error: 'event_service_id is required' }, { status: 400 });
        }
        if (!mode || !['notify', 'cancel', 'nothing'].includes(mode)) {
            return Response.json({ error: 'mode must be one of: notify, cancel, nothing' }, { status: 400 });
        }

        // 'nothing' is a no-op (we just acknowledge)
        if (mode === 'nothing') {
            return Response.json({ success: true, mode: 'nothing' });
        }

        const eventService = await base44.asServiceRole.entities.EventService.get(event_service_id);
        if (!eventService) {
            return Response.json({ error: 'EventService not found' }, { status: 404 });
        }

        const event = await base44.asServiceRole.entities.Event.get(eventService.event_id);
        if (!event) {
            return Response.json({ error: 'Event not found' }, { status: 404 });
        }

        // Resolve service name (for {{service_name}})
        let resolvedServiceName = '';
        if (eventService.service_id) {
            try {
                const svc = await base44.asServiceRole.entities.Service.get(eventService.service_id);
                if (svc) resolvedServiceName = svc.service_name || '';
            } catch (e) {}
        }

        // Parse supplier ids on this service
        let supplierIds = [];
        try {
            supplierIds = typeof eventService.supplier_ids === 'string'
                ? JSON.parse(eventService.supplier_ids || '[]')
                : (Array.isArray(eventService.supplier_ids) ? eventService.supplier_ids : []);
        } catch (e) { supplierIds = []; }

        if (!Array.isArray(supplierIds) || supplierIds.length === 0) {
            return Response.json({ success: true, notifications_sent: 0, reason: 'no suppliers on this service' });
        }

        // Parse supplier notes
        let supplierNotes = {};
        try {
            supplierNotes = typeof eventService.supplier_notes === 'string'
                ? JSON.parse(eventService.supplier_notes || '{}')
                : (eventService.supplier_notes || {});
        } catch (e) { supplierNotes = {}; }

        let notificationsSent = 0;

        if (mode === 'notify') {
            // Use 'event_critical_update' template (same as the one used after event date/time change)
            const templates = await base44.asServiceRole.entities.NotificationTemplate.filter({
                is_active: true,
                trigger_type: 'event_critical_update'
            });

            // Reset statuses to pending for these suppliers (they need to re-confirm with the new arrival time)
            let supplierStatuses = {};
            try {
                supplierStatuses = typeof eventService.supplier_statuses === 'string'
                    ? JSON.parse(eventService.supplier_statuses || '{}')
                    : (eventService.supplier_statuses || {});
            } catch (e) { supplierStatuses = {}; }

            for (const supId of supplierIds) {
                supplierStatuses[supId] = 'pending';
            }
            await base44.asServiceRole.entities.EventService.update(event_service_id, {
                supplier_statuses: JSON.stringify(supplierStatuses)
            });

            for (const template of templates) {
                const audiences = template.target_audiences || [];
                if (!audiences.includes('supplier')) continue;

                for (const supId of supplierIds) {
                    try {
                        const supplier = await base44.asServiceRole.entities.Supplier.get(supId);
                        if (!supplier) continue;

                        const supplierNote = supplierNotes[supId] || '';

                        const allowedChannels = template.allowed_channels || ['push'];
                        const sendPush = allowedChannels.includes('push');
                        const sendWhatsApp = allowedChannels.includes('whatsapp');

                        let title = template.title_template || '';
                        let message = template.body_template || '';
                        let waMessage = template.whatsapp_body_template || message;

                        title = replaceVariables(title, event, supplier, eventService, null, resolvedServiceName, supplierNote);
                        message = replaceVariables(message, event, supplier, eventService, null, resolvedServiceName, supplierNote);
                        waMessage = replaceVariables(waMessage, event, supplier, eventService, null, resolvedServiceName, supplierNote);

                        waMessage = waMessage.replace(/~\s*~/g, '').replace(/\n\s*\n\s*\n/g, '\n\n').trim();

                        if (sendWhatsApp && supplier.whatsapp_enabled !== false && supplier.phone) {
                            await sendWhatsAppGreenAPI(supplier.phone, waMessage);
                        }

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
                                                related_event_service_id: eventService.id,
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

            return Response.json({ success: true, mode: 'notify', notifications_sent: notificationsSent });
        }

        if (mode === 'cancel') {
            // Send cancellation notifications via 'supplier_assignment_delete' template (CANCEL_SUPPLIER)
            const templates = await base44.asServiceRole.entities.NotificationTemplate.filter({
                is_active: true,
                trigger_type: 'supplier_assignment_delete'
            });

            for (const template of templates) {
                const audiences = template.target_audiences || [];
                if (!audiences.includes('supplier')) continue;

                for (const supId of supplierIds) {
                    try {
                        const supplier = await base44.asServiceRole.entities.Supplier.get(supId);
                        if (!supplier) continue;

                        const supplierNote = supplierNotes[supId] || '';

                        const allowedChannels = template.allowed_channels || ['push'];
                        const sendPush = allowedChannels.includes('push');
                        const sendWhatsApp = allowedChannels.includes('whatsapp');

                        let title = template.title_template || '';
                        let message = template.body_template || '';
                        let waMessage = template.whatsapp_body_template || message;

                        title = replaceVariables(title, event, supplier, eventService, null, resolvedServiceName, supplierNote);
                        message = replaceVariables(message, event, supplier, eventService, null, resolvedServiceName, supplierNote);
                        waMessage = replaceVariables(waMessage, event, supplier, eventService, null, resolvedServiceName, supplierNote);

                        waMessage = waMessage.replace(/~\s*~/g, '').replace(/\n\s*\n\s*\n/g, '\n\n').trim();

                        if (sendWhatsApp && supplier.whatsapp_enabled !== false && supplier.phone) {
                            await sendWhatsAppGreenAPI(supplier.phone, waMessage);
                        }

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
                                                related_event_service_id: eventService.id,
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

            // Remove all suppliers from this specific service (and their statuses/notes)
            await base44.asServiceRole.entities.EventService.update(event_service_id, {
                supplier_ids: JSON.stringify([]),
                supplier_statuses: JSON.stringify({}),
                supplier_notes: JSON.stringify({})
            });

            return Response.json({ success: true, mode: 'cancel', notifications_sent: notificationsSent });
        }

        return Response.json({ success: true });

    } catch (error) {
        console.error('[handleSupplierArrivalTimeChange] Error:', error);
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

    const fmtDate = (raw) => {
        if (!raw) return '';
        const d = new Date(raw);
        if (isNaN(d.getTime())) return raw;
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `\u200E${dd}/${mm}/${yyyy}`;
    };

    // Effective supplier time: prefer supplier_arrival_time on the EventService, fallback to event time.
    const supplierArrivalTime = serviceObj && supplierObj
        ? getVal(serviceObj, ['supplier_arrival_time', 'supplierarrivaltime'])
        : '';
    const arrivalTrimmed = typeof supplierArrivalTime === 'string' ? supplierArrivalTime.trim() : '';
    const baseEventTime = getVal(eventObj, ['event_time', 'eventtime']);
    const effectiveEventTime = arrivalTrimmed || baseEventTime;

    const eventDateRaw = getVal(eventObj, ['event_date']);

    const vars = {
        'event_name': getVal(eventObj, ['event_name']),
        'event_date': fmtDate(eventDateRaw),
        'event_time': effectiveEventTime,
        'event_location': getVal(eventObj, ['location']),
        'event_type': getVal(eventObj, ['event_type']),
        'guest_count': getVal(eventObj, ['guest_count']),
        'city': getVal(eventObj, ['city']),
        'family_name': getVal(eventObj, ['family_name']) || getVal(eventObj, ['event_name']) || 'אירוע ללא שם',
        'child_name': getVal(eventObj, ['child_name']),
        'event_id': getVal(eventObj, ['id']),
        'supplier_name': getVal(supplierObj, ['contact_person']) || getVal(supplierObj, ['supplier_name']),
        'supplier_phone': getVal(supplierObj, ['phone']),
        'service_name': resolvedServiceName || getVal(serviceObj, ['service_name']),
        'supplier_note': supplierNote ? `📝 הערה עבורך: ${supplierNote}` : '',
        'user_name': getVal(userObj, ['full_name', 'name'])
    };

    if (eventObj && eventObj.parents) {
        try {
            const parents = typeof eventObj.parents === 'string' ? JSON.parse(eventObj.parents) : eventObj.parents;
            if (Array.isArray(parents) && parents.length > 0) {
                vars['client_name'] = parents[0].name;
                vars['client_phone'] = parents[0].phone;
            }
        } catch (e) {}
    }

    return text.replace(/\{\{?([\w_]+)\}?}/g, (match, key) => {
        return vars[key] !== undefined ? vars[key] : match;
    });
}