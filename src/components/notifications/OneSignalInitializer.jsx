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
    if (!user || initialized.current) return;

    const initOneSignal = async () => {
      try {
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
                      timeDelay: 2
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

            console.log('[OneSignal] SDK initialized');

            // Link user to OneSignal with external_id
            if (user.id) {
              // Login the user
              await OneSignal.login(user.id);
              console.log('[OneSignal] User logged in:', user.id);
              
              // Wait for subscription to propagate
              await new Promise(resolve => setTimeout(resolve, 1000));
              
              // Check if we have notification permission
              const nativePermission = Notification.permission;
              console.log('[OneSignal] Native permission:', nativePermission);
              
              // Get OneSignal permission and subscription status
              const permission = await OneSignal.Notifications.permission;
              const pushSubscription = OneSignal.User.PushSubscription;
              
              console.log('[OneSignal] OneSignal permission:', permission);
              console.log('[OneSignal] Push subscription object:', {
                optedIn: pushSubscription.optedIn,
                id: pushSubscription.id,
                token: pushSubscription.token?.substring(0, 20) + '...'
              });
              
              // If native permission is granted but not opted in, try to opt in
              if (nativePermission === 'granted' && !pushSubscription.optedIn) {
                console.log('[OneSignal] Native permission granted but not opted in. Opting in...');
                try {
                  await pushSubscription.optIn();
                  
                  // Wait for opt-in to complete
                  await new Promise(resolve => setTimeout(resolve, 500));
                  
                  console.log('[OneSignal] After optIn:', {
                    optedIn: pushSubscription.optedIn,
                    id: pushSubscription.id
                  });
                } catch (optInErr) {
                  console.warn('[OneSignal] OptIn error:', optInErr);
                }
              }
              
              // If still not subscribed and permission is default, show the prompt
              if (nativePermission === 'default') {
                console.log('[OneSignal] Showing notification prompt...');
                try {
                  await OneSignal.Slidedown.promptPush();
                } catch (promptErr) {
                  // User may have dismissed - that's ok
                  console.log('[OneSignal] Prompt dismissed or failed:', promptErr);
                }
              }
              
              // Final status check
              const finalOptedIn = pushSubscription.optedIn;
              const finalSubId = pushSubscription.id;
              
              console.log('[OneSignal] Final subscription status:', { 
                optedIn: finalOptedIn, 
                id: finalSubId 
              });
              
              // Save status to user profile
              try {
                await base44.auth.updateMe({ 
                  onesignal_external_id: user.id,
                  push_enabled: finalOptedIn,
                  onesignal_subscription_id: finalSubId || ''
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
    };
  }, [user, updateUnreadBadge]);

  return null;
}