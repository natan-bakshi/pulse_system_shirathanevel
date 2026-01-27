import React, { useEffect, useState, useCallback } from 'react';
import { User } from '@/entities/User';
import { registerPushToken } from '@/functions/registerPushToken';

export default function PushNotificationManager() {
  const [permissionStatus, setPermissionStatus] = useState('default');

  const registerForPushNotifications = useCallback(async () => {
    try {
      if (!('serviceWorker' in navigator) || !('Notification' in window)) return;
      
      // Create service worker as a separate file instead of data URI to avoid protocol issues
      const swRegistration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      const { getMessaging, getToken, onMessage } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging.js');
      const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
      const firebaseConfig = {
        projectId: "pulse-notifications-6886e",
        messagingSenderId: "384694784785",
        appId: "1:384694784785:web:dummy",
        apiKey: "AIzaSyDummy-key-for-messaging"
      };
      const app = initializeApp(firebaseConfig);
      const messaging = getMessaging(app);

      const vapidKey = "BKyI-NQHgUQk_GfWxtUlBdJfzY7Loe2HQ-v3tdWKE6-_ysKo7K7gQFjpJEE_rZfwgW4SP8sOP_hPKIjMQKbR5MM";
      const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: swRegistration });

      if (token) {
        await registerPushToken({ token, action: 'add' });
        onMessage(messaging, (payload) => {
          if (Notification.permission === 'granted') {
            new Notification(payload.notification?.title || 'התראה חדשה', {
              body: payload.notification?.body || 'יש לך עדכון חדש', 
              icon: '/favicon.ico'
            });
          }
        });
      }
    } catch (error) {
      // Silently handle errors to avoid disrupting the app
      console.log('Push notifications not available in this environment');
    }
  }, []);

  const requestNotificationPermission = useCallback(async () => {
    try {
      if (!('Notification' in window)) return;
      const permission = await Notification.requestPermission();
      setPermissionStatus(permission);
      if (permission === 'granted') {
        await registerForPushNotifications();
      }
    } catch (error) {
      // Silently handle errors
      console.log('Notification permission not available');
    }
  }, [registerForPushNotifications]);

  useEffect(() => {
    if ('Notification' in window) {
      setPermissionStatus(Notification.permission);
      if (Notification.permission === 'granted') {
        registerForPushNotifications();
      }
    }
  }, [registerForPushNotifications]);

  return null; // Component renders nothing
}