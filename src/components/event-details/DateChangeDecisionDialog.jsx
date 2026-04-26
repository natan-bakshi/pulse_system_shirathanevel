import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, AlertTriangle, UserCheck, UserX } from 'lucide-react';
import { confirmReassignAfterDateChange } from '@/functions/confirmReassignAfterDateChange';
import { cancelAssignmentsAfterDateChange } from '@/functions/cancelAssignmentsAfterDateChange';
import { toast } from 'sonner';

/**
 * Dialog shown to admin when an event's date/time changed and there are assigned suppliers.
 * Asks whether to reassign the same suppliers (with update notification) or cancel their assignments.
 */
export default function DateChangeDecisionDialog({ open, event, onResolved }) {
  const [loadingAction, setLoadingAction] = useState(null); // 'reassign' | 'cancel' | null

  const handleReassign = async () => {
    if (!event?.id) return;
    setLoadingAction('reassign');
    try {
      await confirmReassignAfterDateChange({ event_id: event.id });
      toast.success('הספקים שובצו מחדש והתראת עדכון נשלחה');
      onResolved?.();
    } catch (error) {
      console.error('Reassign failed:', error);
      toast.error('שגיאה בשיבוץ מחדש: ' + (error.message || 'נסה שוב'));
    } finally {
      setLoadingAction(null);
    }
  };

  const handleCancel = async () => {
    if (!event?.id) return;
    setLoadingAction('cancel');
    try {
      await cancelAssignmentsAfterDateChange({ event_id: event.id });
      toast.success('השיבוצים בוטלו והתראות ביטול נשלחו לספקים');
      onResolved?.();
    } catch (error) {
      console.error('Cancel failed:', error);
      toast.error('שגיאה בביטול שיבוצים: ' + (error.message || 'נסה שוב'));
    } finally {
      setLoadingAction(null);
    }
  };

  const isLoading = loadingAction !== null;

  return (
    <Dialog open={open} onOpenChange={() => { /* prevent dismiss - admin must choose */ }}>
      <DialogContent className="max-w-lg" onPointerDownOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-700">
            <AlertTriangle className="h-5 w-5" />
            תאריך האירוע השתנה
          </DialogTitle>
          <DialogDescription className="text-right pt-2 space-y-2">
            <div>
              תאריך/שעת האירוע <strong>{event?.event_name}</strong> שונו.
            </div>
            {event?.previous_event_date && (
              <div className="text-sm">
                <span className="text-gray-500">תאריך קודם:</span> {event.previous_event_date}
                {event?.previous_event_time && ` ${event.previous_event_time}`}
                <span className="mx-2">←</span>
                <span className="text-gray-500">חדש:</span> {event?.event_date}
                {event?.event_time && ` ${event.event_time}`}
              </div>
            )}
            <div className="pt-2">
              יש ספקים משובצים לאירוע. מה ברצונך לעשות?
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 py-2">
          <Button
            onClick={handleReassign}
            disabled={isLoading}
            className="bg-green-600 hover:bg-green-700 text-white justify-start h-auto py-3"
          >
            {loadingAction === 'reassign' ? (
              <Loader2 className="h-5 w-5 ml-3 animate-spin" />
            ) : (
              <UserCheck className="h-5 w-5 ml-3" />
            )}
            <div className="text-right">
              <div className="font-semibold">שבץ את אותם ספקים לתאריך החדש</div>
              <div className="text-xs opacity-90 font-normal">סטטוס השיבוץ של הספקים יחזור ל"ממתין" ותישלח התראת עדכון</div>
            </div>
          </Button>

          <Button
            onClick={handleCancel}
            disabled={isLoading}
            variant="destructive"
            className="justify-start h-auto py-3"
          >
            {loadingAction === 'cancel' ? (
              <Loader2 className="h-5 w-5 ml-3 animate-spin" />
            ) : (
              <UserX className="h-5 w-5 ml-3" />
            )}
            <div className="text-right">
              <div className="font-semibold">בטל את כל השיבוצים</div>
              <div className="text-xs opacity-90 font-normal">השיבוצים יימחקו והספקים יקבלו התראת ביטול</div>
            </div>
          </Button>
        </div>

        <DialogFooter>
          <p className="text-xs text-gray-500 text-right w-full">
            יש לבחור אחת מהאפשרויות לפני המשך עבודה באירוע
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}