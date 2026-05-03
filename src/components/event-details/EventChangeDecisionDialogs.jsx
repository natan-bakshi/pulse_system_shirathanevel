import React from 'react';
import DateChangeDecisionDialog from './DateChangeDecisionDialog';
import SupplierArrivalTimeChangeDialog from './SupplierArrivalTimeChangeDialog';

/**
 * Tiny wrapper that mounts both decision dialogs that the admin may need to see
 * when changing event date/time/location or supplier_arrival_time on a service.
 *
 * Extracted from EventDetails.jsx solely to keep that file under the line-count limit;
 * does not change any behavior.
 */
export default function EventChangeDecisionDialogs({
  isAdmin,
  event,
  loadEventData,
  arrivalTimeChangeDialog,
  setArrivalTimeChangeDialog,
}) {
  if (!isAdmin) return null;
  return (
    <>
      {event?.date_change_pending_action && (
        <DateChangeDecisionDialog open={true} event={event} onResolved={loadEventData} />
      )}
      {arrivalTimeChangeDialog && (
        <SupplierArrivalTimeChangeDialog
          open={true}
          onOpenChange={(v) => { if (!v) setArrivalTimeChangeDialog(null); }}
          eventServiceId={arrivalTimeChangeDialog.eventServiceId}
          serviceName={arrivalTimeChangeDialog.serviceName}
          oldArrivalTime={arrivalTimeChangeDialog.oldArrivalTime}
          newArrivalTime={arrivalTimeChangeDialog.newArrivalTime}
          onResolved={() => {
            setArrivalTimeChangeDialog(null);
            loadEventData();
          }}
        />
      )}
    </>
  );
}