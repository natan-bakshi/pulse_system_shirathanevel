import React, { useState, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Calendar, Info, Loader2, Save, CheckCircle2, XCircle, Mail } from "lucide-react";
import { handleUserCalendarDisconnection } from "@/functions/handleUserCalendarDisconnection";
import { createAndShareUserCalendar } from "@/functions/createAndShareUserCalendar";

export default function UserCalendarSync({ user }) {
  const [syncApproved, setSyncApproved] = useState(user?.calendar_sync_approved || false);
  const [isSaving, setIsSaving] = useState(false);
  const [justConnected, setJustConnected] = useState(false);
  const queryClient = useQueryClient();

  const isConnected = user?.calendar_sync_approved && user?.google_calendar_id && user.google_calendar_id !== 'primary';

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      const oldSyncApproved = user?.calendar_sync_approved || false;
      const oldCalendarId = user?.google_calendar_id || '';

      if (syncApproved && !isConnected) {
        // User is enabling sync - create a new calendar and share it
        const result = await createAndShareUserCalendar({});
        if (result.data?.error) {
          alert("שגיאה ביצירת היומן: " + (result.data.error || 'שגיאה לא ידועה'));
          setIsSaving(false);
          return;
        }
        if (result.data?.warning) {
          alert("היומן נוצר אך השיתוף נכשל. ייתכן שתצטרך לשתף ידנית.");
        }
      } else if (!syncApproved && oldSyncApproved) {
        // User is disabling sync - trigger cleanup
        try {
          await handleUserCalendarDisconnection({
            userId: user.id,
            oldData: { 
              calendar_sync_approved: oldSyncApproved, 
              google_calendar_id: oldCalendarId,
              email: user.email,
              user_type: user.user_type,
              role: user.role
            },
            newData: { 
              calendar_sync_approved: false, 
              google_calendar_id: '',
              email: user.email,
              user_type: user.user_type,
              role: user.role
            }
          });
        } catch (e) {
          console.error("Calendar cleanup error:", e);
        }

        // Clear the calendar ID on the user
        await base44.auth.updateMe({
          calendar_sync_approved: false,
          google_calendar_id: ''
        });
      }

      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      if (syncApproved) {
        setJustConnected(true);
      } else {
        alert("סנכרון היומן כובה בהצלחה.");
      }
    } catch (error) {
      console.error("Failed to save calendar settings:", error);
      alert("שגיאה בשמירת ההגדרות.");
    } finally {
      setIsSaving(false);
    }
  }, [syncApproved, isConnected, user, queryClient]);

  return (
    <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Calendar className="h-5 w-5" />
          סנכרון יומן Google
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Sync toggle */}
        <div className="flex items-center justify-between border p-3 rounded-md">
          <div>
            <Label htmlFor="calendar_sync" className="cursor-pointer font-medium">אישור סנכרון אירועים ליומן</Label>
            <p className="text-xs text-gray-500 mt-1">
              כשמופעל, אירועים רלוונטיים יסונכרנו אוטומטית ליומן Google שלך
            </p>
          </div>
          <Switch
            id="calendar_sync"
            checked={syncApproved}
            onCheckedChange={setSyncApproved}
          />
        </div>

        {isConnected && !justConnected && (
          <div className="bg-green-50 rounded-lg p-3 text-sm text-green-800 flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">יומן Google מחובר</p>
              <p className="text-xs mt-1">יומן ייעודי נוצר ושותף אליך אוטומטית. אירועים יסונכרנו אליו.</p>
            </div>
          </div>
        )}

        {justConnected && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900 space-y-2">
            <div className="flex items-start gap-2">
              <Mail className="h-5 w-5 mt-0.5 shrink-0 text-amber-600" />
              <div>
                <p className="font-bold">יומן Google נוצר בהצלחה!</p>
                <p className="mt-1">נשלח אליך מייל עם בקשה לאישור שיתוף היומן. <strong>עליך לאשר את השיתוף בגוף המייל</strong> כדי שהיומן יופיע אצלך ב-Google Calendar.</p>
                <p className="mt-2 text-xs text-amber-700">לא מוצא את המייל? חפש גם בתיקיית <strong>דואר זבל / ספאם</strong>.</p>
              </div>
            </div>
          </div>
        )}

        {syncApproved && !isConnected && (
          <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-800 space-y-1">
            <div className="flex items-start gap-2">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium mb-1">מה יקרה כשתשמור?</p>
                <p>ייווצר יומן Google ייעודי בשמך והוא ישותף אליך אוטומטית. תקבל הזמנה לצפות ביומן ישירות ב-Google Calendar שלך.</p>
              </div>
            </div>
          </div>
        )}

        {!syncApproved && isConnected && (
          <p className="text-xs text-amber-600">
            כשתכבה את הסנכרון, האירועים שסונכרנו ליומן יימחקו והיומן הייעודי יימחק.
          </p>
        )}

        {!syncApproved && !isConnected && (
          <p className="text-xs text-gray-500">
            הפעל סנכרון כדי ליצור יומן Google ייעודי שיציג את האירועים שלך.
          </p>
        )}

        {/* Show save button only when there's a change to make */}
        {((syncApproved && !isConnected) || (!syncApproved && isConnected)) && (
          <Button onClick={handleSave} disabled={isSaving} className="w-full sm:w-auto">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Save className="h-4 w-4 ml-2" />}
            {syncApproved ? 'חבר יומן Google' : 'כבה וניתוק יומן'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}