import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Called when admin chooses to do NOTHING after a date/time change of an event:
 * - No notifications are sent
 * - Supplier statuses are NOT changed
 * - Supplier assignments are NOT cancelled
 * - The system simply clears the date_change_pending_action flag so the dialog stops showing.
 *
 * This option is for the case where the admin updated the event date/time only inside
 * the system but does not want to disturb the suppliers' existing arrangements.
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

        // Just clear the pending flag - no other side effects
        await base44.asServiceRole.entities.Event.update(event_id, {
            date_change_pending_action: false,
            previous_event_date: '',
            previous_event_time: ''
        });

        return Response.json({ success: true });

    } catch (error) {
        console.error('[clearDateChangePendingAction] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});