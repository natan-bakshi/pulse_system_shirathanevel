import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    try {
        // Authenticate user
        await base44.auth.me();
    } catch(e) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        // Get all events that are not in 'quote' status
        const allEvents = await base44.asServiceRole.entities.Event.list();
        
        // Filter events that need status update
        const eventsToUpdate = [];
        const now = new Date();
        
        const eventsToComplete = [];
        const eventsToCancelled = [];
        
        for (const event of allEvents) {
            // Skip events that are already completed or cancelled
            if (event.status === 'completed' || event.status === 'cancelled') {
                continue;
            }
            
            // Check if event has passed
            const eventDate = new Date(event.event_date);
            
            // If event has time, add it to the date
            if (event.event_time) {
                const [hours, minutes] = event.event_time.split(':').map(num => parseInt(num, 10));
                eventDate.setHours(hours, minutes, 0, 0);
            } else {
                // If no time specified, consider event as passed at end of day
                eventDate.setHours(23, 59, 59, 999);
            }
            
            // If event date + time has passed
            if (eventDate < now) {
                const eventInfo = {
                    id: event.id,
                    event_name: event.event_name,
                    family_name: event.family_name,
                    event_date: event.event_date,
                    event_time: event.event_time,
                    current_status: event.status
                };
                
                // Quote events that passed -> cancelled
                if (event.status === 'quote') {
                    eventsToCancelled.push(eventInfo);
                } else {
                    // Other statuses (confirmed, in_progress) -> completed
                    eventsToComplete.push(eventInfo);
                }
            }
        }
        
        // Update expired quote events to 'cancelled' status
        const cancelPromises = eventsToCancelled.map(event => 
            base44.asServiceRole.entities.Event.update(event.id, { status: 'cancelled' })
        );
        
        // Update other expired events to 'completed' status
        const completePromises = eventsToComplete.map(event => 
            base44.asServiceRole.entities.Event.update(event.id, { status: 'completed' })
        );
        
        const updatePromises = [...cancelPromises, ...completePromises];
        
        // Combine for backward compatibility
        eventsToUpdate.push(...eventsToComplete, ...eventsToCancelled);
        
        if (updatePromises.length > 0) {
            await Promise.all(updatePromises);
        }
        
        return Response.json({
            success: true,
            updated_count: eventsToUpdate.length,
            updated_events: eventsToUpdate
        });
        
    } catch (error) {
        console.error('Error updating expired events:', error);
        return Response.json({ 
            error: 'Failed to update expired events', 
            details: error.message 
        }, { status: 500 });
    }
});