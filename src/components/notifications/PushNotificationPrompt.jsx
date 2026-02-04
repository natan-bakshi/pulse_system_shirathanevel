import React, { useState, useEffect } from "react";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { base44 } from "@/api/base44Client";

const FIREBASE_PROXY_URL = 'https://pulse-notifications-6886e.web.app';
const PROMPT_DISMISSED_KEY = 'push_prompt_dismissed';
const PROMPT_DISMISSED_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 days

export default function PushNotificationPrompt({ user }) {
  const [showPrompt, setShowPrompt] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!user?.id) return;

    // Check if user already has push enabled or explicitly disabled
    const hasPushDecision = user.push_enabled === true || user.push_enabled === false;
    const hasValidSubscription = user.push_enabled === true && user.onesignal_subscription_id && user.onesignal_subscription_id.length > 10;

    // If user already made a decision, don't show prompt
    if (hasPushDecision || hasValidSubscription) {
      setShowPrompt(false);
      return;
    }

    // Check if user dismissed the prompt recently
    const dismissedData = localStorage.getItem(PROMPT_DISMISSED_KEY);
    if (dismissedData) {
      try {
        const { timestamp, userId } = JSON.parse(dismissedData);
        // Only respect dismissal if it's for this user and not expired
        if (userId === user.id && Date.now() - timestamp < PROMPT_DISMISSED_EXPIRY) {
          setShowPrompt(false);
          return;
        }
      } catch (e) {
        // Invalid data, remove it
        localStorage.removeItem(PROMPT_DISMISSED_KEY);
      }
    }

    // Check if Notification API is supported
    if (!('Notification' in window)) {
      setShowPrompt(false);
      return;
    }

    // Show prompt after a short delay (let page load first)
    const timer = setTimeout(() => {
      setShowPrompt(true);
    }, 2000);

    return () => clearTimeout(timer);
  }, [user?.id, user?.push_enabled, user?.onesignal_subscription_id]);

  const handleDismiss = () => {
    // Save dismissal with timestamp
    localStorage.setItem(PROMPT_DISMISSED_KEY, JSON.stringify({
      timestamp: Date.now(),
      userId: user?.id
    }));
    setShowPrompt(false);
  };

  const handleEnable = () => {
    setIsLoading(true);

    // Open popup window to Firebase domain for permission request
    const popup = window.open(
      `${FIREBASE_PROXY_URL}?auto=true`,
      'onesignal_popup',
      'width=500,height=600,scrollbars=yes,resizable=yes'
    );

    if (!popup) {
      alert('החלון נחסם. אנא אפשר חלונות קופצים עבור אתר זה ונסה שוב.');
      setIsLoading(false);
      return;
    }

    // Listen for result from popup
    const handleMessage = (event) => {
      if (event.origin !== FIREBASE_PROXY_URL) return;
      
      if (event.data.type === 'push_enabled') {
        window.removeEventListener('message', handleMessage);
        setIsLoading(false);

        if (event.data.success && event.data.subscriptionId) {
          const subscriptionId = event.data.subscriptionId;
          console.log('[PushPrompt] Subscription successful! ID:', subscriptionId);
          
          // Update user profile
          base44.auth.updateMe({
            push_enabled: true,
            onesignal_external_id: user?.id,
            onesignal_subscription_id: subscriptionId
          }).catch((err) => {
            console.error('[PushPrompt] Failed to update user profile:', err);
          });

          setShowPrompt(false);

          // Close popup if still open
          if (popup && !popup.closed) {
            popup.close();
          }
        } else {
          // User denied - save this decision
          base44.auth.updateMe({
            push_enabled: false
          }).catch(() => {});
          setShowPrompt(false);
        }
      }
    };

    window.addEventListener('message', handleMessage);

    // Timeout safety
    setTimeout(() => {
      window.removeEventListener('message', handleMessage);
      setIsLoading(false);
    }, 60000);
  };

  if (!showPrompt) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-80 z-50 animate-in slide-in-from-bottom-4 duration-300">
      <Card className="shadow-lg border-2 border-blue-200 bg-white">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="bg-blue-100 rounded-full p-2 shrink-0">
              <Bell className="h-5 w-5 text-blue-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="font-semibold text-gray-900 text-sm mb-1">
                הפעל התראות
              </h4>
              <p className="text-xs text-gray-600 mb-3">
                קבל עדכונים חשובים על אירועים ושיבוצים ישירות למכשיר שלך
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleEnable}
                  disabled={isLoading}
                  className="bg-blue-600 hover:bg-blue-700 text-xs"
                >
                  {isLoading ? 'טוען...' : 'הפעל עכשיו'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleDismiss}
                  disabled={isLoading}
                  className="text-xs text-gray-500"
                >
                  לא עכשיו
                </Button>
              </div>
            </div>
            <button
              onClick={handleDismiss}
              className="text-gray-400 hover:text-gray-600 p-1"
              aria-label="סגור"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}