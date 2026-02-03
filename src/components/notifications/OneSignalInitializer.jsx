import { useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * OneSignal Web SDK Initializer
 * This component initializes OneSignal for web push notifications
 * and links the current user to their OneSignal player ID
 */
export default function OneSignalInitializer({ user }) {
  const initialized = useRef(false);

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
      console.log('[Badge] Badge API not supported:', e);
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
    if (!user || initialized.current) return;

    const initOneSignal = async () => {
      try {
        // Check if running in browser
        if (typeof window === 'undefined') return;

        // Load OneSignal SDK if not already loaded
        if (!window.OneSignalDeferred) {
          window.OneSignalDeferred = [];
          
          const script = document.createElement('script');
          script.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
          script.defer = true;
          document.head.appendChild(script);
        }

        const ONESIGNAL_APP_ID = '4490c0d9-4205-4d6e-8143-39c0aa00b183';

        window.OneSignalDeferred.push(async function(OneSignal) {
          try {
            // Initialize OneSignal
            await OneSignal.init({
              appId: ONESIGNAL_APP_ID,
              allowLocalhostAsSecureOrigin: true,
              serviceWorkerParam: { scope: '/' },
              promptOptions: {
                slidedown: {
                  prompts: [{
                    type: "push",
                    autoPrompt: true,
                    text: {
                      actionMessage: "רוצה לקבל עדכונים ותזכורות חשובות?",
                      acceptButton: "כן, תודה",
                      cancelButton: "לא עכשיו"
                    },
                    delay: {
                      pageViews: 1,
                      timeDelay: 3
                    }
                  }]
                }
              },
              notifyButton: { enable: false },
              welcomeNotification: {
                title: "התראות הופעלו!",
                message: "תקבל עדכונים חשובים ותזכורות על האירועים שלך"
              }
            });

            // Link user to OneSignal
            if (user.id) {
              await OneSignal.login(user.id);
              console.log('[OneSignal] User logged in:', user.id);
              
              // Check subscription status
              const permission = await OneSignal.Notifications.permission;
              const pushSubscription = OneSignal.User.PushSubscription;
              const isOptedIn = pushSubscription.optedIn;
              const subscriptionId = pushSubscription.id;
              
              console.log('[OneSignal] Permission:', permission);
              console.log('[OneSignal] OptedIn:', isOptedIn);
              console.log('[OneSignal] Subscription ID:', subscriptionId);
              
              // If user has permission but is not opted in, opt them in
              if (permission && !isOptedIn) {
                console.log('[OneSignal] User has permission but not opted in. Opting in...');
                await pushSubscription.optIn();
              }
              
              // Save push status to user profile
              try {
                await base44.auth.updateMe({ 
                  onesignal_external_id: user.id,
                  push_enabled: permission && isOptedIn
                });
              } catch (e) {
                // Ignore update errors
              }
            }

            initialized.current = true;
            updateUnreadBadge();
            
          } catch (error) {
            console.warn('[OneSignal] Init error:', error);
          }
        });
      } catch (error) {
        console.warn('[OneSignal] Setup error:', error);
      }
    };

    initOneSignal();

    // Subscribe to notification changes to update badge
    let unsubscribe;
    if (user?.id) {
      unsubscribe = base44.entities.InAppNotification.subscribe((event) => {
        if (event.data?.user_id === user.id || event.data?.user_email === user.email) {
          updateUnreadBadge();
        }
      });
    }

    return () => {
      if (unsubscribe) unsubscribe();
      // Don't logout on unmount - user should stay logged in to OneSignal
    };
  }, [user, updateUnreadBadge]);

  return null;
}