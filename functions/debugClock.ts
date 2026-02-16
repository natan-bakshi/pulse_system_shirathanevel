import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Debug function to check the system's internal clock
 * Returns current time in various formats to verify timezone handling
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const now = new Date();
        
        // Raw UTC
        const utcString = now.toISOString();
        const utcHour = now.getUTCHours();
        const utcMinute = now.getUTCMinutes();
        
        // Israel time using Intl
        const israelFormatter = new Intl.DateTimeFormat('he-IL', {
            timeZone: 'Asia/Jerusalem',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        const israelTimeString = israelFormatter.format(now);
        
        // Extract Israel hour
        const israelParts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Jerusalem',
            hour: 'numeric',
            minute: 'numeric',
            hour12: false
        }).formatToParts(now);
        
        const israelHour = parseInt(israelParts.find(p => p.type === 'hour')?.value || '0', 10);
        const israelMinute = parseInt(israelParts.find(p => p.type === 'minute')?.value || '0', 10);
        
        // Day of week in Israel
        const dayFormatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Jerusalem',
            weekday: 'long'
        });
        const israelDay = dayFormatter.format(now);
        
        // Check what getIsraelEventDate would return for a test event
        // Simulating: event on 2026-02-17 with no time set
        const testEventDate = '2026-02-17';
        const testNoTime = getIsraelEventDate(testEventDate, null);
        const testWithTime = getIsraelEventDate(testEventDate, '19:00');
        
        // Offset calculation
        const offsetMs = getIsraelOffset(now);
        const offsetHours = offsetMs / (60 * 60 * 1000);

        return Response.json({
            system_utc: utcString,
            system_utc_hour: `${utcHour}:${String(utcMinute).padStart(2, '0')}`,
            israel_time_formatted: israelTimeString,
            israel_hour: israelHour,
            israel_minute: israelMinute,
            israel_day_of_week: israelDay,
            israel_utc_offset_hours: offsetHours,
            test_event_no_time: {
                input: `${testEventDate} (no time)`,
                result_utc: testNoTime.toISOString(),
                description: 'What UTC time the system thinks the event is at'
            },
            test_event_with_time: {
                input: `${testEventDate} 19:00`,
                result_utc: testWithTime.toISOString(),
                description: 'What UTC time the system thinks 19:00 Israel is'
            },
            analysis: {
                current_israel_time: `${israelHour}:${String(israelMinute).padStart(2, '0')}`,
                is_quiet_hours: israelHour >= 22 || israelHour < 8,
                note: 'If israel_hour does not match your actual clock, the system has a timezone issue'
            }
        });
        
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});

function getIsraelEventDate(dateStr, timeStr) {
    let time = timeStr || '00:00';
    if (!time.match(/^\d{1,2}:\d{2}$/)) time = '00:00';
    
    const d = new Date(`${dateStr}T${time}:00Z`);
    
    const month = d.getMonth() + 1;
    const isSummer = month >= 4 && month <= 10;
    const offsetHours = isSummer ? 3 : 2;
    
    d.setHours(d.getHours() - offsetHours);
    return d;
}

function getIsraelOffset(date) {
    // Use Intl to get actual offset
    const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
    const israelDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
    return israelDate - utcDate;
}