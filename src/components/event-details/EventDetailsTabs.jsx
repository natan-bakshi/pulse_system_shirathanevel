import React from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Users, ListChecks, Wallet, ClipboardList } from 'lucide-react';
import EventOverviewCard from './EventOverviewCard';
import FamilyContactCard from './FamilyContactCard';
import ScheduleCard from './ScheduleCard';
import ServicesCard from './ServicesCard';
import PaymentsCard from './PaymentsCard';
import FinancialSummaryCard from './FinancialSummaryCard';
import EventTasksTab from '../tasks/EventTasksTab';

/**
 * עוטף את כל קלפי הפרטים של האירוע בלשוניות:
 *  1. פרטי אירוע ומשפחה (כולל לוז)
 *  2. שירותים וחבילות
 *  3. סיכום כספי (תשלומים + סיכום)
 *  4. משימות לביצוע (למנהלים בלבד)
 * שמירה מלאה על כל הפונקציונליות הקיימת.
 */
export default function EventDetailsTabs(props) {
  const {
    // משותפים
    event, isAdmin, isClient, isSupplier, currentUser,
    tasksSystemEnabled = true,
    editingSection, setEditingSection,
    // Overview
    eventDetailsData, setEventDetailsData,
    handleSaveEventDetails, isSavingEventDetails,
    handleStatusChange, handleDeleteEvent,
    // Family
    editableParents, setEditableParents,
    editableFamilyName, setEditableFamilyName,
    editableChildName, setEditableChildName,
    handleSaveFamilyDetails, isSavingFamilyDetails,
    // Schedule
    editableSchedule, setEditableSchedule,
    handleSaveSchedule, isSavingSchedule,
    // Services
    eventServices, allServices, allSuppliers, groupedServices,
    currentSupplierId,
    editableServices, setEditableServices,
    allInclusiveData, setAllInclusiveData,
    handleSaveServices, isSavingServices,
    selectedServicesForAction, setSelectedServicesForAction,
    handleDeleteSelectedServices,
    setSelectedServicesForPackage,
    setShowAddToPackageDialog, setShowAddServiceDialog,
    setShowAddExistingPackageDialog, setShowPackageDialog,
    handleDragEnd,
    handleOpenEditPackage, handleOpenAddServiceToPackage, handleDeletePackage,
    updateSupplierStatus, handleRemoveSupplier, handleUpdateSupplierNote,
    loadEventData,
    savingServiceField, setSavingServiceField, handleUpdateServiceField,
    setSelectedServiceForSupplier, setSupplierFormData, setShowSupplierDialog,
    handleRemoveFromPackage, handleDeleteService,
    handleToggleServiceExternal,
    groupedExternalServices,
    handleSaveExternalServicesTitle,
    exchangeRate, onPrimaryCurrencyChange,
    // Payments
    payments,
    setShowPaymentDialog, handleDeletePayment,
    setCurrentReceiptUrl, setCurrentReceiptPaymentId, setShowReceiptDialog,
    // Financial
    financials, financialEditData, setFinancialEditData,
    handleSaveFinancial, isSavingFinancial,
  } = props;

  const showTasksTab = isAdmin && tasksSystemEnabled;
  const tabsCount = showTasksTab ? 4 : 3;

  return (
    <Tabs defaultValue="details" className="w-full">
      <TabsList className={`grid w-full bg-white/80 backdrop-blur-sm ${tabsCount === 4 ? 'grid-cols-4' : 'grid-cols-3'}`}>
        <TabsTrigger value="details" className="text-xs sm:text-sm gap-1">
          <Users className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          <span className="hidden sm:inline">פרטי אירוע ומשפחה</span>
          <span className="sm:hidden">פרטים</span>
        </TabsTrigger>
        <TabsTrigger value="services" className="text-xs sm:text-sm gap-1">
          <ClipboardList className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          <span className="hidden sm:inline">שירותים וחבילות</span>
          <span className="sm:hidden">שירותים</span>
        </TabsTrigger>
        <TabsTrigger value="financial" className="text-xs sm:text-sm gap-1">
          <Wallet className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          <span className="hidden sm:inline">סיכום כספי</span>
          <span className="sm:hidden">כספי</span>
        </TabsTrigger>
        {showTasksTab && (
          <TabsTrigger value="tasks" className="text-xs sm:text-sm gap-1">
            <ListChecks className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            <span className="hidden sm:inline">משימות לביצוע</span>
            <span className="sm:hidden">משימות</span>
          </TabsTrigger>
        )}
      </TabsList>

      {/* לשונית 1: פרטי אירוע ומשפחה (כולל לוז) */}
      <TabsContent value="details" className="space-y-4 sm:space-y-6 mt-4">
        <EventOverviewCard
          event={event}
          isAdmin={isAdmin}
          editingSection={editingSection}
          setEditingSection={setEditingSection}
          eventDetailsData={eventDetailsData}
          setEventDetailsData={setEventDetailsData}
          handleSaveEventDetails={handleSaveEventDetails}
          isSavingEventDetails={isSavingEventDetails}
          handleStatusChange={handleStatusChange}
          handleDeleteEvent={handleDeleteEvent}
        />

        <FamilyContactCard
          event={event}
          isAdmin={isAdmin}
          isClient={isClient}
          editingSection={editingSection}
          setEditingSection={setEditingSection}
          editableParents={editableParents}
          setEditableParents={setEditableParents}
          editableFamilyName={editableFamilyName}
          setEditableFamilyName={setEditableFamilyName}
          editableChildName={editableChildName}
          setEditableChildName={setEditableChildName}
          handleSaveFamilyDetails={handleSaveFamilyDetails}
          isSavingFamilyDetails={isSavingFamilyDetails}
        />

        <ScheduleCard
          event={event}
          isAdmin={isAdmin}
          editingSection={editingSection}
          setEditingSection={setEditingSection}
          editableSchedule={editableSchedule}
          setEditableSchedule={setEditableSchedule}
          handleSaveSchedule={handleSaveSchedule}
          isSavingSchedule={isSavingSchedule}
        />
      </TabsContent>

      {/* לשונית 2: שירותים וחבילות */}
      <TabsContent value="services" className="space-y-4 sm:space-y-6 mt-4">
        <ServicesCard
          event={event}
          eventServices={eventServices}
          allServices={allServices}
          allSuppliers={allSuppliers}
          groupedServices={groupedServices}
          isAdmin={isAdmin}
          isClient={isClient}
          isSupplier={isSupplier}
          currentSupplierId={currentSupplierId}
          editingSection={editingSection}
          setEditingSection={setEditingSection}
          editableServices={editableServices}
          setEditableServices={setEditableServices}
          allInclusiveData={allInclusiveData}
          setAllInclusiveData={setAllInclusiveData}
          handleSaveServices={handleSaveServices}
          isSavingServices={isSavingServices}
          selectedServicesForAction={selectedServicesForAction}
          setSelectedServicesForAction={setSelectedServicesForAction}
          handleDeleteSelectedServices={handleDeleteSelectedServices}
          setSelectedServicesForPackage={setSelectedServicesForPackage}
          setShowAddToPackageDialog={setShowAddToPackageDialog}
          setShowAddServiceDialog={setShowAddServiceDialog}
          setShowAddExistingPackageDialog={setShowAddExistingPackageDialog}
          setShowPackageDialog={setShowPackageDialog}
          handleDragEnd={handleDragEnd}
          handleOpenEditPackage={handleOpenEditPackage}
          handleOpenAddServiceToPackage={handleOpenAddServiceToPackage}
          handleDeletePackage={handleDeletePackage}
          updateSupplierStatus={updateSupplierStatus}
          handleRemoveSupplier={handleRemoveSupplier}
          handleUpdateSupplierNote={handleUpdateSupplierNote}
          loadEventData={loadEventData}
          savingServiceField={savingServiceField}
          setSavingServiceField={setSavingServiceField}
          handleUpdateServiceField={handleUpdateServiceField}
          setSelectedServiceForSupplier={setSelectedServiceForSupplier}
          setSupplierFormData={setSupplierFormData}
          setShowSupplierDialog={setShowSupplierDialog}
          handleRemoveFromPackage={handleRemoveFromPackage}
          handleDeleteService={handleDeleteService}
          handleToggleServiceExternal={handleToggleServiceExternal}
          groupedExternalServices={groupedExternalServices}
          handleSaveExternalServicesTitle={handleSaveExternalServicesTitle}
          exchangeRate={exchangeRate}
          onPrimaryCurrencyChange={onPrimaryCurrencyChange}
        />
      </TabsContent>

      {/* לשונית 3: סיכום כספי - תשלומים + סיכום */}
      <TabsContent value="financial" className="space-y-4 sm:space-y-6 mt-4">
        {(isAdmin || isClient) && (
          <PaymentsCard
            event={event}
            payments={payments}
            isAdmin={isAdmin}
            setShowPaymentDialog={setShowPaymentDialog}
            handleDeletePayment={handleDeletePayment}
            setCurrentReceiptUrl={setCurrentReceiptUrl}
            setCurrentReceiptPaymentId={setCurrentReceiptPaymentId}
            setShowReceiptDialog={setShowReceiptDialog}
            exchangeRate={exchangeRate}
          />
        )}

        {(isAdmin || isClient) && (
          <FinancialSummaryCard
            event={event}
            financials={financials}
            isAdmin={isAdmin}
            editingSection={editingSection}
            setEditingSection={setEditingSection}
            financialEditData={financialEditData}
            setFinancialEditData={setFinancialEditData}
            handleSaveFinancial={handleSaveFinancial}
            isSavingFinancial={isSavingFinancial}
          />
        )}
      </TabsContent>

      {/* לשונית 4: משימות לביצוע (מנהלים בלבד + מערכת המשימות פעילה) */}
      {showTasksTab && (
        <TabsContent value="tasks" className="mt-4">
          <EventTasksTab eventId={event?.id} currentUser={currentUser} />
        </TabsContent>
      )}
    </Tabs>
  );
}