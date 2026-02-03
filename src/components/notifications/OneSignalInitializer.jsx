import { useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * OneSignal Web SDK Initializer
 * This component initializes OneSignal for web push notifications
 * and links the current user to their OneSignal player ID
 */
export default function OneSignalInitializer({ user }) {
  const initialized = useRef(false);

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

        // Get OneSignal App ID from environment or use the secret
        const ONESIGNAL_APP_ID = import.meta.env.VITE_ONESIGNAL_APP_ID || '';
        
        if (!ONESIGNAL_APP_ID) {
          console.log('[OneSignal] App ID not configured in frontend');
          return;
        }

        window.OneSignalDeferred.push(async function(OneSignal) {
          try {
            await OneSignal.init({
              appId: ONESIGNAL_APP_ID,
              allowLocalhostAsSecureOrigin: true, // For development
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
                      timeDelay: 5
                    }
                  }]
                }
              },
              notifyButton: {
                enable: false // We use our own notification bell
              },
              welcomeNotification: {
                title: "תודה שנרשמת!",
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
          } catch (error) {
            console.warn('[OneSignal] Init error:', error);
          }
        });
      } catch (error) {
        console.warn('[OneSignal] Setup error:', error);
      }
    };

    initOneSignal();

    // Cleanup on unmount
    return () => {
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