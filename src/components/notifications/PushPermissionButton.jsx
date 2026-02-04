import React, { useState, useEffect, useCallback } from "react";
import { Bell, BellOff, Check, AlertTriangle, Loader2, Smartphone, Monitor, Info, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";

const FIREBASE_PROXY_ORIGIN = 'https://pulse-notifications-6886e.web.app';

export default function PushPermissionButton({ user }) {
  const [permissionStatus, setPermissionStatus] = useState('unknown');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [deviceType, setDeviceType] = useState('desktop');
  const [debugInfo, setDebugInfo] = useState(null);

  // Detect device type
  useEffect(() => {
    const userAgent = navigator.userAgent.toLowerCase();
    if (/iphone|ipad|ipod/.test(userAgent)) {
      setDeviceType('ios');
    } else if (/android/.test(userAgent)) {
      setDeviceType('android');
    } else {
      setDeviceType('desktop');
    }
  }, []);

  // Check current permission status
  useEffect(() => {
    checkPermissionStatus();
  }, [user?.push_enabled, user?.onesignal_subscription_id]);

  const checkPermissionStatus = useCallback(async () => {
    try {
      // Check if Notification API is supported
      if (!('Notification' in window)) {
        setPermissionStatus('unsupported');
        setIsSubscribed(false);
        return;
      }

      // Priority: Check user profile first (push_enabled is the source of truth)
      // User must have both push_enabled=true AND a valid subscription ID
      const hasValidSubscription = user?.push_enabled === true && user?.onesignal_subscription_id && user.onesignal_subscription_id.length > 10;
      
      if (hasValidSubscription) {
        setPermissionStatus('granted');
        setIsSubscribed(true);
        setDebugInfo({
          permission: 'granted (via profile)',
          push_enabled: true,
          subscriptionId: user.onesignal_subscription_id.substring(0, 10) + '...',
          nativePermission: Notification.permission
        });
        return;
      }

      // If push_enabled is true but no subscription ID, need to re-subscribe
      if (user?.push_enabled === true && !hasValidSubscription) {
        console.log('[Push] User has push_enabled but no valid subscription ID, needs re-subscription');
        setPermissionStatus('default');
        setIsSubscribed(false);
        setDebugInfo({
          permission: 'needs_resubscription',
          push_enabled: true,
          subscriptionId: user?.onesignal_subscription_id || 'missing',
          nativePermission: Notification.permission
        });
        return;
      }

      // User hasn't subscribed yet - show button to enable
      // IMPORTANT: Do NOT rely on Notification.permission here because iframe is on Firebase domain
      // Only show as 'denied' if user explicitly set push_enabled to false
      if (user?.push_enabled === false) {
        setPermissionStatus('denied');
        setIsSubscribed(false);
      } else {
        // Default state - user hasn't set up push yet, show enable button
        setPermissionStatus('default');
        setIsSubscribed(false);
      }

      setDebugInfo({
        permission: 'not_set',
        push_enabled: user?.push_enabled ?? 'not set',
        subscriptionId: user?.onesignal_subscription_id || 'none',
        nativePermission: Notification.permission
      });
    } catch (e) {
      console.warn('[Push] Permission check failed:', e);
      setIsSubscribed(false);
    }
  }, [user?.push_enabled, user?.onesignal_subscription_id]);

  const requestPermission = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      // First, check if notifications are supported
      if (!('Notification' in window)) {
        setError('הדפדפן שלך לא תומך בהתראות Push');
        setIsLoading(false);
        return;
      }

      // Special handling for iOS Safari
      if (deviceType === 'ios') {
        // Check if running as PWA (standalone mode)
        const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
        
        if (!isStandalone) {
          setError('באייפון, יש להוסיף את האתר למסך הבית כדי לקבל התראות. לחץ על כפתור השיתוף (↑) ובחר "הוסף למסך הבית".');
          setIsLoading(false);
          return;
        }
      }

      // Find the iframe
      const frame = document.getElementById('onesignal-subscribe-frame');
      if (!frame) {
        setError('שגיאה בטעינת מערכת ההתראות. נא לרענן את הדף.');
        setIsLoading(false);
        return;
      }

      // Set up message listener for the result
      const handleResult = (event) => {
        if (event.origin !== FIREBASE_PROXY_ORIGIN) return;

        if (event.data.type === 'permission_result') {
          window.removeEventListener('message', handleResult);
          setIsLoading(false);

          if (event.data.granted) {
            const subscriptionId = event.data.subscriptionId;
            console.log('[Push] Subscription successful via Firebase proxy. Subscription ID:', subscriptionId);
            setPermissionStatus('granted');
            setIsSubscribed(true);
            
            // Update user profile with subscription ID - this is critical for push delivery
            base44.auth.updateMe({
              push_enabled: true,
              onesignal_external_id: user?.id,
              onesignal_subscription_id: subscriptionId || ''
            }).then(() => {
              console.log('[Push] User profile updated with subscription ID');
            }).catch((err) => {
              console.error('[Push] Failed to update user profile:', err);
            });

            setDebugInfo({
              permission: 'granted',
              push_enabled: true,
              subscriptionId: subscriptionId ? subscriptionId.substring(0, 10) + '...' : 'none',
              nativePermission: 'granted'
            });
          } else {
            console.log('[Push] Permission denied by user');
            setPermissionStatus('denied');
            // Update user profile to reflect denied state
            base44.auth.updateMe({
              push_enabled: false
            }).catch(() => {});
            setError('הגישה להתראות נדחתה. יש לשנות את ההגדרות בדפדפן.');
          }
        }

        if (event.data.type === 'permission_error') {
          window.removeEventListener('message', handleResult);
          setIsLoading(false);
          console.error('[Push] Error:', event.data.error);
          setError('שגיאה בהרשמה: ' + event.data.error);
        }
      };

      window.addEventListener('message', handleResult);

      // Request permission via iframe (postMessage)
      // IMPORTANT: The permission dialog appears for the Firebase domain, not Base44 domain
      // This is because the Service Worker is registered on Firebase domain
      // The user needs to allow notifications for pulse-notifications-6886e.web.app
      frame.contentWindow.postMessage({
        action: 'requestPermission',
        userId: user?.id
      }, FIREBASE_PROXY_ORIGIN);

      console.log('[Push] Permission request sent to Firebase proxy iframe');
      console.log('[Push] NOTE: Permission dialog will appear for Firebase domain (pulse-notifications-6886e.web.app)');

      // Timeout safety - 30 seconds
      setTimeout(() => {
        window.removeEventListener('message', handleResult);
        if (isLoading) {
          setIsLoading(false);
          console.warn('[Push] Request timeout');
        }
      }, 30000);

    } catch (e) {
      console.error('[Push] Request error:', e);
      setError('שגיאה בבקשת הרשאות: ' + e.message);
      setIsLoading(false);
    }
  }, [deviceType, user?.id, isLoading]);

  const getStatusBadge = () => {
    if (permissionStatus === 'unsupported') {
      return <Badge variant="destructive" className="gap-1"><BellOff className="h-3 w-3" />לא נתמך</Badge>;
    }
    if (isSubscribed) {
      return <Badge className="gap-1 bg-green-600"><Check className="h-3 w-3" />פעיל</Badge>;
    }
    if (user?.push_enabled === false) {
      return <Badge variant="destructive" className="gap-1"><BellOff className="h-3 w-3" />חסום</Badge>;
    }
    return <Badge variant="outline" className="gap-1"><Bell className="h-3 w-3" />לא פעיל</Badge>;
  };

  const getDeviceIcon = () => {
    if (deviceType === 'ios' || deviceType === 'android') {
      return <Smartphone className="h-4 w-4" />;
    }
    return <Monitor className="h-4 w-4" />;
  };

  const getDeviceLabel = () => {
    if (deviceType === 'ios') return 'אייפון/אייפד';
    if (deviceType === 'android') return 'אנדרואיד';
    return 'מחשב';
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            התראות Push
          </div>
          {getStatusBadge()}
        </CardTitle>
        <CardDescription className="flex items-center gap-1 text-xs">
          {getDeviceIcon()}
          {getDeviceLabel()}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {permissionStatus === 'unsupported' && (
          <Alert className="bg-yellow-50 border-yellow-200">
            <AlertTriangle className="h-4 w-4 text-yellow-600" />
            <AlertDescription className="text-yellow-800 text-sm">
              הדפדפן שלך לא תומך בהתראות Push. נסה לפתוח את האתר בדפדפן אחר (Chrome, Safari, Firefox).
            </AlertDescription>
          </Alert>
        )}

        {/* Error message only if there was an actual denial from the iframe */}
        {error && error.includes('נדחתה') && (
          <Alert className="bg-red-50 border-red-200">
            <BellOff className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-800 text-sm">
              <p className="font-medium mb-2">הגישה להתראות נחסמה.</p>
              <p>כדי להפעיל התראות:</p>
              {deviceType === 'ios' ? (
                <ol className="list-decimal mr-4 mt-1 space-y-1">
                  <li>לחץ על כפתור השיתוף (↑) בדפדפן</li>
                  <li>בחר "הוסף למסך הבית"</li>
                  <li>פתח את האפליקציה מהאייקון החדש</li>
                  <li>הגדרות → התראות → אפשר</li>
                </ol>
              ) : deviceType === 'android' ? (
                <ol className="list-decimal mr-4 mt-1 space-y-1">
                  <li>גש ל: pulse-notifications-6886e.web.app</li>
                  <li>לחץ על הנעילה/מידע בשורת הכתובת</li>
                  <li>בחר "הגדרות אתר"</li>
                  <li>הפעל את "התראות"</li>
                  <li>חזור לאפליקציה ולחץ שוב על "הפעל התראות"</li>
                </ol>
              ) : (
                <ol className="list-decimal mr-4 mt-1 space-y-1">
                  <li>גש ל: pulse-notifications-6886e.web.app</li>
                  <li>לחץ על הנעילה ליד שורת הכתובת</li>
                  <li>מצא את "התראות" ובחר "אפשר"</li>
                  <li>חזור לאפליקציה ולחץ שוב על "הפעל התראות"</li>
                </ol>
              )}
            </AlertDescription>
          </Alert>
        )}

        {deviceType === 'ios' && permissionStatus !== 'granted' && permissionStatus !== 'denied' && (
          <Alert className="bg-blue-50 border-blue-200">
            <Info className="h-4 w-4 text-blue-600" />
            <AlertDescription className="text-blue-800 text-sm">
              <p className="font-medium">שימו לב - משתמשי אייפון:</p>
              <p>כדי לקבל התראות Push באייפון, יש להוסיף את האתר למסך הבית:</p>
              <ol className="list-decimal mr-4 mt-1">
                <li>לחץ על כפתור השיתוף (↑)</li>
                <li>בחר "הוסף למסך הבית"</li>
                <li>פתח את האפליקציה מהאייקון החדש</li>
              </ol>
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert className="bg-red-50 border-red-200">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-800 text-sm">
              {error}
            </AlertDescription>
          </Alert>
        )}

        {isSubscribed ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-green-700 bg-green-50 p-3 rounded-lg">
              <Check className="h-5 w-5" />
              <span className="text-sm font-medium">התראות Push פעילות! תקבל עדכונים חשובים.</span>
            </div>
            <Button 
              variant="outline"
              size="sm"
              onClick={() => {
                setIsLoading(true);
                checkPermissionStatus();
                setTimeout(() => setIsLoading(false), 1500);
              }} 
              disabled={isLoading}
              className="w-full"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin ml-2" />
              ) : (
                <RefreshCw className="h-4 w-4 ml-2" />
              )}
              בדוק מחדש סטטוס
            </Button>
          </div>
        ) : (
          permissionStatus !== 'unsupported' && (
            <Button 
              onClick={requestPermission} 
              disabled={isLoading}
              className="w-full"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin ml-2" />
              ) : (
                <Bell className="h-4 w-4 ml-2" />
              )}
              הפעל התראות Push
            </Button>
          )
        )}

        <p className="text-xs text-gray-500 text-center">
          התראות Push מאפשרות לקבל עדכונים גם כשהאתר סגור
        </p>
        
        {debugInfo && (
          <details className="text-xs text-gray-400">
            <summary className="cursor-pointer">מידע טכני</summary>
            <pre className="mt-1 p-2 bg-gray-100 rounded text-left direction-ltr overflow-x-auto">
              {JSON.stringify(debugInfo, null, 2)}
            </pre>
          </details>
        )}
      </CardContent>
    </Card>
  );
}