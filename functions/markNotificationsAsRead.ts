import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Marks all unread notifications for a user as read
 * Called when user clicks on the notification bell
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }
        
        console.log(`[MarkRead] Marking all notifications as read for user ${user.id}`);
        
        // Get all unread notifications for this user
        const unreadNotifications = await base44.entities.InAppNotification.filter({
            user_id: user.id,
            is_read: false
        });
        
        console.log(`[MarkRead] Found ${unreadNotifications.length} unread notifications`);
        
        // Mark each as read
        let updatedCount = 0;
        for (const notification of unreadNotifications) {
            try {
                await base44.asServiceRole.entities.InAppNotification.update(notification.id, {
                    is_read: true
                });
                updatedCount++;
            } catch (e) {
                console.warn(`[MarkRead] Could not update notification ${notification.id}:`, e.message);
            }
        }
        
        return Response.json({
            success: true,
            marked_as_read: updatedCount
        });
        
    } catch (error) {
        console.error('[MarkRead] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});