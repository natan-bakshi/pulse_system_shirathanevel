import React, { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

const FIREBASE_PROXY_ORIGIN = 'https://pulse-notifications-6886e.web.app';

export default function PushNotificationManager() {
  const [permissionStatus, setPermissionStatus] = useState('default');
  const [loading, setLoading] = useState(false);

  const requestNotificationPermission = useCallback(async () => {
    try {
      setLoading(true);

      const frame = document.getElementById('onesignal-subscribe-frame');
      if (!frame) {
        console.warn('[OneSignal] Bridge iframe not found');
        setLoading(false);
        return;
      }

      // Request permission via iframe
      frame.contentWindow.postMessage({
        action: 'requestPermission'
      }, FIREBASE_PROXY_ORIGIN);

      // Listen for result
      const handleResult = (event) => {
        if (event.origin !== FIREBASE_PROXY_ORIGIN) return;

        if (event.data.type === 'permission_result') {
          window.removeEventListener('message', handleResult);
          setLoading(false);

          if (event.data.granted) {
            const subscriptionId = event.data.subscriptionId;
            console.log('[OneSignal] Subscription successful. ID:', subscriptionId);
            setPermissionStatus('granted');
            
            // Update user profile with subscription ID - CRITICAL for push delivery
            base44.auth.updateMe({
              push_enabled: true,
              onesignal_subscription_id: subscriptionId || ''
            }).then(() => {
              console.log('[OneSignal] User profile updated with subscription');
            }).catch((err) => {
              console.error('[OneSignal] Failed to update profile:', err);
            });
          } else {
            console.log('[OneSignal] Permission denied by user');
            setPermissionStatus('denied');
          }
        }

        if (event.data.type === 'permission_error') {
          window.removeEventListener('message', handleResult);
          setLoading(false);
          console.error('[OneSignal] Error:', event.data.error);
        }
      };

      window.addEventListener('message', handleResult);

      // Timeout safety
      setTimeout(() => {
        window.removeEventListener('message', handleResult);
        if (loading) {
          setLoading(false);
          console.warn('[OneSignal] Request timeout');
        }
      }, 30000);

    } catch (error) {
      console.error('[OneSignal] Subscribe error:', error);
      setLoading(false);
    }
  }, [loading]);

  useEffect(() => {
    if ('Notification' in window) {
      setPermissionStatus(Notification.permission);
      
      // If permission already granted, just update status
      if (Notification.permission === 'granted') {
        // The iframe will handle the actual OneSignal subscription
        console.log('[Push] Permission already granted');
      }
    }
  }, []);

  return null; // Component renders nothing
}