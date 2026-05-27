import { useState, useCallback } from 'react';

export function useEventExport({ event, eventServices, allServices, allSuppliers, payments, financials }) {
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportOptions, setExportOptions] = useState({
    eventDetails: true,
    familyDetails: true,
    services: true,
    suppliers: true,
    payments: true,
    financials: true,
    notes: true
  });

  const handleExportEvent = useCallback(() => {
    setShowExportDialog(true);
  }, []);

  const handleConfirmExport = useCallback(() => {
    const exportData = {};

    if (exportOptions.eventDetails) {
      exportData.eventDetails = {
        event_name: event.event_name,
        event_type: event.event_type,
        event_date: event.event_date,
        location: event.location,
        city: event.city,
        concept: event.concept,
        guest_count: event.guest_count,
        status: event.status
      };
    }

    if (exportOptions.familyDetails) {
      exportData.familyDetails = {
        family_name: event.family_name,
        child_name: event.child_name,
        parents: event.parents || []
      };
    }

    if (exportOptions.services) {
      exportData.services = eventServices.map(es => {
        const serviceDetails = allServices.find(s => s.id === es.service_id);
        return {
          service_name: serviceDetails?.service_name || es.service_name,
          custom_price: es.custom_price,
          quantity: es.quantity,
          includes_vat: es.includes_vat,
          package_name: es.package_name,
          notes: es.notes,
          client_notes: es.client_notes,
          service_description: serviceDetails?.service_description
        };
      });
    }

    if (exportOptions.suppliers) {
      exportData.suppliers = eventServices.map(es => {
        let supplierIds = [];
        let supplierStatuses = {};
        try {
          supplierIds = JSON.parse(es.supplier_ids || '[]');
          supplierStatuses = JSON.parse(es.supplier_statuses || '{}');
        } catch (e) {}

        const serviceDetails = allServices.find(s => s.id === es.service_id);
        const assignedSuppliers = allSuppliers.filter(sup => supplierIds.includes(sup.id)).map(sup => ({
          supplier_name: sup.supplier_name,
          status: supplierStatuses[sup.id] || 'pending'
        }));

        return {
          service_name: serviceDetails?.service_name || es.service_name,
          suppliers: assignedSuppliers
        };
      });
    }

    if (exportOptions.payments) {
      exportData.payments = payments.map(p => ({
        amount: p.amount,
        payment_date: p.payment_date,
        payment_method: p.payment_method,
        notes: p.notes,
        receipt_image_url: p.receipt_image_url
      }));
    }

    if (exportOptions.financials) {
      exportData.financials = {
        totalCostWithoutVat: financials.totalCostWithoutVat,
        vatAmount: financials.vatAmount,
        totalCostWithVat: financials.totalCostWithVat,
        discountAmount: financials.discountAmount,
        finalTotal: financials.finalTotal,
        totalPaid: financials.totalPaid,
        balance: financials.balance
      };
    }

    if (exportOptions.notes && event.notes) {
      exportData.notes = event.notes;
    }

    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `event_${event.family_name}_${event.event_date}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setShowExportDialog(false);
  }, [exportOptions, event, eventServices, allServices, allSuppliers, payments, financials]);

  return {
    showExportDialog,
    setShowExportDialog,
    exportOptions,
    setExportOptions,
    handleExportEvent,
    handleConfirmExport
  };
}