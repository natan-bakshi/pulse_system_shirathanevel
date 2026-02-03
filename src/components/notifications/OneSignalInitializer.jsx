import { useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * OneSignal Web SDK Initializer
 * Based on OneSignal AI recommendations for proper subscription handling
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
            // Step 1: Initialize OneSignal first
            await OneSignal.init({
              appId: ONESIGNAL_APP_ID,
              allowLocalhostAsSecureOrigin: true,
              serviceWorkerParam: { scope: '/' },
              promptOptions: {
                slidedown: {
                  prompts: [{
                    type: "push",
                    autoPrompt: false, // Don't auto-prompt, we'll handle it
                    text: {
                      actionMessage: "רוצה לקבל עדכונים ותזכורות חשובות?",
                      acceptButton: "כן, תודה",
                      cancelButton: "לא עכשיו"
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

            // Step 2: Login the user with external_id
            if (user.id) {
              await OneSignal.login(user.id);
              console.log('[OneSignal] User logged in with external_id:', user.id);
            }

            // Step 3: Set up subscription change listener (as recommended by OneSignal AI)
            OneSignal.User.PushSubscription.addEventListener('change', async (event) => {
              console.log('[OneSignal] Subscription changed:', {
                id: event.current.id,
                optedIn: event.current.optedIn,
                token: event.current.token ? 'exists' : 'none'
              });
              
              // When subscription becomes ready, save to user profile
              if (event.current.id && event.current.optedIn) {
                console.log('[OneSignal] User is now fully targetable via external_id');
                try {
                  await base44.auth.updateMe({
                    onesignal_external_id: user.id,
                    push_enabled: true,
                    onesignal_subscription_id: event.current.id
                  });
                } catch (e) {
                  // Ignore update errors
                }
              }
            });

            // Step 4: Check if we need to request permission
            const nativePermission = Notification.permission;
            const pushSubscription = OneSignal.User.PushSubscription;
            
            console.log('[OneSignal] Current state:', {
              nativePermission,
              optedIn: pushSubscription.optedIn,
              subscriptionId: pushSubscription.id
            });

            // If permission not yet granted, show the prompt after a short delay
            if (nativePermission === 'default') {
              // Wait for user to settle on page before prompting
              setTimeout(async () => {
                try {
                  console.log('[OneSignal] Showing permission prompt...');
                  await OneSignal.Slidedown.promptPush();
                } catch (e) {
                  console.log('[OneSignal] Prompt dismissed or failed');
                }
              }, 3000);
            }
            // If permission granted but not opted in, opt them in
            else if (nativePermission === 'granted' && !pushSubscription.optedIn) {
              console.log('[OneSignal] Permission granted, opting in...');
              try {
                await pushSubscription.optIn();
              } catch (e) {
                console.warn('[OneSignal] OptIn failed:', e);
              }
            }

            // Save initial status
            try {
              await base44.auth.updateMe({
                onesignal_external_id: user.id,
                push_enabled: pushSubscription.optedIn && !!pushSubscription.id,
                onesignal_subscription_id: pushSubscription.id || ''
              });
            } catch (e) {
              // Ignore
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