import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Manual Trigger for Notification Templates
 * Allows admins to force-send a notification for a specific event/entity immediately.
 * Bypasses timing checks and quiet hours.
 * Respects Shabbat.
 * Sends WhatsApp DIRECTLY via Green API (Decoupled from InAppNotification).
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
        
        // Security check
        if (!user || user.role !== 'admin') {
            return Response.json({ error: 'Unauthorized', logs }, { status: 403 });
        }

        const payload = await req.json();
        const { template_id, event_id } = payload;

        if (!template_id || !event_id) {
            return Response.json({ error: 'Missing template_id or event_id', logs }, { status: 400 });
        }

        // Shabbat Check
        if (isShabbat()) {
            return Response.json({ error: 'Cannot send manual notifications on Shabbat', logs }, { status: 400 });
        }

        log(`[ManualTrigger] Triggering template ${template_id} for event ${event_id}`);

        // 1. Fetch Template & Event
        const template = await base44.asServiceRole.entities.NotificationTemplate.get(template_id);
        const event = await base44.asServiceRole.entities.Event.get(event_id);

        if (!template || !event) {
            return Response.json({ error: 'Template or Event not found', logs }, { status: 404 });
        }

        const results = {
            whatsapp_sent: 0,
            push_sent: 0,
            recipients: []
        };

        // 2. Identify Target Audience & Logic
        
        // --- Suppliers Audience ---
        if (template.target_audiences.includes('supplier')) {
             log('[ManualTrigger] Processing suppliers...');
             // Get Event Services & Suppliers
             const eventServices = await base44.asServiceRole.entities.EventService.filter({ event_id: event.id });
             const suppliers = await base44.asServiceRole.entities.Supplier.list(); 
             const suppliersMap = new Map(suppliers.map(s => [s.id, s]));

             log(`[ManualTrigger] Found ${eventServices.length} services and ${suppliers.length} total suppliers`);

             for (const es of eventServices) {
                if (!es.supplier_ids) {
                    log(`[ManualTrigger] Service ${es.id} has no supplier_ids`);
                    continue;
                }
                
                let supplierIds = [];
                let supplierStatuses = {};
                
                try {
                    supplierIds = typeof es.supplier_ids === 'string' ? JSON.parse(es.supplier_ids) : es.supplier_ids;
                    supplierStatuses = typeof es.supplier_statuses === 'string' ? JSON.parse(es.supplier_statuses || '{}') : (es.supplier_statuses || {});
                } catch (e) { 
                    log(`[ManualTrigger] Failed to parse JSON for ES ${es.id}: ${e.message}`);
                    continue; 
                }

                log(`[ManualTrigger] Service ${es.id} suppliers: ${JSON.stringify(supplierIds)}`);

                for (const supplierId of supplierIds) {
                     // Check status (only confirmed/approved)
                     const status = supplierStatuses[supplierId];
                     log(`[ManualTrigger] Checking supplier ${supplierId}, status: ${status}`);
                     
                     if (status !== 'approved' && status !== 'confirmed') {
                         log(`[ManualTrigger] Skipping supplier ${supplierId} (status not approved/confirmed)`);
                         continue;
                     }

                     const supplier = suppliersMap.get(supplierId);
                     if (!supplier) {
                         log(`[ManualTrigger] Supplier ${supplierId} not found in DB`);
                         continue;
                     }

                     // DIRECT WHATSAPP SEND (No user dependency)
                     // Treat undefined/null whatsapp_enabled as TRUE (default)
                     const whatsappEnabled = supplier.whatsapp_enabled !== false;
                     log(`[ManualTrigger] Supplier ${supplier.supplier_name} - WA Enabled: ${whatsappEnabled}, Phone: ${supplier.phone}`);

                     if (whatsappEnabled && supplier.phone) {
                         // Prepare Content
                         const contextData = {
                            event_name: event.event_name,
                            family_name: event.family_name,
                            event_date: formatDate(event.event_date),
                            event_time: event.event_time || '',
                            event_location: event.location || '',
                            supplier_name: supplier.contact_person || supplier.supplier_name,
                            supplier_phone: supplier.phone,
                            service_name: es.service_name || '', 
                            event_id: event.id
                         };

                         const whatsappMessage = replacePlaceholders(template.whatsapp_body_template || template.body_template, contextData);
                         
                         try {
                             await base44.asServiceRole.functions.invoke('sendWhatsAppMessage', {
                                 phone: supplier.phone,
                                 message: whatsappMessage,
                                 file_url: null
                             });
                             results.whatsapp_sent++;
                             results.recipients.push({ name: supplier.supplier_name, type: 'whatsapp', phone: supplier.phone });
                             log(`[ManualTrigger] Sent WhatsApp to ${supplier.supplier_name}`);
                             
                             // Log to InAppNotification (Virtual) - Just for record
                             const title = replacePlaceholders(template.title_template, contextData);
                             const message = replacePlaceholders(template.body_template, contextData);
                             
                             await createLogRecord(base44, {
                                 user_id: `virtual_supplier_${supplierId}`,
                                 user_email: supplier.contact_emails?.[0] || '',
                                 title,
                                 message,
                                 template_type: template.type,
                                 related_event_id: event.id,
                                 related_supplier_id: supplierId,
                                 whatsapp_sent: true
                             });

                         } catch (e) {
                             log(`[ManualTrigger] Failed to send to ${supplier.supplier_name}: ${e.message}`);
                         }
                     } else {
                         log(`[ManualTrigger] Supplier ${supplier.supplier_name} skipped (WA disabled or no phone)`);
                     }
                }
             }
        }

        // --- Client Audience ---
        if (template.target_audiences.includes('client')) {
            log('[ManualTrigger] Processing clients...');
            if (event.parents) {
                let parents = [];
                try { parents = typeof event.parents === 'string' ? JSON.parse(event.parents) : event.parents; } catch(e){}
                
                if (Array.isArray(parents)) {
                    for (const parent of parents) {
                        log(`[ManualTrigger] Checking parent ${parent.name}, Phone: ${parent.phone}`);
                        if (parent.phone) {
                             const contextData = {
                                event_name: event.event_name,
                                family_name: event.family_name,
                                event_date: formatDate(event.event_date),
                                event_time: event.event_time || '',
                                event_location: event.location || '',
                                client_name: parent.name,
                                event_id: event.id
                             };

                             const whatsappMessage = replacePlaceholders(template.whatsapp_body_template || template.body_template, contextData);
                             
                             try {
                                 await base44.asServiceRole.functions.invoke('sendWhatsAppMessage', {
                                     phone: parent.phone,
                                     message: whatsappMessage,
                                     file_url: null
                                 });
                                 results.whatsapp_sent++;
                                 results.recipients.push({ name: parent.name, type: 'whatsapp', phone: parent.phone });
                                 log(`[ManualTrigger] Sent WA to client ${parent.name}`);

                                 // Log
                                 const title = replacePlaceholders(template.title_template, contextData);
                                 const message = replacePlaceholders(template.body_template, contextData);
                                 await createLogRecord(base44, {
                                     user_id: `virtual_client_${parent.phone}`, 
                                     user_email: parent.email || '',
                                     title,
                                     message,
                                     template_type: template.type,
                                     related_event_id: event.id,
                                     whatsapp_sent: true
                                 });

                             } catch (e) {
                                 log(`[ManualTrigger] Failed to send to client ${parent.name}: ${e.message}`);
                             }
                        }
                    }
                }
            }
        }

        return Response.json({ success: true, results, logs });

    } catch (error) {
        console.error('[ManualTrigger] Error:', error);
        return Response.json({ error: error.message, logs }, { status: 500 });
    }
});

// --- Helpers ---

async function createLogRecord(base44, data) {
    try {
        await base44.asServiceRole.entities.InAppNotification.create({
             user_id: data.user_id,
             user_email: data.user_email,
             title: data.title,
             message: data.message,
             link: '',
             is_read: false,
             template_type: data.template_type,
             related_event_id: data.related_event_id,
             related_supplier_id: data.related_supplier_id,
             whatsapp_sent: data.whatsapp_sent,
             push_sent: false,
             reminder_count: 0,
             is_resolved: false
         });
    } catch (e) {
        console.warn('Failed to create log record', e);
    }
}

function replacePlaceholders(template, data) {
    if (!template) return '';
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        const value = data[key];
        return value !== undefined && value !== null ? String(value) : match;
    });
}

function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('he-IL');
}

function isShabbat(timezone = 'Asia/Jerusalem') {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', hour12: false, timeZone: timezone });
    const parts = formatter.formatToParts(now);
    const day = parts.find(p => p.type === 'weekday')?.value;
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
    if (day === 'Fri' && hour >= 16) return true;
    if (day === 'Sat' && hour < 20) return true;
    return false;
}