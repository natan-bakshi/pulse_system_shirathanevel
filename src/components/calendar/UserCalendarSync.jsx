import React, { useState, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Calendar, Info, Loader2, Save } from "lucide-react";
import { handleUserCalendarDisconnection } from "@/functions/handleUserCalendarDisconnection";

export default function UserCalendarSync({ user }) {
  const [syncApproved, setSyncApproved] = useState(user?.calendar_sync_approved || false);
  const [calendarId, setCalendarId] = useState(user?.google_calendar_id || '');
  const [isSaving, setIsSaving] = useState(false);
  const queryClient = useQueryClient();

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      const oldSyncApproved = user?.calendar_sync_approved || false;
      const oldCalendarId = user?.google_calendar_id || 'primary';
      const newCalendarId = calendarId || 'primary';

      // Save settings
      await base44.auth.updateMe({
        calendar_sync_approved: syncApproved,
        google_calendar_id: newCalendarId
      });

      // If sync was disabled or calendar changed, trigger cleanup
      const syncDisabled = oldSyncApproved && !syncApproved;
      const calendarChanged = oldSyncApproved && oldCalendarId !== newCalendarId;

      if (syncDisabled || calendarChanged) {
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
              calendar_sync_approved: syncApproved, 
              google_calendar_id: newCalendarId,
              email: user.email,
              user_type: user.user_type,
              role: user.role
            }
          });
        } catch (e) {
          console.error("Calendar cleanup error:", e);
        }
      }

      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      alert("הגדרות היומן נשמרו בהצלחה!");
    } catch (error) {
      console.error("Failed to save calendar settings:", error);
      alert("שגיאה בשמירת ההגדרות.");
    } finally {
      setIsSaving(false);
    }
  }, [syncApproved, calendarId, user, queryClient]);

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

        {syncApproved && (
          <>
            {/* Calendar ID */}
            <div>
              <Label htmlFor="calendar_id">מזהה יומן (Calendar ID) - אופציונלי</Label>
              <Input
                id="calendar_id"
                value={calendarId === 'primary' ? '' : calendarId}
                onChange={e => setCalendarId(e.target.value)}
                placeholder="ברירת מחדל: היומן הראשי (כתובת המייל שלך)"
                className="dir-ltr text-left mt-1"
              />
            </div>

            {/* Info box */}
            <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-800 space-y-1">
              <div className="flex items-start gap-2">
                <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium mb-1">מה זה מזהה יומן?</p>
                  <ul className="list-disc mr-4 space-y-0.5">
                    <li>כברירת מחדל, האירועים יסונכרנו ליומן הראשי שלך (לפי כתובת המייל)</li>
                    <li>אם יש לך יומן משני ב-Google Calendar ואתה רוצה שהאירועים יגיעו אליו, הזן את ה-Calendar ID שלו</li>
                    <li>למציאת Calendar ID: Google Calendar → הגדרות → היומן הרצוי → "שילוב יומן" → Calendar ID</li>
                    <li><strong>זוהי אופציה לשדרוג, לא חובה.</strong> אם לא בטוח, השאר ריק</li>
                  </ul>
                </div>
              </div>
            </div>
          </>
        )}

        {!syncApproved && (
          <p className="text-xs text-amber-600">
            כשהסנכרון כבוי, לא יסונכרנו אירועים ליומן Google שלך. אם היו אירועים מסונכרנים בעבר, הם יימחקו מהיומן.
          </p>
        )}

        <Button onClick={handleSave} disabled={isSaving} className="w-full sm:w-auto">
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Save className="h-4 w-4 ml-2" />}
          שמור הגדרות יומן
        </Button>
      </CardContent>
    </Card>
  );
}