import { useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * OneSignal Web SDK Initializer
 * This component initializes OneSignal for web push notifications
 * and links the current user to their OneSignal player ID
 */
export default function OneSignalInitializer({ user }) {
  const initialized = useRef(false);

  // Update browser badge when unread count changes
  const updateBadge = (count) => {
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
  };

  // Fetch unread count and update badge
  const updateUnreadBadge = async () => {
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
  };

  useEffect(() => {
    if (!user || initialized.current) return;

    const initOneSignal = async () => {
      try {
        // Check if OneSignal is already loaded
        if (typeof window === 'undefined') return;

        // Load OneSignal SDK if not already loaded
        if (!window.OneSignalDeferred) {
          window.OneSignalDeferred = window.OneSignalDeferred || [];
          
          // Create and append the script
          const script = document.createElement('script');
          script.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
          script.defer = true;
          document.head.appendChild(script);
        }

        // OneSignal App ID - hardcoded for reliability
        const ONESIGNAL_APP_ID = '4490c0d9-4205-4d6e-8143-39c0aa00b183';
        
        if (!ONESIGNAL_APP_ID) {
          console.log('[OneSignal] App ID not configured');
          return;
        }

        window.OneSignalDeferred.push(async function(OneSignal) {
          try {
            await OneSignal.init({
              appId: ONESIGNAL_APP_ID,
              allowLocalhostAsSecureOrigin: true, // For development
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
              notifyButton: {
                enable: false // We use our own notification bell
              },
              welcomeNotification: {
                title: "התראות הופעלו!",
                message: "תקבל עדכונים חשובים ותזכורות על האירועים שלך"
              }
            });

            // Link user to OneSignal using their Base44 user ID
            if (user.id) {
              await OneSignal.login(user.id);
              console.log('[OneSignal] User logged in:', user.id);
              
              // Optionally save the OneSignal external ID to user profile
              try {
                await base44.auth.updateMe({ onesignal_external_id: user.id });
              } catch (e) {
                // Ignore if update fails
              }
            }

            initialized.current = true;
            
            // Update badge after init
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

    // Cleanup on unmount
    return () => {
      if (unsubscribe) unsubscribe();
      if (window.OneSignalDeferred && initialized.current) {
        window.OneSignalDeferred.push(async function(OneSignal) {
          try {
            await OneSignal.logout();
          } catch (e) {
            // Ignore logout errors
          }
        });
      }
    };
  }, [user]);

  return null; // This component doesn't render anything
}