import React, { useState, useEffect } from "react";
import { Bell, BellOff, Check, AlertTriangle, Loader2, Smartphone, Monitor, Info, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";

// OneSignal App ID
const ONESIGNAL_APP_ID = '4490c0d9-4205-4d6e-8143-39c0aa00b183';

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
  }, []);

  const checkPermissionStatus = async () => {
    try {
      // Check native Notification API permission
      if ('Notification' in window) {
        setPermissionStatus(Notification.permission);
      } else {
        setPermissionStatus('unsupported');
        return;
      }

      // Check OneSignal subscription status
      if (window.OneSignalDeferred) {
        window.OneSignalDeferred.push(async (OneSignal) => {
          try {
            const isPushSupported = OneSignal.Notifications.isPushSupported();
            if (!isPushSupported) {
              setPermissionStatus('unsupported');
              return;
            }
            
            const permission = await OneSignal.Notifications.permission;
            const pushSub = OneSignal.User.PushSubscription;
            const optedIn = pushSub.optedIn;
            const subscriptionId = pushSub.id;
            
            setDebugInfo({
              permission,
              optedIn,
              subscriptionId: subscriptionId ? subscriptionId.substring(0, 10) + '...' : 'none',
              nativePermission: Notification.permission
            });
            
            console.log('[Push] Status check:', { permission, optedIn, subscriptionId });
            
            // User is subscribed if they have permission AND are opted in AND have a subscription ID
            setIsSubscribed(permission && optedIn && !!subscriptionId);
            
            // If they have permission but aren't opted in, try to opt them in
            if (permission && !optedIn) {
              console.log('[Push] User has permission but not opted in. Attempting opt-in...');
              try {
                await pushSub.optIn();
                // Re-check after opt-in
                setTimeout(() => checkPermissionStatus(), 1000);
              } catch (optInError) {
                console.warn('[Push] Opt-in failed:', optInError);
              }
            }
          } catch (e) {
            console.warn('[Push] OneSignal check failed:', e);
          }
        });
      }
    } catch (e) {
      console.warn('[Push] Permission check failed:', e);
    }
  };

  const requestPermission = async () => {
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

      // Request native notification permission
      const permission = await Notification.requestPermission();
      setPermissionStatus(permission);

      if (permission === 'granted') {
        // Initialize OneSignal if not already done
        await initOneSignalAndSubscribe();
      } else if (permission === 'denied') {
        setError('הגישה להתראות נדחתה. יש לשנות את ההגדרות בדפדפן.');
      }
    } catch (e) {
      console.error('[Push] Request error:', e);
      setError('שגיאה בבקשת הרשאות: ' + e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const initOneSignalAndSubscribe = async () => {
    return new Promise((resolve, reject) => {
      if (!window.OneSignalDeferred) {
        window.OneSignalDeferred = [];
        
        // Load OneSignal SDK
        const script = document.createElement('script');
        script.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
        script.defer = true;
        script.onload = () => {
          subscribeToOneSignal().then(resolve).catch(reject);
        };
        document.head.appendChild(script);
      } else {
        subscribeToOneSignal().then(resolve).catch(reject);
      }
    });
  };

  const subscribeToOneSignal = () => {
    return new Promise((resolve, reject) => {
      window.OneSignalDeferred.push(async (OneSignal) => {
        try {
          // Check if already initialized
          let needsInit = false;
          try {
            needsInit = !OneSignal.Notifications.isPushSupported();
          } catch {
            needsInit = true;
          }
          
          if (needsInit) {
            await OneSignal.init({
              appId: ONESIGNAL_APP_ID,
              allowLocalhostAsSecureOrigin: true,
              serviceWorkerParam: { scope: '/' },
              promptOptions: {
                slidedown: {
                  prompts: [{
                    type: "push",
                    autoPrompt: false,
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
                title: "התראות הופעלו בהצלחה!",
                message: "תקבל עדכונים חשובים ותזכורות על האירועים שלך"
              }
            });
          }

          // Login with user ID - critical for targeting
          if (user?.id) {
            await OneSignal.login(user.id);
            console.log('[OneSignal] User logged in:', user.id);
          }

          // Opt-in to push notifications
          const pushSub = OneSignal.User.PushSubscription;
          await pushSub.optIn();
          
          // Wait for subscription to propagate
          await new Promise(r => setTimeout(r, 1000));
          
          // Verify subscription
          const subscriptionId = pushSub.id;
          const isOptedIn = pushSub.optedIn;
          
          console.log('[OneSignal] Subscription complete. ID:', subscriptionId, 'OptedIn:', isOptedIn);
          
          setIsSubscribed(true);
          
          // Update user profile with subscription info
          if (user?.id) {
            try {
              await base44.auth.updateMe({
                onesignal_external_id: user.id,
                push_enabled: true,
                onesignal_subscription_id: subscriptionId || ''
              });
            } catch (e) {
              // Ignore
            }
          }
          
          // Re-check status
          setTimeout(() => checkPermissionStatus(), 500);
          
          resolve();
        } catch (error) {
          console.error('[OneSignal] Subscribe error:', error);
          reject(error);
        }
      });
    });
  };

  const getStatusBadge = () => {
    if (permissionStatus === 'unsupported') {
      return <Badge variant="destructive" className="gap-1"><BellOff className="h-3 w-3" />לא נתמך</Badge>;
    }
    if (permissionStatus === 'denied') {
      return <Badge variant="destructive" className="gap-1"><BellOff className="h-3 w-3" />חסום</Badge>;
    }
    if (isSubscribed) {
      return <Badge className="gap-1 bg-green-600"><Check className="h-3 w-3" />פעיל</Badge>;
    }
    if (permissionStatus === 'granted') {
      return <Badge variant="secondary" className="gap-1"><Bell className="h-3 w-3" />מאושר (ממתין לרישום)</Badge>;
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

        {permissionStatus === 'denied' && (
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
                  <li>לחץ על הנעילה/מידע בשורת הכתובת</li>
                  <li>בחר "הגדרות אתר"</li>
                  <li>הפעל את "התראות"</li>
                </ol>
              ) : (
                <ol className="list-decimal mr-4 mt-1 space-y-1">
                  <li>לחץ על הנעילה ליד שורת הכתובת</li>
                  <li>מצא את "התראות" ובחר "אפשר"</li>
                  <li>רענן את הדף</li>
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
          permissionStatus !== 'unsupported' && permissionStatus !== 'denied' && (
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