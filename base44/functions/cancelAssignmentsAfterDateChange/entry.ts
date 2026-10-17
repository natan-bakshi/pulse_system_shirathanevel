import { getClientContacts } from '../../shared/eventFields.js';
import { recalculateEventStatus } from '../../shared/eventReadiness.ts';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';
import { formatEventContacts } from '../../shared/eventContacts.ts';
import { createNotificationCore } from '../../shared/notificationCore.ts';
import { enqueueAssignmentTransitionWhatsApp } from '../../shared/assignmentTransitionWhatsApp.ts';

/**
 * Called when admin chooses NOT to reassign the same suppliers after a date change.
 * - Sends the existing 'CANCEL_SUPPLIER' (supplier_assignment_delete) notification to each previously-assigned supplier
 * - Removes all suppliers from EventService records (clears supplier_ids/statuses/notes)
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

        // Build a "snapshot" event with the OLD date/time so the cancellation message references
        // the date the supplier originally agreed to.
        const eventForCancellation = {
            ...event,
            event_date: event.previous_event_date || event.event_date,
            event_time: event.previous_event_time || event.event_time
        };

        const services = await base44.asServiceRole.entities.EventService.filter({ event_id });

        // Collect all unique suppliers + map to one of their services for context
        const supplierServiceMap = new Map(); // supplierId -> service
        for (const service of services) {
            let supplierIds = [];
            try {
                supplierIds = typeof service.supplier_ids === 'string'
                    ? JSON.parse(service.supplier_ids || '[]')
                    : (Array.isArray(service.supplier_ids) ? service.supplier_ids : []);
            } catch (e) { supplierIds = []; }

            if (Array.isArray(supplierIds)) {
                for (const supId of supplierIds) {
                    if (!supplierServiceMap.has(supId)) {
                        supplierServiceMap.set(supId, service);
                    }
                }
            }
        }

        // 1. Send cancellation notifications using the existing CANCEL_SUPPLIER template
        const templates = await base44.asServiceRole.entities.NotificationTemplate.filter({
            is_active: true,
            trigger_type: 'supplier_assignment_delete'
        });

        let notificationsSent = 0;
        let whatsappEnqueueFailures = 0;
        let confirmedWhatsApp = 0;

        for (const template of templates) {
            const audiences = template.target_audiences || [];
            if (!audiences.includes('supplier')) continue;

            for (const [supId, supService] of supplierServiceMap.entries()) {
                try {
                    const supplier = await base44.asServiceRole.entities.Supplier.get(supId);
                    if (!supplier) continue;

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

                    title = replaceVariables(title, eventForCancellation, supplier, supService, null, resolvedServiceName, supplierNote);
                    message = replaceVariables(message, eventForCancellation, supplier, supService, null, resolvedServiceName, supplierNote);
                    waMessage = replaceVariables(waMessage, eventForCancellation, supplier, supService, null, resolvedServiceName, supplierNote);

                    waMessage = waMessage.replace(/~\s*~/g, '').replace(/\n\s*\n\s*\n/g, '\n\n').trim();

                    if (sendWhatsApp && supplier.whatsapp_enabled !== false && supplier.phone) {
                        await sendWhatsAppNotification(base44,supplier.phone,waMessage,{
                            kind:'date_cancel',eventId:event.id,supplierId:supId,
                            templateId:template.id||template.type,
                            oldEventDate:event.previous_event_date||'',
                            oldEventTime:event.previous_event_time||'',
                            eventDate:event.event_date,eventTime:event.event_time
                        });
                        confirmedWhatsApp++;
                    }

                    if (sendPush) {
                        const emails = supplier.contact_emails || [];
                        if (Array.isArray(emails)) {
                            for (const email of emails) {
                                if (!email) continue;
                                const users = await base44.asServiceRole.entities.User.filter({ email });
                                for (const u of users) {
                                    try {
                                        await createNotificationCore(base44, {
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
                    // A failed enqueue must never be counted as delivered or
                    // allow destructive assignment removal to proceed silently.
                    whatsappEnqueueFailures++;
                    console.error(`[CancelAssignments] Supplier notification was not durably queued: ${supId}`, e);
                }
            }
        }

        if(whatsappEnqueueFailures>0){
            // Safe retry: the same event-date transition and supplier use the
            // same Outbox key. Existing queue jobs will not be sent twice.
            // Do NOT clear assignments or the recovery flag if any required
            // WhatsApp message could not be persisted. UNKNOWN must be checked
            // manually, never replayed with a fresh key.
            return Response.json({
                success:false,recovery_required:true,
                error:'Supplier WhatsApp queue incomplete; assignments were not removed',
                whatsapp_confirmed:confirmedWhatsApp,
                whatsapp_failures:whatsappEnqueueFailures
            },{status:409});
        }

        // 2. Remove all suppliers from each service
        for (const service of services) {
            await base44.asServiceRole.entities.EventService.update(service.id, {
                supplier_ids: JSON.stringify([]),
                supplier_statuses: JSON.stringify({}),
                supplier_notes: JSON.stringify({})
            });
        }

        await recalculateEventStatus(base44.asServiceRole, event_id);

        // 3. Clear the pending flag
        await base44.asServiceRole.entities.Event.update(event_id, {
            date_change_pending_action: false,
            previous_event_date: '',
            previous_event_time: ''
        });

        return Response.json({ success: true, notifications_sent: notificationsSent, whatsapp_confirmed:confirmedWhatsApp });

    } catch (error) {
        console.error('[cancelAssignmentsAfterDateChange] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});

async function sendWhatsAppNotification(base44,phone,message,identity){
    return enqueueAssignmentTransitionWhatsApp(base44,phone,message,identity,'assignment_cancel');
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
        'family_name': getVal(eventObj, ['family_name']) || getVal(eventObj, ['event_name']),
        'child_name': getVal(eventObj, ['child_name']),
        'event_id': getVal(eventObj, ['id']),
        'event_contacts': formatEventContacts(eventObj),
        'supplier_name': getVal(supplierObj, ['contact_person']) || getVal(supplierObj, ['supplier_name']),
        'supplier_phone': getVal(supplierObj, ['phone']),
        'service_name': resolvedServiceName || getVal(serviceObj, ['service_name']),
        'supplier_note': supplierNote ? `📝 הערה עבורך: ${supplierNote}` : '',
        'user_name': getVal(userObj, ['full_name', 'name'])
    };

    if (eventObj && getClientContacts(eventObj)) {
        const parents = typeof getClientContacts(eventObj) === 'string' ? JSON.parse(getClientContacts(eventObj)) : getClientContacts(eventObj);
        if (Array.isArray(parents) && parents.length > 0) {
            vars['client_name'] = parents[0].name;
            vars['client_phone'] = parents[0].phone;
        }
    }

    return text.replace(/\{\{?([\w_]+)\}?}/g, (match, key) => {
        return vars[key] !== undefined ? vars[key] : match;
    });
}
