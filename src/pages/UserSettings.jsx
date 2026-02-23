import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Settings, Loader2 } from "lucide-react";
import UserNotificationPreferences from "@/components/notifications/UserNotificationPreferences";
import DarkModeToggle from "@/components/DarkModeToggle";
import DeleteAccountButton from "@/components/account/DeleteAccountButton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function UserSettings() {
  const { data: user, isLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  // Manage themeMode locally from localStorage (syncs with Layout via storage event)
  const [themeMode, setThemeMode] = useState(() => {
    try { return localStorage.getItem('pulse_theme_mode') || 'auto'; } catch { return 'auto'; }
  });

  const handleSetThemeMode = (mode) => {
    setThemeMode(mode);
    try { localStorage.setItem('pulse_theme_mode', mode); } catch {}
    // Apply theme immediately
    let isDark = false;
    if (mode === 'dark') isDark = true;
    else if (mode === 'auto') isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', isDark);
    // Dispatch custom event so Layout picks up the change (same-window)
    window.dispatchEvent(new CustomEvent('pulse_theme_change', { detail: { mode } }));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-white" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Settings className="h-6 w-6" />
          הגדרות משתמש
        </h1>
      </div>

      {/* Dark Mode / Theme Selection */}
      <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
        <CardHeader>
          <CardTitle className="text-lg">מצב תצוגה</CardTitle>
        </CardHeader>
        <CardContent>
          <DarkModeToggle themeMode={themeMode} setThemeMode={handleSetThemeMode} />
        </CardContent>
      </Card>

      {/* Notification Preferences */}
      <div className="bg-white/95 backdrop-blur-sm rounded-xl shadow-xl overflow-hidden">
        <UserNotificationPreferences user={user} />
      </div>

      {/* Delete Account */}
      <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
        <CardHeader>
          <CardTitle className="text-lg text-red-700">אזור מסוכן</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500 mb-3">מחיקת החשבון היא פעולה בלתי הפיכה. כל הנתונים האישיים שלך יימחקו.</p>
          <DeleteAccountButton />
        </CardContent>
      </Card>
    </div>
  );
}