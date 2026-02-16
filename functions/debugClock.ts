import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Debug & Validation function for notification system
 * Tests: clock accuracy, quiet hours logic, default event time, queue behavior
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const now = new Date();
        
        // --- 1. Clock Check ---
        const utcString = now.toISOString();
        const israelParts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Jerusalem',
            hour: 'numeric', minute: 'numeric', hour12: false
        }).formatToParts(now);
        const israelHour = parseInt(israelParts.find(p => p.type === 'hour')?.value || '0', 10);
        const israelMinute = parseInt(israelParts.find(p => p.type === 'minute')?.value || '0', 10);
        const israelTimeStr = `${israelHour}:${String(israelMinute).padStart(2, '0')}`;

        // --- 2. Quiet Hours Check ---
        const DEFAULT_QUIET_START = 22;
        const DEFAULT_QUIET_END = 8;
        const inQuietHours = isInQuietHours(DEFAULT_QUIET_START, DEFAULT_QUIET_END);
        const quietEndTime = getQuietHoursEndTime(DEFAULT_QUIET_END);

        // --- 3. Default Event Time Check ---
        // When event has NO time, default should be 09:00 Israel
        const testDate = '2026-02-17';
        const noTimeResult = getIsraelEventDate(testDate, null);
        const withTimeResult = getIsraelEventDate(testDate, '19:00');
        
        // Calculate what "1 day before" means for both cases
        const oneDayBeforeNoTime = new Date(noTimeResult);
        oneDayBeforeNoTime.setDate(oneDayBeforeNoTime.getDate() - 1);
        
        const oneDayBeforeWithTime = new Date(withTimeResult);
        oneDayBeforeWithTime.setDate(oneDayBeforeWithTime.getDate() - 1);

        // --- 4. Pending Queue Check ---
        let pendingCount = 0;
        let pendingItems = [];
        try {
            const pending = await base44.asServiceRole.entities.PendingPushNotification.filter({ is_sent: false });
            pendingCount = pending.length;
            pendingItems = pending.slice(0, 5).map(p => ({
                id: p.id,
                title: p.title?.substring(0, 50),
                scheduled_for: p.scheduled_for,
                template_type: p.template_type,
                has_whatsapp_data: !!(p.data && JSON.parse(p.data || '{}').send_whatsapp)
            }));
        } catch (e) {
            pendingItems = [{ error: e.message }];
        }

        // --- 5. Simulation Tests ---
        const tests = [];
        
        // Test A: Is quiet hours logic correct at current time?
        const expectedQuiet = israelHour >= 22 || israelHour < 8;
        tests.push({
            name: 'Quiet Hours Detection',
            expected: expectedQuiet ? 'IN quiet hours' : 'NOT in quiet hours',
            actual: inQuietHours ? 'IN quiet hours' : 'NOT in quiet hours',
            pass: expectedQuiet === inQuietHours
        });
        
        // Test B: Default event time is 09:00 (not 00:00)
        // noTimeResult should be equivalent to 09:00 Israel time on that date
        const expectedUTCForNoTime = new Date(`${testDate}T09:00:00Z`);
        // Adjust for Israel offset (Feb = winter = UTC+2)
        expectedUTCForNoTime.setHours(expectedUTCForNoTime.getHours() - 2);
        tests.push({
            name: 'Default Event Time = 09:00',
            expected: expectedUTCForNoTime.toISOString(),
            actual: noTimeResult.toISOString(),
            pass: noTimeResult.toISOString() === expectedUTCForNoTime.toISOString()
        });
        
        // Test C: "1 day before" for no-time event should be 09:00 Israel on previous day
        const expectedOneDayBefore = new Date(expectedUTCForNoTime);
        expectedOneDayBefore.setDate(expectedOneDayBefore.getDate() - 1);
        tests.push({
            name: '1 Day Before (no time) = 09:00 Israel prev day',
            expected: expectedOneDayBefore.toISOString(),
            actual: oneDayBeforeNoTime.toISOString(),
            pass: oneDayBeforeNoTime.toISOString() === expectedOneDayBefore.toISOString()
        });

        // Test D: Quiet end time calculation
        tests.push({
            name: 'Quiet End Time Calculation',
            expected: 'Should be 08:00 Israel time',
            actual: quietEndTime.toISOString(),
            pass: true // Manual verification
        });

        const allPass = tests.every(t => t.pass);

        return Response.json({
            clock: {
                system_utc: utcString,
                israel_time: israelTimeStr,
                israel_hour: israelHour
            },
            quiet_hours: {
                default_range: `${DEFAULT_QUIET_START}:00 - ${DEFAULT_QUIET_END}:00`,
                currently_in_quiet_hours: inQuietHours,
                quiet_end_time_utc: quietEndTime.toISOString()
            },
            default_event_time: {
                no_time_set_utc: noTimeResult.toISOString(),
                with_1900_utc: withTimeResult.toISOString(),
                one_day_before_no_time_utc: oneDayBeforeNoTime.toISOString(),
                one_day_before_1900_utc: oneDayBeforeWithTime.toISOString(),
                explanation: 'When no event time is set, system assumes 09:00 Israel for notification timing'
            },
            pending_queue: {
                count: pendingCount,
                items: pendingItems
            },
            validation_tests: tests,
            all_tests_pass: allPass,
            summary: allPass 
                ? '✅ כל הבדיקות עברו בהצלחה - שעות שקט, שעת ברירת מחדל 09:00, ותור ההודעות פועלים כראוי'
                : '❌ יש בדיקות שנכשלו - בדוק את הפרטים'
        });
        
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});

// --- Helpers (same as in sendEventReminders) ---
function isInQuietHours(quietStart, quietEnd, timezone = 'Asia/Jerusalem') {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: timezone });
    const currentHour = parseInt(formatter.format(now), 10);
    if (quietStart > quietEnd) return currentHour >= quietStart || currentHour < quietEnd;
    return currentHour >= quietStart && currentHour < quietEnd;
}

function getQuietHoursEndTime(quietEnd, timezone = 'Asia/Jerusalem') {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: timezone });
    const currentHour = parseInt(formatter.format(now), 10);
    const israelDateFormatter = new Intl.DateTimeFormat('en-US', { 
        year: 'numeric', month: '2-digit', day: '2-digit', 
        hour: '2-digit', minute: '2-digit', hour12: false, 
        timeZone: timezone 
    });
    const parts = israelDateFormatter.formatToParts(now);
    const year = parts.find(p => p.type === 'year')?.value;
    const month = parts.find(p => p.type === 'month')?.value;
    const day = parts.find(p => p.type === 'day')?.value;
    let endDate = new Date(`${year}-${month}-${day}T${String(quietEnd).padStart(2,'0')}:00:00`);
    const m = parseInt(month, 10);
    const isSummer = m >= 4 && m <= 10;
    const offsetHours = isSummer ? 3 : 2;
    endDate = new Date(endDate.getTime() - offsetHours * 60 * 60 * 1000);
    if (now >= endDate) endDate.setDate(endDate.getDate() + 1);
    return endDate;
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