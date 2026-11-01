import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, AlertTriangle, UserCheck, UserX, MinusCircle, Bell } from 'lucide-react';
import { confirmReassignAfterDateChange } from '@/functions/confirmReassignAfterDateChange';
import { cancelAssignmentsAfterDateChange } from '@/functions/cancelAssignmentsAfterDateChange';
import { clearDateChangePendingAction } from '@/functions/clearDateChangePendingAction';
import { toast } from 'sonner';

/**
 * Dialog shown to admin when an event's date/time changed and there are assigned suppliers.
 * Asks whether to:
 *  - Reassign the same suppliers with an update notification (only suppliers without a fixed arrival time)
 *  - Cancel all assignments
 *  - Do nothing (just clear the flag, change is internal-only)
 */
export default function DateChangeDecisionDialog({ open, event, onResolved }) {
  const [loadingAction, setLoadingAction] = useState(null); // 'reassign' | 'notice' | 'cancel' | 'nothing' | null
  let changeContext = null;
  try { changeContext = JSON.parse(event?.supplier_event_change_context || 'null'); } catch {}

  const handleReassign = async () => {
    if (!event?.id) return;
    setLoadingAction('reassign');
    try {
      await confirmReassignAfterDateChange({ event_id: event.id, mode: 'notify_reset' });
      toast.success('השיבוצים עודכנו; הודעות WhatsApp שנדרשו נשמרו בתור — מסירה טרם אומתה.');
      onResolved?.();
    } catch (error) {
      console.error('Reassign failed:', error);
      toast.error('שגיאה בשיבוץ מחדש: ' + (error.message || 'נסה שוב'));
    } finally {
      setLoadingAction(null);
    }
  };

  const handleNoticeOnly = async () => {
    if (!event?.id) return;
    setLoadingAction('notice');
    try {
      await confirmReassignAfterDateChange({event_id:event.id,mode:'notify_no_reset'});
      toast.success('הודעת עדכון עם ״קיבלתי״ נשמרה בתור. סטטוס הספקים לא אופס.');
      onResolved?.();
    } catch (error) {
      console.error('Notice-only send failed:', error);
      toast.error('העדכון נכשל: ' + (error.message || 'נסה שוב'));
    } finally {
      setLoadingAction(null);
    }
  };

  const handleCancel = async () => {
    if (!event?.id) return;
    setLoadingAction('cancel');
    try {
      await cancelAssignmentsAfterDateChange({ event_id: event.id });
      toast.success('השיבוצים בוטלו; הודעות WhatsApp שנדרשו נשמרו בתור — מסירה טרם אומתה.');
      onResolved?.();
    } catch (error) {
      console.error('Cancel failed:', error);
      toast.error('שגיאה בביטול שיבוצים: ' + (error.message || 'נסה שוב'));
    } finally {
      setLoadingAction(null);
    }
  };

  const handleDoNothing = async () => {
    if (!event?.id) return;
    setLoadingAction('nothing');
    try {
      await clearDateChangePendingAction({ event_id: event.id });
      toast.success('השינוי נשמר במערכת בלבד. הספקים לא יקבלו התראה.');
      onResolved?.();
    } catch (error) {
      console.error('Clear failed:', error);
      toast.error('שגיאה: ' + (error.message || 'נסה שוב'));
    } finally {
      setLoadingAction(null);
    }
  };

  const isLoading = loadingAction !== null;

  return (
    <Dialog open={open} onOpenChange={() => { /* prevent dismiss - admin must choose */ }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" onPointerDownOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-700">
            <AlertTriangle className="h-5 w-5" />
            פרטי האירוע השתנו
          </DialogTitle>
          <DialogDescription className="text-right pt-2 space-y-2">
            <div>
              פרטי האירוע <strong>{event?.event_name}</strong> עודכנו.
            </div>
            {(Array.isArray(changeContext?.fields) ? changeContext.fields.some(field => ['event_date', 'event_time'].includes(field)) : event?.previous_event_date) && (
              <div className="text-sm">
                <span className="text-gray-500">תאריך קודם:</span> {event.previous_event_date}
                {event?.previous_event_time && ` ${event.previous_event_time}`}
                <span className="mx-2">←</span>
                <span className="text-gray-500">חדש:</span> {event?.event_date}
                {event?.event_time && ` ${event.event_time}`}
              </div>
            )}
            {Array.isArray(changeContext?.fields) && changeContext.fields.some(field => ['location', 'concept'].includes(field)) && (
              <div className="text-sm">
                {changeContext.fields.filter(field => ['location', 'concept'].includes(field)).map(field => (
                  <div key={field}>
                    <strong>{field === 'location' ? 'מיקום' : 'קונספט'}:</strong>{' '}
                    {changeContext.before?.[field] || '(ריק)'} ← {changeContext.after?.[field] || '(ריק)'}
                  </div>
                ))}
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
              <div className="font-semibold">שלח עדכון ואפס אישורי שיבוץ</div>
              <div className="text-xs opacity-90 font-normal">עדכון עם כפתורי אישור/דחייה, ואישור הספקים הרלוונטיים חוזר לממתין.</div>
            </div>
          </Button>

          <Button
            onClick={handleNoticeOnly}
            disabled={isLoading}
            variant="outline"
            className="justify-start h-auto py-3 border-blue-300 text-blue-800"
          >
            {loadingAction === 'notice' ? <Loader2 className="h-5 w-5 ml-3 animate-spin" /> : <Bell className="h-5 w-5 ml-3" />}
            <div className="text-right">
              <div className="font-semibold">שלח עדכון בלי לאפס אישורים</div>
              <div className="text-xs font-normal">הודעה עם ״קיבלתי״ בלבד; סטטוסי הספקים לא ישתנו.</div>
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

          <Button
            onClick={handleDoNothing}
            disabled={isLoading}
            variant="outline"
            className="justify-start h-auto py-3"
          >
            {loadingAction === 'nothing' ? (
              <Loader2 className="h-5 w-5 ml-3 animate-spin" />
            ) : (
              <MinusCircle className="h-5 w-5 ml-3" />
            )}
            <div className="text-right">
              <div className="font-semibold">לא לעשות דבר</div>
              <div className="text-xs text-gray-600 font-normal">בלי הודעה ובלי שינוי בסטטוסי הספקים.</div>
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