import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Calendar, Check, Loader2, Unlink, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function GoogleCalendarUserCard() {
  const queryClient = useQueryClient();
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [error, setError] = useState(null);

  const { data: user, isLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: connectionStatus, isLoading: isChecking, refetch: recheckConnection } = useQuery({
    queryKey: ['googleCalendarConnection'],
    queryFn: async () => {
      const response = await base44.functions.invoke('checkGoogleCalendarConnection', {});
      return response.data;
    },
    staleTime: 30 * 1000,
    retry: 1
  });

  const isConnected = connectionStatus?.connected === true;

  const handleConnect = async () => {
    setIsConnecting(true);
    setError(null);

    try {
      const response = await base44.functions.invoke('getGoogleOAuthUrl', {});

      if (response.data?.authUrl) {
        const width = 600;
        const height = 700;
        const left = (window.screen.width - width) / 2;
        const top = (window.screen.height - height) / 2;

        const popup = window.open(
          response.data.authUrl,
          'google-oauth',
          `width=${width},height=${height},left=${left},top=${top}`
        );

        // Poll for result
        const pollInterval = setInterval(async () => {
          // Check localStorage
          const item = localStorage.getItem('google_auth_result');
          if (item) {
            try {
              const result = JSON.parse(item);
              if (Date.now() - result.timestamp < 120000) {
                localStorage.removeItem('google_auth_result');
                clearInterval(pollInterval);
                clearInterval(backendPoll);
                setIsConnecting(false);
                if (result.type === 'success') {
                  recheckConnection();
                  queryClient.invalidateQueries({ queryKey: ['currentUser'] });
                } else if (result.type === 'error') {
                  setError('שגיאה בחיבור יומן Google. אנא נסה שוב.');
                } else if (result.type === 'cancelled') {
                  setError('החיבור בוטל.');
                }
              }
            } catch (e) {}
          }

          // Check if popup closed
          if (popup && popup.closed) {
            clearInterval(pollInterval);
            clearInterval(backendPoll);
            setIsConnecting(false);
          }
        }, 500);

        // Also poll backend
        const backendPoll = setInterval(async () => {
          try {
            const res = await base44.functions.invoke('checkGoogleCalendarConnection', {});
            if (res.data?.connected === true) {
              clearInterval(pollInterval);
              clearInterval(backendPoll);
              setIsConnecting(false);
              recheckConnection();
              queryClient.invalidateQueries({ queryKey: ['currentUser'] });
            }
          } catch (e) {}
        }, 2000);

        // Listen for postMessage
        const messageHandler = (event) => {
          if (event.data?.type === 'GOOGLE_AUTH_SUCCESS') {
            if (event.source) {
              event.source.postMessage({ type: 'GOOGLE_AUTH_ACK' }, event.origin);
            }
            clearInterval(pollInterval);
            clearInterval(backendPoll);
            setIsConnecting(false);
            recheckConnection();
            queryClient.invalidateQueries({ queryKey: ['currentUser'] });
            window.removeEventListener('message', messageHandler);
          } else if (event.data?.type === 'GOOGLE_AUTH_ERROR') {
            clearInterval(pollInterval);
            clearInterval(backendPoll);
            setIsConnecting(false);
            setError('שגיאה בחיבור. נסה שוב.');
            window.removeEventListener('message', messageHandler);
          }
        };
        window.addEventListener('message', messageHandler);

        // Cleanup after 2 minutes
        setTimeout(() => {
          clearInterval(pollInterval);
          clearInterval(backendPoll);
          window.removeEventListener('message', messageHandler);
          setIsConnecting(false);
        }, 120000);
      } else {
        throw new Error('Failed to get authorization URL');
      }
    } catch (err) {
      console.error('Connection error:', err);
      setError('שגיאה בחיבור יומן Google. אנא נסה שוב.');
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('האם לנתק את יומן Google? האירועים שכבר סונכרנו ליומן לא יימחקו.')) return;

    setIsDisconnecting(true);
    try {
      await base44.auth.updateMe({
        google_calendar_connected: false,
        google_calendar_access_token: '',
        google_calendar_refresh_token: '',
        google_calendar_token_expiry: '',
        google_calendar_id: ''
      });
      recheckConnection();
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
    } catch (err) {
      console.error('Disconnect error:', err);
      setError('שגיאה בניתוק. נסה שוב.');
    } finally {
      setIsDisconnecting(false);
    }
  };

  if (isLoading) return null;

  return (
    <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Calendar className="h-5 w-5 text-blue-600" />
          יומן Google
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-gray-500">
          חבר את יומן Google שלך כדי לקבל אירועים ישירות ביומן.
        </p>

        {isChecking ? (
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            בודק חיבור...
          </div>
        ) : isConnected ? (
          <div className="space-y-3">
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2">
              <Check className="h-5 w-5 text-green-600 shrink-0" />
              <span className="text-green-700 font-medium text-sm">יומן Google מחובר</span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => recheckConnection()}
                className="text-gray-600"
              >
                <RefreshCw className="h-3.5 w-3.5 ml-1" />
                בדוק שוב
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDisconnect}
                disabled={isDisconnecting}
                className="text-red-600 border-red-200 hover:bg-red-50"
              >
                {isDisconnecting ? (
                  <Loader2 className="h-3.5 w-3.5 ml-1 animate-spin" />
                ) : (
                  <Unlink className="h-3.5 w-3.5 ml-1" />
                )}
                נתק יומן
              </Button>
            </div>
          </div>
        ) : (
          <Button
            onClick={handleConnect}
            disabled={isConnecting}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {isConnecting ? (
              <>
                <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                מתחבר...
              </>
            ) : (
              <>
                <Calendar className="h-4 w-4 ml-2" />
                חבר יומן Google
              </>
            )}
          </Button>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
            {error}
          </div>
        )}

        <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-800 space-y-1">
          <p className="font-medium">מה יקרה לאחר החיבור?</p>
          <ul className="list-disc mr-4 space-y-0.5">
            <li>אירועים שאתה משובץ אליהם יתווספו ליומן שלך</li>
            <li>שינויים באירועים יתעדכנו ביומן אוטומטית</li>
            <li>ביטול שיבוץ יסיר את האירוע מהיומן</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}