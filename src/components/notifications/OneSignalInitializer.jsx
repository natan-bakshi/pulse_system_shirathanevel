import { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

const FIREBASE_PROXY_ORIGIN = 'https://pulse-notifications-6886e.web.app';

/**
 * OneSignal Initializer via Firebase Proxy
 * Syncs Base44 user ID with OneSignal external_id through iframe postMessage
 */
export default function OneSignalInitializer({ user }) {
  const [oneSignalReady, setOneSignalReady] = useState(false);

  // Update browser badge when unread count changes
  const updateBadge = useCallback((count) => {
    try {
      if ('setAppBadge' in navigator) {
        if (count > 0) {
          navigator.setAppBadge(count);
        } else {
          navigator.clearAppBadge();
        }
      }
    } catch (e) {
      // Badge API not supported - silent fail
    }
  }, []);

  // Fetch unread count and update badge
  const updateUnreadBadge = useCallback(async () => {
    if (!user?.id) return;
    try {
      const notifications = await base44.entities.InAppNotification.filter(
        { user_id: user.id, is_read: false },
        '-created_date',
        100
      );
      updateBadge(notifications.length);
    } catch (e) {
      console.warn('[Badge] Failed to fetch unread count:', e);
    }
  }, [user?.id, updateBadge]);

  useEffect(() => {
    if (!user?.id) return;

    const handleMessage = (event) => {
      // Security: only accept messages from Firebase proxy
      if (event.origin !== FIREBASE_PROXY_ORIGIN) return;

      if (event.data.type === 'onesignal_ready') {
        console.log('[OneSignal] Ready via Firebase proxy');
        setOneSignalReady(true);

        // Immediately sync user ID with OneSignal and request subscription status
        const frame = document.getElementById('onesignal-subscribe-frame');
        if (frame?.contentWindow) {
          frame.contentWindow.postMessage({
            action: 'setUser',
            userId: user.id
          }, FIREBASE_PROXY_ORIGIN);
          
          console.log('[OneSignal] User ID synced:', user.id);
          
          // Save external_id to user profile
          base44.auth.updateMe({
            onesignal_external_id: user.id
          }).catch(() => {});

          // Request current subscription status to sync
          setTimeout(() => {
            frame.contentWindow.postMessage({
              action: 'getSubscriptionStatus',
              userId: user.id
            }, FIREBASE_PROXY_ORIGIN);
          }, 1000);
        }
      }

      if (event.data.type === 'subscription_status') {
        console.log('[OneSignal] Subscription status received:', event.data);
        
        // Update user profile with subscription status - CRITICAL for push delivery
        if (event.data.subscribed && event.data.subscriptionId) {
          console.log('[OneSignal] Saving subscription ID to profile:', event.data.subscriptionId);
          base44.auth.updateMe({
            push_enabled: true,
            onesignal_subscription_id: event.data.subscriptionId
          }).then(() => {
            console.log('[OneSignal] User profile updated with subscription ID');
          }).catch((err) => {
            console.error('[OneSignal] Failed to update user profile:', err);
          });
        } else if (event.data.subscribed === false) {
          console.log('[OneSignal] User not subscribed');
        }
      }
    };

    window.addEventListener('message', handleMessage);

    // Update badge on mount
    updateUnreadBadge();

    // Subscribe to notification changes to update badge
    let unsubscribe;
    unsubscribe = base44.entities.InAppNotification.subscribe((event) => {
      if (event.data?.user_id === user.id || event.data?.user_email === user.email) {
        updateUnreadBadge();
      }
    });

    return () => {
      window.removeEventListener('message', handleMessage);
      if (unsubscribe) unsubscribe();
    };
  }, [user?.id, user?.email, updateUnreadBadge]);

  return null;
}