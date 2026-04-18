import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Calendar, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function CalendarSyncPrompt({ user }) {
  const [visible, setVisible] = useState(false);
  const [showFollowUp, setShowFollowUp] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;
    // Don't show if already synced or already dismissed
    const alreadySynced = user.calendar_sync_approved && user.google_calendar_id;
    const alreadyDismissed = user.calendar_sync_dismissed;
    if (!alreadySynced && !alreadyDismissed) {
      // Small delay so it doesn't pop immediately on load
      const timer = setTimeout(() => setVisible(true), 2000);
      return () => clearTimeout(timer);
    }
  }, [user]);

  const handleDismiss = async () => {
    setVisible(false);
    try {
      await base44.auth.updateMe({ calendar_sync_dismissed: true });
    } catch (e) {
      console.error("Failed to save dismiss:", e);
    }
    setShowFollowUp(true);
  };

  const handleAccept = async () => {
    setVisible(false);
    try {
      await base44.auth.updateMe({ calendar_sync_approved: true });
    } catch (e) {
      console.error("Failed to update calendar sync:", e);
    }
    navigate(createPageUrl("UserSettings"));
  };

  const handleCloseFollowUp = () => {
    setShowFollowUp(false);
  };

  if (!visible && !showFollowUp) return null;

  return (
    <>
      {/* Main prompt balloon */}
      {visible && (
        <div className="fixed bottom-20 left-4 right-4 sm:left-auto sm:right-4 sm:w-96 z-[60] animate-in slide-in-from-bottom-5 duration-500">
          <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
            <div className="bg-gradient-to-l from-red-800 to-red-700 px-4 py-3 flex items-center gap-2">
              <Calendar className="h-5 w-5 text-white" />
              <span className="text-white font-bold text-sm">סנכרון יומן Google</span>
            </div>
            <div className="p-4 space-y-3" dir="rtl">
              <p className="text-sm text-gray-700 leading-relaxed">
                היי! 👋 האם תרצה לסנכרן את האירועים שלך עם יומן Google? 
                כך תוכל לראות את כל האירועים שלך ישירות ביומן הטלפון.
              </p>
              <div className="flex gap-2">
                <Button
                  onClick={handleAccept}
                  className="flex-1 bg-red-800 hover:bg-red-700 text-white text-sm"
                  size="sm"
                >
                  אני אשמח! 🎉
                </Button>
                <Button
                  onClick={handleDismiss}
                  variant="outline"
                  className="flex-1 text-sm border-gray-300"
                  size="sm"
                >
                  לא כרגע, תודה!
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Follow-up message after dismissal */}
      {showFollowUp && (
        <div className="fixed bottom-20 left-4 right-4 sm:left-auto sm:right-4 sm:w-96 z-[60] animate-in slide-in-from-bottom-5 duration-500">
          <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
            <div className="bg-gradient-to-l from-amber-600 to-amber-500 px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-white" />
                <span className="text-white font-bold text-sm">לידיעתך</span>
              </div>
              <button onClick={handleCloseFollowUp} className="text-white/80 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4" dir="rtl">
              <p className="text-sm text-gray-700 leading-relaxed">
                אין בעיה! כרגע האירועים שלך לא יסונכרנו ליומן Google. 
                אם תשנה את דעתך בעתיד, תמיד תוכל להפעיל סנכרון דרך <strong>הגדרות משתמש</strong> 📱
              </p>
              <Button
                onClick={handleCloseFollowUp}
                variant="outline"
                className="mt-3 w-full text-sm"
                size="sm"
              >
                הבנתי, תודה!
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}