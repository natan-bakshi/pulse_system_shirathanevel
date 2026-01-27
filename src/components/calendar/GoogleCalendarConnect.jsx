import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Calendar, Check, X, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";

export default function GoogleCalendarConnect({ user, onClose }) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const checkConnection = async () => {
      setIsChecking(true);
      try {
        const response = await base44.functions.invoke('checkGoogleCalendarConnection', {});
        setIsConnected(response.data?.connected === true);
      } catch (err) {
        console.warn('Could not check calendar connection:', err);
        setIsConnected(false);
      } finally {
        setIsChecking(false);
      }
    };
    
    checkConnection();
  }, []);

  useEffect(() => {
    if (!isConnecting) return;

    const processResult = (result) => {
      localStorage.removeItem('google_auth_result');
      if (result.type === 'success') {
        setIsConnecting(false);
        checkConnection();
      } else if (result.type === 'error') {
        setIsConnecting(false);
        setError('שגיאה בחיבור יומן Google. אנא נסה שוב.');
      } else if (result.type === 'cancelled') {
        setIsConnecting(false);
        setError('חיבור יומן Google בוטל.');
      }
    };

    const checkStorage = () => {
      const item = localStorage.getItem('google_auth_result');
      if (item) {
        try {
          const result = JSON.parse(item);
          // Only process fresh results (created in the last 2 minutes)
          if (Date.now() - result.timestamp < 120000) {
            processResult(result);
          }
        } catch (err) {
          console.warn('Error parsing auth result:', err);
        }
      }
    };

    // Poll storage every 500ms
    const interval = setInterval(checkStorage, 500);

    // Poll Backend Status (Fallback for Socket failure)
    const backendPollInterval = setInterval(async () => {
        try {
            const response = await base44.functions.invoke('checkGoogleCalendarConnection', {});
            if (response.data?.connected === true) {
                processResult({ type: 'success' });
            }
        } catch (err) {
            // Ignore errors during polling
        }
    }, 2000); // Check every 2 seconds

    const handleStorageChange = (e) => {
      if (e.key === 'google_auth_result' && e.newValue) {
        try {
          processResult(JSON.parse(e.newValue));
        } catch (err) {
          console.warn('Error parsing auth result:', err);
        }
      }
    };

    // Listen for storage changes
    window.addEventListener('storage', handleStorageChange);

    // Listen for direct messages (Handshake)
    const handleMessage = (event) => {
      // Validate origin
      if (event.origin !== "https://pulse-system.base44.app") return;

      const data = event.data;
      if (!data) return;

      if (data.type === 'GOOGLE_AUTH_SUCCESS') {
        // Send ACK back
        if (event.source) {
          event.source.postMessage({ type: 'GOOGLE_AUTH_ACK' }, event.origin);
        }
        
        // Handle success
        processResult({ type: 'success' });
      } 
      else if (data.type === 'GOOGLE_AUTH_ERROR') {
        processResult({ type: 'error', message: data.message });
      }
      else if (data.type === 'GOOGLE_AUTH_CANCELLED') {
        processResult({ type: 'cancelled' });
      }
    };

    window.addEventListener('message', handleMessage);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('message', handleMessage);
      clearInterval(interval);
      clearInterval(backendPollInterval);
    };
  }, [isConnecting]);

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
        
        window.open(
          response.data.authUrl,
          'google-oauth',
          `width=${width},height=${height},left=${left},top=${top}`
        );
      } else {
        throw new Error('Failed to get authorization URL');
      }
    } catch (err) {
      console.error('Connection error:', err);
      setError('שגיאה בחיבור יומן Google. אנא נסה שוב.');
      setIsConnecting(false);
    }
  };
  
  const checkConnection = async () => {
    try {
      const response = await base44.functions.invoke('checkGoogleCalendarConnection', {});
      setIsConnected(response.data?.connected === true);
    } catch (err) {
      console.warn('Could not check calendar connection:', err);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6" dir="rtl">
        <div className="flex justify-between items-start mb-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-red-100 rounded-full">
              <Calendar className="h-6 w-6 text-red-800" />
            </div>
            <h2 className="text-xl font-bold text-gray-900">חיבור יומן Google</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <p className="text-gray-600">
            חבר את יומן Google שלך כדי לסנכרן אירועים אוטומטית.
          </p>

          <div className="bg-gray-50 rounded-lg p-4 space-y-2">
            <h3 className="font-medium text-gray-900">מה יקרה?</h3>
            <ul className="text-sm text-gray-600 space-y-1">
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-green-600" />
                אירועים סגורים יתווספו ליומן שלך
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-green-600" />
                שינויי סטטוס יעדכנו את היומן
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-green-600" />
                מחיקת אירוע תסיר אותו מהיומן
              </li>
            </ul>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
              {error}
            </div>
          )}

          {isChecking ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              <span className="mr-2 text-gray-500">בודק חיבור...</span>
            </div>
          ) : isConnected ? (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
              <Check className="h-5 w-5 text-green-600" />
              <span className="text-green-700 font-medium">יומן Google מחובר בהצלחה!</span>
            </div>
          ) : (
            <Button
              onClick={handleConnect}
              disabled={isConnecting}
              className="w-full bg-red-800 hover:bg-red-700 text-white"
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
        </div>
      </div>
    </div>
  );
}