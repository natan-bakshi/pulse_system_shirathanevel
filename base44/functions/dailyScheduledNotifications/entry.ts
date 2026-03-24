import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID');
const ONESIGNAL_API_KEY = Deno.env.get('ONESIGNAL_API_KEY');
const GREEN_API_INSTANCE_ID = Deno.env.get("GREEN_API_INSTANCE_ID");
const GREEN_API_TOKEN = Deno.env.get("GREEN_API_TOKEN");

/**
 * Daily Scheduled Notifications Processor
 * Runs once daily at 09:00 Israel time.
 * Replaces: processScheduledPushNotifications (every 15min), sendEventReminders (hourly), 
 *           checkPendingAssignments (hourly), checkAutomatedTriggers (hourly)
 * 
 * Steps:
 * 1. Process pending notifications (queued from quiet hours/shabbat)
 * 2. Process scheduled_check templates (timed notifications)
 * 3. Send event reminders to suppliers and admins
 * 4. Check pending supplier assignments
 * 5. Batch send all collected WhatsApp & Push notifications
 * 6. Clean up old PendingPushNotification records
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }
        
        console.log('[DailyNotifications] Starting daily notification processing...');
        
        // Check Shabbat - if active, skip entirely
        if (isShabbat()) {
            console.log('[DailyNotifications] Shabbat active - skipping all notifications');
            return Response.json({ success: true, skipped: true, reason: 'Shabbat' });
        }

        const results = {
            pending_processed: 0,
            pending_whatsapp_sent: 0,
            pending_push_sent: 0,
            scheduled_templates_processed: 0,
            event_reminders_sent: 0,
            pending_assignments_sent: 0,
            errors: 0,
            cleaned_up: 0
        };

        // ============================================================
        // PHASE 0: Load all shared data ONCE (minimize API calls)
        // ============================================================
        console.log('[DailyNotifications] Loading shared data...');
        
        const [
            allEvents,
            allEventServices,
            allSuppliers,
            allUsers,
            allTemplates,
            allPendingNotifications,
            existingNotifications
        ] = await Promise.all([
            base44.asServiceRole.entities.Event.list(),
            base44.asServiceRole.entities.EventService.list(),
            base44.asServiceRole.entities.Supplier.list(),
            base44.asServiceRole.entities.User.list(),
            base44.asServiceRole.entities.NotificationTemplate.filter({ is_active: true }),
            base44.asServiceRole.entities.PendingPushNotification.filter({ is_sent: false }),
            base44.asServiceRole.entities.InAppNotification.filter({ is_resolved: false })
        ]);

        const suppliersMap = new Map(allSuppliers.map(s => [s.id, s]));
        const eventsMap = new Map(allEvents.map(e => [e.id, e]));
        const adminUsers = allUsers.filter(u => u.role === 'admin');
        const now = new Date();

        // Collect all messages to send
        const whatsappQueue = []; // { phone, message }
        const pushQueue = []; // { subscriptionId, title, message, link, notificationRecordId }

        // ============================================================
        // PHASE 1: Process Pending Notifications (from quiet hours/shabbat)
        // ============================================================
        console.log('[DailyNotifications] Phase 1: Processing pending notifications...');
        
        const dueNotifications = allPendingNotifications.filter(n => {
            if (!n.scheduled_for) return false;
            return new Date(n.scheduled_for) <= now;
        });
        
        console.log(`[DailyNotifications] Found ${dueNotifications.length} due pending notifications`);

        for (const pending of dueNotifications) {
            try {
                // Parse WhatsApp data
                let whatsappData = null;
                try { whatsappData = pending.data ? JSON.parse(pending.data) : {}; } catch(e) {}

                // Send WhatsApp if queued
                if (whatsappData && whatsappData.send_whatsapp) {
                    const phoneToUse = whatsappData.phone;
                    if (phoneToUse) {
                        whatsappQueue.push({
                            phone: phoneToUse,
                            message: whatsappData.whatsapp_message || pending.message
                        });
                        
                        // Update in-app notification whatsapp status
                        if (pending.in_app_notification_id) {
                            try {
                                await base44.asServiceRole.entities.InAppNotification.update(pending.in_app_notification_id, {
                                    whatsapp_sent: true
                                });
                            } catch(e) {}
                        }
                    }
                }

                // Send Push if user has subscription
                const targetUser = allUsers.find(u => u.id === pending.user_id);
                if (targetUser?.push_enabled && targetUser?.onesignal_subscription_id) {
                    pushQueue.push({
                        subscriptionId: targetUser.onesignal_subscription_id,
                        title: pending.title,
                        message: pending.message,
                        link: pending.link || '',
                        notificationRecordId: pending.in_app_notification_id
                    });
                }

                // Mark as sent
                await base44.asServiceRole.entities.PendingPushNotification.update(pending.id, { is_sent: true });
                results.pending_processed++;
                
            } catch (error) {
                console.error(`[DailyNotifications] Error processing pending ${pending.id}:`, error);
                results.errors++;
            }
        }

        // ============================================================
        // PHASE 2: Process scheduled_check Templates
        // ============================================================
        console.log('[DailyNotifications] Phase 2: Processing scheduled templates...');
        
        const scheduledTemplates = allTemplates.filter(t => t.trigger_type === 'scheduled_check');
        
        for (const template of scheduledTemplates) {
            try {
                await processScheduledTemplate(base44, template, allEvents, allEventServices, allSuppliers, allUsers, suppliersMap, existingNotifications, whatsappQueue, pushQueue, results);
                results.scheduled_templates_processed++;
            } catch (e) {
                console.error(`[DailyNotifications] Error in scheduled template ${template.type}:`, e);
                results.errors++;
            }
        }

        // ============================================================
        // PHASE 3: Event Reminders (supplier + admin)
        // ============================================================
        console.log('[DailyNotifications] Phase 3: Processing event reminders...');
        
        const supplierReminderTemplate = allTemplates.find(t => t.type === 'SUPPLIER_EVENT_REMINDER');
        const adminReminderTemplate = allTemplates.find(t => t.type === 'ADMIN_EVENT_REMINDER');
        
        for (const event of allEvents) {
            if (event.status === 'cancelled') continue;
            const eventDate = new Date(event.event_date);
            if (eventDate < now) continue;
            
            // Supplier reminders
            if (supplierReminderTemplate) {
                const timingValue = supplierReminderTemplate.timing_value || 1;
                const timingUnit = supplierReminderTemplate.timing_unit || 'days';
                const eventDateTime = getIsraelEventDate(event.event_date, event.event_time);
                const reminderCutoff = new Date(eventDateTime);
                applyTimingOffset(reminderCutoff, timingUnit, -timingValue);
                
                if (now >= reminderCutoff) {
                    const eventServices = allEventServices.filter(es => es.event_id === event.id);
                    
                    for (const es of eventServices) {
                        if (!es.supplier_ids || !es.supplier_statuses) continue;
                        
                        let supplierIds = [], supplierStatuses = {};
                        try {
                            supplierIds = JSON.parse(es.supplier_ids);
                            supplierStatuses = JSON.parse(es.supplier_statuses);
                        } catch (e) { continue; }
                        
                        for (const supplierId of supplierIds) {
                            const status = supplierStatuses[supplierId];
                            if (status !== 'approved' && status !== 'confirmed') continue;
                            
                            const supplier = suppliersMap.get(supplierId);
                            if (!supplier) continue;
                            
                            // Check duplicate
                            const hasExisting = existingNotifications.some(n => 
                                n.template_type === 'SUPPLIER_EVENT_REMINDER' &&
                                n.related_event_id === event.id &&
                                n.related_supplier_id === supplierId
                            );
                            if (hasExisting) continue;
                            
                            const contextData = buildEventContext(event, supplier, null);
                            const title = replacePlaceholders(supplierReminderTemplate.title_template, contextData);
                            const message = replacePlaceholders(supplierReminderTemplate.body_template, contextData);
                            const waMessage = replacePlaceholders(supplierReminderTemplate.whatsapp_body_template || supplierReminderTemplate.body_template, contextData);
                            const link = buildDeepLink(supplierReminderTemplate.deep_link_base, supplierReminderTemplate.deep_link_params_map, contextData);
                            
                            // WhatsApp - direct to phone (works for non-registered users)
                            if (supplier.phone && supplier.whatsapp_enabled !== false) {
                                whatsappQueue.push({ phone: supplier.phone, message: waMessage });
                            }
                            
                            // Push + InApp - only for registered users
                            const supplierUser = allUsers.find(u => supplier.contact_emails?.includes(u.email));
                            
                            // Create InApp record
                            const targetUserId = supplierUser?.id || `virtual_supplier_${supplierId}`;
                            const targetEmail = supplierUser?.email || supplier.contact_emails?.[0] || '';
                            
                            // Only create DB record for real users
                            if (supplierUser) {
                                try {
                                    const notifRecord = await base44.asServiceRole.entities.InAppNotification.create({
                                        user_id: supplierUser.id,
                                        user_email: targetEmail,
                                        title, message, link: link || '',
                                        is_read: false,
                                        template_type: 'SUPPLIER_EVENT_REMINDER',
                                        related_event_id: event.id,
                                        related_event_service_id: es.id,
                                        related_supplier_id: supplierId,
                                        push_sent: false,
                                        whatsapp_sent: !!supplier.phone,
                                        reminder_count: 0,
                                        is_resolved: false
                                    });
                                    
                                    // Queue push
                                    if (supplierUser.push_enabled && supplierUser.onesignal_subscription_id) {
                                        pushQueue.push({
                                            subscriptionId: supplierUser.onesignal_subscription_id,
                                            title, message, link: link || '',
                                            notificationRecordId: notifRecord.id
                                        });
                                    }
                                } catch (dbErr) {
                                    console.warn(`[DailyNotifications] DB error for supplier reminder:`, dbErr.message);
                                }
                            }
                            
                            results.event_reminders_sent++;
                        }
                    }
                }
            }
            
            // Admin reminders
            if (adminReminderTemplate) {
                const timingValue = adminReminderTemplate.timing_value || 1;
                const timingUnit = adminReminderTemplate.timing_unit || 'days';
                const adminEventDateTime = getIsraelEventDate(event.event_date, event.event_time);
                const reminderCutoff = new Date(adminEventDateTime);
                applyTimingOffset(reminderCutoff, timingUnit, -timingValue);
                
                if (now >= reminderCutoff) {
                    for (const admin of adminUsers) {
                        const hasExisting = existingNotifications.some(n => 
                            n.template_type === 'ADMIN_EVENT_REMINDER' &&
                            n.related_event_id === event.id &&
                            n.user_id === admin.id
                        );
                        if (hasExisting) continue;
                        
                        const contextData = buildEventContext(event, null, admin);
                        const title = replacePlaceholders(adminReminderTemplate.title_template, contextData);
                        const message = replacePlaceholders(adminReminderTemplate.body_template, contextData);
                        const waMessage = replacePlaceholders(adminReminderTemplate.whatsapp_body_template || adminReminderTemplate.body_template, contextData);
                        const link = buildDeepLink(adminReminderTemplate.deep_link_base, adminReminderTemplate.deep_link_params_map, contextData);
                        
                        // WhatsApp for admin
                        if (admin.phone) {
                            whatsappQueue.push({ phone: admin.phone, message: waMessage });
                        }
                        
                        // InApp + Push
                        try {
                            const notifRecord = await base44.asServiceRole.entities.InAppNotification.create({
                                user_id: admin.id,
                                user_email: admin.email,
                                title, message, link: link || '',
                                is_read: false,
                                template_type: 'ADMIN_EVENT_REMINDER',
                                related_event_id: event.id,
                                push_sent: false,
                                whatsapp_sent: !!admin.phone,
                                reminder_count: 0,
                                is_resolved: false
                            });
                            
                            if (admin.push_enabled && admin.onesignal_subscription_id) {
                                pushQueue.push({
                                    subscriptionId: admin.onesignal_subscription_id,
                                    title, message, link: link || '',
                                    notificationRecordId: notifRecord.id
                                });
                            }
                        } catch (dbErr) {
                            console.warn(`[DailyNotifications] DB error for admin reminder:`, dbErr.message);
                        }
                        
                        results.event_reminders_sent++;
                    }
                }
            }
        }

        // ============================================================
        // PHASE 4: Pending Assignments Check
        // ============================================================
        console.log('[DailyNotifications] Phase 4: Checking pending assignments...');
        
        const pendingTemplate = allTemplates.find(t => t.type === 'SUPPLIER_PENDING_REMINDER');
        
        if (pendingTemplate) {
            const timingValue = pendingTemplate.timing_value || 24;
            const timingUnit = pendingTemplate.timing_unit || 'hours';
            const reminderIntervalValue = pendingTemplate.reminder_interval_value || 24;
            const reminderIntervalUnit = pendingTemplate.reminder_interval_unit || 'hours';
            const maxReminders = pendingTemplate.max_reminders || 3;
            
            const cutoffTime = new Date();
            applyTimingOffset(cutoffTime, timingUnit, -timingValue);
            
            for (const es of allEventServices) {
                if (!es.supplier_ids || !es.supplier_statuses) continue;
                
                const event = eventsMap.get(es.event_id);
                if (!event) continue;
                if (new Date(event.event_date) < now) continue;
                
                let supplierIds = [], supplierStatuses = {};
                try {
                    supplierIds = JSON.parse(es.supplier_ids);
                    supplierStatuses = JSON.parse(es.supplier_statuses);
                } catch (e) { continue; }
                
                for (const supplierId of supplierIds) {
                    if (supplierStatuses[supplierId] !== 'pending') continue;
                    
                    const supplier = suppliersMap.get(supplierId);
                    if (!supplier) continue;
                    
                    const supplierUser = allUsers.find(u => 
                        supplier.contact_emails?.includes(u.email) ||
                        (u.phone && supplier.phone === u.phone)
                    );
                    
                    // Check existing notification
                    const existingNotification = existingNotifications.find(n => 
                        n.template_type === 'SUPPLIER_PENDING_REMINDER' &&
                        n.related_event_service_id === es.id &&
                        n.related_supplier_id === supplierId
                    );
                    
                    if (existingNotification) {
                        const lastSentTime = new Date(existingNotification.created_date);
                        const reminderCutoff = new Date();
                        applyTimingOffset(reminderCutoff, reminderIntervalUnit, -reminderIntervalValue);
                        
                        if (lastSentTime > reminderCutoff) continue;
                        if (existingNotification.reminder_count >= maxReminders) continue;
                    }
                    
                    const contextData = buildEventContext(event, supplier, null);
                    const title = replacePlaceholders(pendingTemplate.title_template, contextData);
                    const message = replacePlaceholders(pendingTemplate.body_template, contextData);
                    const waMessage = replacePlaceholders(pendingTemplate.whatsapp_body_template || pendingTemplate.body_template, contextData);
                    const link = buildDeepLink(pendingTemplate.deep_link_base, pendingTemplate.deep_link_params_map, contextData);
                    
                    // WhatsApp - direct to phone (works for non-registered users)
                    if (supplier.phone && supplier.whatsapp_enabled !== false &&
                        pendingTemplate.allowed_channels?.includes('whatsapp')) {
                        whatsappQueue.push({ phone: supplier.phone, message: waMessage });
                    }
                    
                    // Push + InApp - only for registered users
                    if (supplierUser) {
                        try {
                            const notifRecord = await base44.asServiceRole.entities.InAppNotification.create({
                                user_id: supplierUser.id,
                                user_email: supplierUser.email,
                                title, message, link: link || '',
                                is_read: false,
                                template_type: 'SUPPLIER_PENDING_REMINDER',
                                related_event_id: event.id,
                                related_event_service_id: es.id,
                                related_supplier_id: supplierId,
                                push_sent: false,
                                whatsapp_sent: !!supplier.phone,
                                reminder_count: existingNotification ? (existingNotification.reminder_count || 0) + 1 : 0,
                                is_resolved: false
                            });
                            
                            if (supplierUser.push_enabled && supplierUser.onesignal_subscription_id) {
                                pushQueue.push({
                                    subscriptionId: supplierUser.onesignal_subscription_id,
                                    title, message, link: link || '',
                                    notificationRecordId: notifRecord.id
                                });
                            }
                        } catch (dbErr) {
                            console.warn(`[DailyNotifications] DB error for pending assignment:`, dbErr.message);
                        }
                    }
                    
                    results.pending_assignments_sent++;
                }
            }
        }

        // ============================================================
        // PHASE 5: Batch Send All Collected Messages
        // ============================================================
        console.log(`[DailyNotifications] Phase 5: Sending ${whatsappQueue.length} WhatsApp + ${pushQueue.length} Push messages...`);
        
        // 5a. Send WhatsApp messages sequentially (Green API doesn't support batch)
        if (GREEN_API_INSTANCE_ID && GREEN_API_TOKEN) {
            for (const wa of whatsappQueue) {
                try {
                    let cleanPhone = wa.phone.toString().replace(/[^0-9]/g, '');
                    if (cleanPhone.startsWith('05')) cleanPhone = '972' + cleanPhone.substring(1);
                    else if (cleanPhone.length === 9 && cleanPhone.startsWith('5')) cleanPhone = '972' + cleanPhone;
                    
                    const chatId = `${cleanPhone}@c.us`;
                    
                    const response = await fetch(`https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ chatId, message: wa.message })
                    });
                    
                    if (response.ok) {
                        results.pending_whatsapp_sent++;
                    } else {
                        const err = await response.text();
                        console.error(`[DailyNotifications] WA Error for ${wa.phone}: ${err}`);
                    }
                } catch (e) {
                    console.error(`[DailyNotifications] WA failed for ${wa.phone}:`, e);
                    results.errors++;
                }
            }
        }
        
        // 5b. Send Push notifications in batches via OneSignal (max 2000 per request)
        if (ONESIGNAL_APP_ID && ONESIGNAL_API_KEY && pushQueue.length > 0) {
            // Group by unique messages to batch efficiently
            const pushGroups = new Map();
            for (const push of pushQueue) {
                const key = `${push.title}|||${push.message}|||${push.link}`;
                if (!pushGroups.has(key)) {
                    pushGroups.set(key, { ...push, subscriptionIds: [], notificationRecordIds: [] });
                }
                const group = pushGroups.get(key);
                group.subscriptionIds.push(push.subscriptionId);
                if (push.notificationRecordId) group.notificationRecordIds.push(push.notificationRecordId);
            }
            
            const FORCED_BASE_URL = 'https://pulse-system.base44.app';
            
            for (const [, group] of pushGroups) {
                try {
                    let pushLink = '';
                    if (group.link) {
                        pushLink = group.link.startsWith('http') ? group.link : `${FORCED_BASE_URL}${group.link.startsWith('/') ? group.link : '/' + group.link}`;
                    }
                    
                    const oneSignalPayload = {
                        app_id: ONESIGNAL_APP_ID,
                        include_subscription_ids: group.subscriptionIds,
                        contents: { en: group.message, he: group.message },
                        headings: { en: group.title, he: group.title },
                        url: pushLink || undefined,
                        data: { link: pushLink, delayed: true }
                    };
                    
                    const response = await fetch('https://onesignal.com/api/v1/notifications', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Basic ${ONESIGNAL_API_KEY}`
                        },
                        body: JSON.stringify(oneSignalPayload)
                    });
                    
                    const result = await response.json();
                    
                    if (result.id && result.recipients > 0) {
                        results.pending_push_sent += result.recipients;
                        
                        // Update InApp records
                        for (const nId of group.notificationRecordIds) {
                            try {
                                await base44.asServiceRole.entities.InAppNotification.update(nId, { push_sent: true });
                            } catch(e) {}
                        }
                    }
                } catch (e) {
                    console.error('[DailyNotifications] Push batch error:', e);
                    results.errors++;
                }
            }
        }

        // ============================================================
        // PHASE 6: Cleanup old PendingPushNotifications
        // ============================================================
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        
        const oldNotifications = allPendingNotifications.filter(n => 
            n.is_sent && new Date(n.created_date) < sevenDaysAgo
        );
        
        for (const old of oldNotifications) {
            try {
                await base44.asServiceRole.entities.PendingPushNotification.delete(old.id);
                results.cleaned_up++;
            } catch (e) {}
        }

        console.log('[DailyNotifications] Completed:', JSON.stringify(results));
        
        return Response.json({ success: true, results });
        
    } catch (error) {
        console.error('[DailyNotifications] Critical Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});


// ============================================================
// PHASE 2 Helper: Process a scheduled_check template
// ============================================================
async function processScheduledTemplate(base44, template, allEvents, allEventServices, allSuppliers, allUsers, suppliersMap, existingNotifications, whatsappQueue, pushQueue, results) {
    if (!template.timing_value || !template.timing_unit || !template.timing_direction) return;
    
    const targetDateStart = new Date();
    const targetDateEnd = new Date();
    targetDateStart.setHours(0,0,0,0);
    targetDateEnd.setHours(23,59,59,999);
    
    const offset = template.timing_value * (template.timing_direction === 'after' ? -1 : 1);
    
    if (template.timing_direction !== 'during') {
        if (template.timing_unit === 'days') {
            targetDateStart.setDate(targetDateStart.getDate() + offset);
            targetDateEnd.setDate(targetDateEnd.getDate() + offset);
        } else if (template.timing_unit === 'weeks') {
            targetDateStart.setDate(targetDateStart.getDate() + (offset * 7));
            targetDateEnd.setDate(targetDateEnd.getDate() + (offset * 7));
        } else if (template.timing_unit === 'hours') {
            const now = new Date();
            now.setHours(now.getHours() + offset);
            targetDateStart.setTime(now.getTime() - 12 * 60 * 60000); // 12 hour window for daily run
            targetDateEnd.setTime(now.getTime() + 12 * 60 * 60000);
        } else if (template.timing_unit === 'minutes') {
            // For minute-precision, use a full-day window since we run daily
            const now = new Date();
            now.setMinutes(now.getMinutes() + offset);
            targetDateStart.setTime(now.getTime() - 12 * 60 * 60000);
            targetDateEnd.setTime(now.getTime() + 12 * 60 * 60000);
        }
    }
    
    const dateStr = targetDateStart.toISOString().split('T')[0];
    
    // Filter events matching date
    const matchingEvents = allEvents.filter(e => {
        if (!e.event_date) return false;
        const evDate = e.event_date.split('T')[0];
        return evDate === dateStr;
    });
    
    for (const event of matchingEvents) {
        // Check conditions
        const conditionsMet = checkScheduledConditions(template, event);
        if (!conditionsMet) continue;
        
        // Check duplication
        const hasDuplicate = existingNotifications.some(n => 
            n.related_event_id === event.id && n.template_type === template.type
        );
        if (hasDuplicate) continue;
        
        // Send to audiences
        await sendScheduledToAudiences(base44, template, event, allEventServices, allSuppliers, allUsers, suppliersMap, whatsappQueue, pushQueue, results);
    }
}

function checkScheduledConditions(template, event) {
    const logic = template.condition_logic || 'and';
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
    
    if (allConditions.length === 0) return true;
    
    for (const cond of allConditions) {
        const met = checkSimpleCondition(event, cond);
        if (logic === 'and' && !met) return false;
        if (logic === 'or' && met) return true;
    }
    
    return logic === 'and';
}

function checkSimpleCondition(event, cond) {
    const val = event[cond.field];
    const reqVal = cond.value;
    const op = cond.operator || 'equals';
    
    switch (op) {
        case 'equals': return String(val) == String(reqVal);
        case 'not_equals': return String(val) != String(reqVal);
        case 'greater_than': return parseFloat(val) > parseFloat(reqVal);
        case 'less_than': return parseFloat(val) < parseFloat(reqVal);
        case 'contains': return String(val || '').includes(reqVal);
        case 'is_empty': return !val || val === '';
        case 'is_not_empty': return !!val && val !== '';
        default: return String(val) == String(reqVal);
    }
}

async function sendScheduledToAudiences(base44, template, event, allEventServices, allSuppliers, allUsers, suppliersMap, whatsappQueue, pushQueue, results) {
    const audiences = template.target_audiences || [];
    const allowedChannels = template.allowed_channels || ['push'];
    const sendWA = allowedChannels.includes('whatsapp');
    const sendPush = allowedChannels.includes('push');
    
    // Supplier audience
    if (audiences.includes('supplier')) {
        const eventServices = allEventServices.filter(es => es.event_id === event.id);
        for (const es of eventServices) {
            if (!es.supplier_ids) continue;
            let supplierIds = [];
            try { supplierIds = typeof es.supplier_ids === 'string' ? JSON.parse(es.supplier_ids) : es.supplier_ids; } catch(e) {}
            
            for (const supId of supplierIds) {
                const supplier = suppliersMap.get(supId);
                if (!supplier) continue;
                
                const contextData = buildEventContext(event, supplier, null);
                const title = replacePlaceholders(template.title_template, contextData);
                const message = replacePlaceholders(template.body_template, contextData);
                const waMessage = replacePlaceholders(template.whatsapp_body_template || template.body_template, contextData);
                
                // WhatsApp - direct to phone number (no user dependency)
                if (sendWA && supplier.phone && supplier.whatsapp_enabled !== false) {
                    whatsappQueue.push({ phone: supplier.phone, message: waMessage });
                }
                
                // Push - only for registered users
                if (sendPush && supplier.contact_emails) {
                    for (const email of supplier.contact_emails) {
                        const user = allUsers.find(u => u.email === email);
                        if (user) {
                            try {
                                const notif = await base44.asServiceRole.entities.InAppNotification.create({
                                    user_id: user.id, user_email: user.email,
                                    title, message, link: '',
                                    template_type: template.type,
                                    related_event_id: event.id,
                                    related_supplier_id: supId,
                                    related_event_service_id: es.id,
                                    whatsapp_sent: sendWA && !!supplier.phone,
                                    push_sent: false, is_read: false,
                                    reminder_count: 0, is_resolved: false
                                });
                                if (user.push_enabled && user.onesignal_subscription_id) {
                                    pushQueue.push({ subscriptionId: user.onesignal_subscription_id, title, message, link: '', notificationRecordId: notif.id });
                                }
                            } catch(e) {}
                        }
                    }
                }
                
                results.scheduled_templates_processed++;
            }
        }
    }
    
    // Client audience
    if (audiences.includes('client') && event.parents) {
        const parents = typeof event.parents === 'string' ? JSON.parse(event.parents) : event.parents;
        if (Array.isArray(parents)) {
            for (const p of parents) {
                const contextData = buildEventContext(event, null, p);
                const waMessage = replacePlaceholders(template.whatsapp_body_template || template.body_template, contextData);
                
                if (sendWA && p.phone) {
                    whatsappQueue.push({ phone: p.phone, message: waMessage });
                }
                if (sendPush && p.email) {
                    const user = allUsers.find(u => u.email === p.email);
                    if (user) {
                        const title = replacePlaceholders(template.title_template, contextData);
                        const message = replacePlaceholders(template.body_template, contextData);
                        try {
                            const notif = await base44.asServiceRole.entities.InAppNotification.create({
                                user_id: user.id, user_email: user.email,
                                title, message, link: '',
                                template_type: template.type, related_event_id: event.id,
                                whatsapp_sent: sendWA && !!p.phone,
                                push_sent: false, is_read: false,
                                reminder_count: 0, is_resolved: false
                            });
                            if (user.push_enabled && user.onesignal_subscription_id) {
                                pushQueue.push({ subscriptionId: user.onesignal_subscription_id, title, message, link: '', notificationRecordId: notif.id });
                            }
                        } catch(e) {}
                    }
                }
            }
        }
    }
    
    // Admin audience
    if (audiences.includes('admin')) {
        const admins = allUsers.filter(u => u.role === 'admin');
        for (const admin of admins) {
            const contextData = buildEventContext(event, null, admin);
            const title = replacePlaceholders(template.title_template, contextData);
            const message = replacePlaceholders(template.body_template, contextData);
            const waMessage = replacePlaceholders(template.whatsapp_body_template || template.body_template, contextData);
            
            if (sendWA && admin.phone) {
                whatsappQueue.push({ phone: admin.phone, message: waMessage });
            }
            
            try {
                const notif = await base44.asServiceRole.entities.InAppNotification.create({
                    user_id: admin.id, user_email: admin.email,
                    title, message, link: '',
                    template_type: template.type, related_event_id: event.id,
                    whatsapp_sent: sendWA && !!admin.phone,
                    push_sent: false, is_read: false,
                    reminder_count: 0, is_resolved: false
                });
                if (admin.push_enabled && admin.onesignal_subscription_id) {
                    pushQueue.push({ subscriptionId: admin.onesignal_subscription_id, title, message, link: '', notificationRecordId: notif.id });
                }
            } catch(e) {}
        }
    }
}


// ============================================================
// Shared Helpers
// ============================================================

function buildEventContext(event, supplier, userOrParent) {
    return {
        event_name: event.event_name || '',
        family_name: event.family_name || '',
        event_date: formatDate(event.event_date),
        event_time: event.event_time || '',
        event_location: event.location || '',
        supplier_name: supplier ? (supplier.contact_person || supplier.supplier_name) : '',
        supplier_phone: supplier?.phone || '',
        service_name: '',
        event_id: event.id,
        admin_name: userOrParent?.full_name || userOrParent?.name || '',
        user_name: userOrParent?.full_name || userOrParent?.name || '',
        client_name: userOrParent?.name || userOrParent?.full_name || ''
    };
}

function applyTimingOffset(date, unit, value) {
    switch (unit) {
        case 'minutes': date.setMinutes(date.getMinutes() + value); break;
        case 'hours': date.setHours(date.getHours() + value); break;
        case 'days': date.setDate(date.getDate() + value); break;
        case 'weeks': date.setDate(date.getDate() + (value * 7)); break;
        case 'months': date.setMonth(date.getMonth() + value); break;
    }
}

function replacePlaceholders(template, data) {
    if (!template) return '';
    return template.replace(/\{\{?([\w_]+)\}?}/g, (match, key) => {
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
                if (value && !value.includes('{{')) params.append(key, value);
            }
            const paramString = params.toString();
            if (paramString) url += `?${paramString}`;
        } catch (e) {}
    }
    return url;
}

function formatDate(dateString) {
    if (!dateString) return '';
    return new Date(dateString).toLocaleDateString('he-IL');
}

function getIsraelEventDate(dateStr, timeStr) {
    let time = timeStr || '09:00';
    if (!time.match(/^\d{1,2}:\d{2}$/)) time = '09:00';
    const d = new Date(`${dateStr}T${time}:00Z`);
    const month = d.getMonth() + 1;
    const isSummer = month >= 4 && month <= 10;
    const offsetHours = isSummer ? 3 : 2;
    d.setHours(d.getHours() - offsetHours);
    return d;
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