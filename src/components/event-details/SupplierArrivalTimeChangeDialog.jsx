import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Clock, UserCheck, UserX, MinusCircle } from 'lucide-react';
import { handleSupplierArrivalTimeChange } from '@/functions/handleSupplierArrivalTimeChange';
import { toast } from 'sonner';

/**
 * Dialog shown to admin when supplier_arrival_time on a specific EventService was changed
 * AND there are suppliers assigned to that service.
 *
 * Three options (mirrors DateChangeDecisionDialog):
 *  - notify  -> send an update notification to suppliers of THIS service (status reset to 'pending')
 *  - cancel  -> cancel the assignment of all suppliers on THIS service and notify them
 *  - nothing -> only update the time in the system (no notifications, no status changes)
 */
export default function SupplierArrivalTimeChangeDialog({
  open,
  onOpenChange,
  eventServiceId,
  serviceName,
  newArrivalTime,
  oldArrivalTime,
  onResolved,
}) {
  const [loadingAction, setLoadingAction] = useState(null); // 'notify' | 'cancel' | 'nothing' | null

  const runMode = async (mode) => {
    if (!eventServiceId) return;
    setLoadingAction(mode);
    try {
      await handleSupplierArrivalTimeChange({ event_service_id: eventServiceId, mode });
      if (mode === 'notify') {
        toast.success('התראת עדכון נשלחה לספקים של שירות זה');
      } else if (mode === 'cancel') {
        toast.success('השיבוצים בשירות זה בוטלו והספקים קיבלו התראה');
      } else {
        toast.success('שעת ההתייצבות עודכנה במערכת בלבד');
      }
      onResolved?.(mode);
    } catch (error) {
      console.error('Action failed:', error);
      toast.error('שגיאה: ' + (error.message || 'נסה שוב'));
    } finally {
      setLoadingAction(null);
    }
  };

  const isLoading = loadingAction !== null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!isLoading) onOpenChange(v); }}>
      <DialogContent
        className="max-w-lg"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-700">
            <Clock className="h-5 w-5" />
            שעת ההתייצבות השתנתה
          </DialogTitle>
          <DialogDescription className="text-right pt-2 space-y-2">
            <div>
              שעת ההתייצבות של הספקים בשירות <strong>{serviceName || ''}</strong> שונתה.
            </div>
            {(oldArrivalTime || newArrivalTime) && (
              <div className="text-sm">
                {oldArrivalTime && (
                  <>
                    <span className="text-gray-500">קודם:</span> {oldArrivalTime}
                    <span className="mx-2">←</span>
                  </>
                )}
                <span className="text-gray-500">חדש:</span> {newArrivalTime || '(ריק)'}
              </div>
            )}
            <div className="pt-2">
              יש ספקים משובצים לשירות זה. מה ברצונך לעשות?
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 py-2">
          <Button
            onClick={() => runMode('notify')}
            disabled={isLoading}
            className="bg-green-600 hover:bg-green-700 text-white justify-start h-auto py-3"
          >
            {loadingAction === 'notify' ? (
              <Loader2 className="h-5 w-5 ml-3 animate-spin" />
            ) : (
              <UserCheck className="h-5 w-5 ml-3" />
            )}
            <div className="text-right">
              <div className="font-semibold">שלח עדכון לספקים</div>
              <div className="text-xs opacity-90 font-normal">תישלח התראת עדכון לספקים והסטטוס שלהם יחזור ל"ממתין"</div>
            </div>
          </Button>

          <Button
            onClick={() => runMode('cancel')}
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
              <div className="font-semibold">בטל את השיבוצים בשירות זה</div>
              <div className="text-xs opacity-90 font-normal">הספקים יוסרו מהשירות ויקבלו התראת ביטול</div>
            </div>
          </Button>

          <Button
            onClick={() => runMode('nothing')}
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
              <div className="text-xs text-gray-600 font-normal">השעה תתעדכן במערכת בלבד. הספקים לא יקבלו התראה.</div>
            </div>
          </Button>
        </div>

        <DialogFooter>
          <p className="text-xs text-gray-500 text-right w-full">
            יש לבחור אחת מהאפשרויות לפני סגירת חלון זה
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}