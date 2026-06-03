import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * scheduleTaskReminder
 * ----------------------------------------------------------------------------
 * מחליף את Phase 6.5 הישן (בדיקת משימות יומית) במודל מונחה-אירועים.
 * מופעל כטריגר entity על Task create/update.
 *
 * כשמשימה נוצרת/מתעדכנת עם due_date עתידי והיא לא הושלמה, מתזמן תזכורת
 * (TASK_DUE_REMINDER) למועד ה-due_date עצמו, עם condition_type='task_still_pending'.
 *
 * "מחק וצור מחדש": בכל עדכון מוחקים תזמון קודם של אותה משימה ויוצרים מחדש
 * (כדי לתמוך בשינוי due_date / שינוי מוקצים / השלמה).
 *
 * הבדיקה הסופית (האם המשימה עדיין פתוחה) נעשית שוב בזמן השליחה
 * ב-processScheduledPushNotifications (Lazy Evaluation).
 *
 * נשלט במלואו ע"י התבנית: is_active, allowed_channels, title_template,
 * body_template, whatsapp_body_template, deep_link_base, deep_link_params_map,
 * admin_recipient_ids. בנוסף נשלט במתג tasks_system_enabled ב-AppSettings.
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const payload = await req.json();

        const { event, data } = payload;

        let taskId = payload.taskId;
        if (!taskId && data) taskId = data.id;
        if (!taskId && event?.entity_id) taskId = event.entity_id;

        if (!taskId) {
            return Response.json({ skipped: true, reason: 'No taskId' });
        }

        // טוענים את המשימה (מקור אמת)
        let task = null;
        try {
            task = await base44.asServiceRole.entities.Task.get(taskId);
        } catch (e) {
            // המשימה נמחקה - מוחקים תזמונים קיימים שלה
            await deleteExistingTaskPending(base44, taskId);
            return Response.json({ skipped: true, reason: 'Task not found (deleted) - cleaned up' });
        }
        if (!task) {
            await deleteExistingTaskPending(base44, taskId);
            return Response.json({ skipped: true, reason: 'Task not found - cleaned up' });
        }

        // "מחק וצור מחדש": בכל ריצה מוחקים תחילה תזמונים קודמים של המשימה.
        await deleteExistingTaskPending(base44, taskId);

        // אם המשימה הושלמה / ללא due_date / due_date בעבר - לא מתזמנים.
        if (task.is_completed) {
            return Response.json({ skipped: true, reason: 'Task completed' });
        }
        if (!task.due_date) {
            return Response.json({ skipped: true, reason: 'Task has no due_date' });
        }
        const dueDate = new Date(task.due_date);
        if (isNaN(dueDate.getTime())) {
            return Response.json({ skipped: true, reason: 'Invalid due_date' });
        }
        if (dueDate.getTime() < Date.now()) {
            return Response.json({ skipped: true, reason: 'due_date in the past' });
        }

        // בדיקת מתג מערכת המשימות + תבנית
        const [templates, allUsers, appSettings] = await Promise.all([
            base44.asServiceRole.entities.NotificationTemplate.filter({ is_active: true }),
            base44.asServiceRole.entities.User.list(),
            base44.asServiceRole.entities.AppSettings.list()
        ]);

        const tasksEnabledSetting = appSettings.find(s => s.setting_key === 'tasks_system_enabled');
        const tasksSystemEnabled = !tasksEnabledSetting || tasksEnabledSetting.setting_value !== 'false';
        if (!tasksSystemEnabled) {
            return Response.json({ skipped: true, reason: 'Tasks system disabled' });
        }

        const template = templates.find(t => t.type === 'TASK_DUE_REMINDER');
        if (!template) {
            return Response.json({ skipped: true, reason: 'Template TASK_DUE_REMINDER not active' });
        }

        const adminUsers = allUsers.filter(u => u.role === 'admin');
        const templateIds = template.admin_recipient_ids;
        const templateFilteredAdmins = (Array.isArray(templateIds) && templateIds.length > 0)
            ? adminUsers.filter(a => templateIds.includes(a.id))
            : adminUsers;

        // קביעת מנהלים יעד: אם יש assignee_ids - רק הם (מסוננים לפי התבנית); אחרת כולם.
        let recipients = [];
        if (task.assignee_ids && task.assignee_ids.length > 0) {
            recipients = templateFilteredAdmins.filter(u => task.assignee_ids.includes(u.id));
        } else {
            recipients = templateFilteredAdmins;
        }
        if (recipients.length === 0) {
            return Response.json({ skipped: true, reason: 'No recipients' });
        }

        const allowedChannels = template.allowed_channels || ['whatsapp'];

        // בניית תוכן ההודעה (זהה ללוגיקה הישנה למשימה יחידה)
        let event_obj = null;
        if (task.event_id) {
            try { event_obj = await base44.asServiceRole.entities.Event.get(task.event_id); } catch {}
        }
        const eventName = event_obj ? (event_obj.event_name || event_obj.family_name || '') : '';
        const eventLine = eventName ? `\n📅 אירוע: ${eventName}` : '';
        const priorityLabel = task.priority === 'high' ? '🔴 דחיפות גבוהה' :
                              task.priority === 'low' ? '🔵 דחיפות נמוכה' : '';
        const priorityLine = priorityLabel ? '\n' + priorityLabel : '';
        const dueTime = (() => {
            const hh = String(dueDate.getHours()).padStart(2, '0');
            const mm = String(dueDate.getMinutes()).padStart(2, '0');
            const hasTime = !(hh === '00' && mm === '00');
            return hasTime ? ` ${hh}:${mm}` : '';
        })();
        const dueDateFormatted = formatDate(task.due_date) + dueTime;
        const descriptionBlock = task.description ? '\n\n' + task.description : '';

        const contextData = {
            task_title: task.title || '',
            task_due_date: dueDateFormatted,
            task_description: task.description || '',
            task_priority: task.priority || 'normal',
            task_event_name: eventName,
            task_priority_line: priorityLine,
            task_event_line: eventLine,
            task_description_block: descriptionBlock,
            event_id: task.event_id || ''
        };

        const title = replacePlaceholders(template.title_template, contextData);
        const message = replacePlaceholders(template.body_template, contextData);
        const waMessage = replacePlaceholders(template.whatsapp_body_template || template.body_template, contextData);
        const link = buildDeepLink(template.deep_link_base, template.deep_link_params_map, contextData);

        // מועד מתוזמן: ה-due_date עצמו
        const scheduledFor = dueDate;

        let scheduled = 0;
        for (const admin of recipients) {
            const waData = (allowedChannels.includes('whatsapp') && admin.phone)
                ? JSON.stringify({ send_whatsapp: true, whatsapp_message: waMessage, phone: admin.phone })
                : JSON.stringify({});

            await base44.asServiceRole.entities.PendingPushNotification.create({
                user_id: admin.id,
                user_email: admin.email,
                title, message, link: link || '',
                scheduled_for: scheduledFor.toISOString(),
                template_type: 'TASK_DUE_REMINDER',
                is_sent: false,
                condition_type: 'task_still_pending',
                related_task_id: taskId,
                related_event_id: task.event_id || '',
                data: waData
            });
            scheduled++;
        }

        return Response.json({ success: true, scheduled });

    } catch (error) {
        console.error('[scheduleTaskReminder] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});

// ============================================================
// Helpers
// ============================================================

// מוחק תזמוני TASK_DUE_REMINDER קיימים (שטרם נשלחו) של משימה ספציפית.
async function deleteExistingTaskPending(base44, taskId) {
    try {
        const existing = await base44.asServiceRole.entities.PendingPushNotification.filter({
            related_task_id: taskId,
            is_sent: false
        });
        for (const rec of existing) {
            if (rec.template_type === 'TASK_DUE_REMINDER') {
                try { await base44.asServiceRole.entities.PendingPushNotification.delete(rec.id); } catch {}
            }
        }
    } catch (e) {
        console.warn('[scheduleTaskReminder] cleanup error:', e.message);
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
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `\u200E${dd}/${mm}/${yyyy}`;
}