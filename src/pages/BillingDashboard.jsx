import React, { Suspense, lazy, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreditCard, FileText, Landmark, Loader2 } from "lucide-react";
import FinancialDocumentsTable from "@/components/billing/FinancialDocumentsTable";
import GeneralPaymentsTable from "@/components/billing/GeneralPaymentsTable";
import BillingActionButtons from "@/components/billing/BillingActionButtons";
import { getEventContactList } from "@/lib/eventContactList";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// טעינה עצלה: הדוחות, ההגדרות והדיאלוגים נטענים רק כשנפתחים בפועל,
// כך שכניסה ללשונית התשלומים נשארת מהירה.
const BillingReports = lazy(() => import("@/components/billing/BillingReports"));
const BillingConfiguration = lazy(() => import("@/components/billing/BillingConfiguration"));
const CancelInvoiceWizard = lazy(() => import("@/components/billing/CancelInvoiceWizard"));
const GeneralClearingDialog = lazy(() => import("@/components/billing/GeneralClearingDialog"));
const ShareDocumentDialog = lazy(() => import("@/components/billing/ShareDocumentDialog"));
const PaymentLinkDialog = lazy(() => import("@/components/billing/PaymentLinkDialog"));
const ManualDocumentDialog = lazy(() => import("@/components/billing/ManualDocumentDialog"));

const Loading = () => <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-red-800" /></div>;
const cache = { staleTime: 3 * 60 * 1000, gcTime: 10 * 60 * 1000 };

export default function BillingDashboard() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("documents");
  const [documentToCredit, setDocumentToCredit] = useState(null);
  const [cancelStep, setCancelStep] = useState("credit");
  const [isCrediting, setIsCrediting] = useState(false);
  const [refreshingPdfId, setRefreshingPdfId] = useState(null);
  const [showGeneralClearing, setShowGeneralClearing] = useState(false);
  const [documentToShare, setDocumentToShare] = useState(null);
  const [isSharing, setIsSharing] = useState(false);
  const [startingClearing, setStartingClearing] = useState(false);
  const [showPaymentLink, setShowPaymentLink] = useState(false);
  const [sendingLink, setSendingLink] = useState(false);
  const [paymentLinkResult, setPaymentLinkResult] = useState(null);
  const [manualDocumentType, setManualDocumentType] = useState(null);

  const { data: documents = [], isLoading } = useQuery({ queryKey: ["financialDocuments"], queryFn: () => base44.entities.FinancialDocument.list(), ...cache });
  const { data: events = [] } = useQuery({ queryKey: ["events"], queryFn: () => base44.entities.Event.list(), ...cache });
  const { data: settingRecords = [] } = useQuery({ queryKey: ["appSettings"], queryFn: () => base44.entities.AppSettings.list(), ...cache });
  const { data: generalPayments = [] } = useQuery({ queryKey: ["generalPayments"], queryFn: () => base44.entities.Payment.filter({ charge_type: "general" }, "-payment_date"), ...cache });

  // נתוני היתרות הפתוחות נטענים רק כשנכנסים ללשונית הדוחות.
  const reportsActive = tab === "reports";
  const { data: allEventServices = [], isFetching: servicesFetching } = useQuery({ queryKey: ["allEventServices"], queryFn: () => base44.entities.EventService.list(), enabled: reportsActive, ...cache });
  const { data: allPayments = [], isFetching: paymentsFetching } = useQuery({ queryKey: ["allPayments"], queryFn: () => base44.entities.Payment.list(), enabled: reportsActive, ...cache });

  const settings = useMemo(() => settingRecords.reduce((all, record) => ({ ...all, [record.setting_key]: record.setting_value }), {}), [settingRecords]);
  const eventsById = useMemo(() => new Map(events.map((event) => [event.id, event])), [events]);
  const documentsById = useMemo(() => new Map(documents.map((doc) => [doc.id, doc])), [documents]);
  const shareContacts = useMemo(() => getEventContactList(documentToShare?.linked_event_id ? eventsById.get(documentToShare.linked_event_id) : null), [documentToShare, eventsById]);
  const openDocuments = useMemo(() => documents.filter((doc) => doc.status === "open"), [documents]);
  const openTotal = useMemo(() => openDocuments.reduce((sum, doc) => sum + (Number(doc.total) || 0), 0), [openDocuments]);
  const vatRate = (Number(settings.vat_rate) || 18) / 100;
  const exchangeRate = Number(settings.usd_ils_exchange_rate) || 3.6;

  const startGeneralClearing = async (form) => {
    setStartingClearing(true);
    try {
      const { data } = await base44.functions.invoke('invoice4uCreateClearingRequest', { amount: form.amount, description: form.description, language: form.language, payer: { fullName: form.fullName, phone: form.phone, email: form.email, isInterestedInInvoice: form.isInterestedInInvoice } });
      if (data?.redirectUrl) window.location.href = data.redirectUrl;
    } catch (error) {
      alert("לא ניתן לפתוח סליקה: " + (error.response?.data?.error || error.message));
    } finally { setStartingClearing(false); }
  };

  const sendGeneralPaymentLink = async (form) => {
    setSendingLink(true);
    try {
      const { data } = await base44.functions.invoke('invoice4uCreateClearingRequest', { amount: form.amount, description: form.description, language: form.language, mode: "link", sendLink: { via: form.via, phone: form.phone, email: form.email }, payer: { fullName: form.fullName, phone: form.phone, email: form.email, isInterestedInInvoice: form.isInterestedInInvoice } });
      if (data?.error) throw new Error(data.error);
      setPaymentLinkResult({ paymentLink: data.paymentLink });
      queryClient.invalidateQueries({ queryKey: ["generalPayments"] });
    } catch (error) {
      alert("לא ניתן לשלוח קישור לתשלום: " + (error.response?.data?.error || error.message));
    } finally { setSendingLink(false); }
  };

  const onDocumentCreated = () => queryClient.invalidateQueries({ queryKey: ["financialDocuments"] });

  const detachDocument = async (document) => {
    if (!window.confirm(`לנתק את מסמך ${document.document_number || "זה"} מהאירוע? המסמך יישאר ברשימת המסמכים.`)) return;
    await base44.entities.FinancialDocument.update(document.id, { linked_event_id: "", is_detached_from_event: true });
    queryClient.invalidateQueries({ queryKey: ["financialDocuments"] });
  };

  const refreshDocumentPdf = async (document) => {
    setRefreshingPdfId(document.id);
    try {
      await base44.functions.invoke('invoice4uRefreshDocumentPdf', { documentId: document.id });
      queryClient.invalidateQueries({ queryKey: ["financialDocuments"] });
    } catch (error) {
      alert("לא ניתן להפיק PDF: " + (error.response?.data?.error || error.message));
    } finally { setRefreshingPdfId(null); }
  };

  const shareDocument = async (payload) => {
    setIsSharing(true);
    try {
      await base44.functions.invoke('shareFinancialDocument', { documentId: documentToShare.id, ...payload });
      setDocumentToShare(null);
    } catch (error) {
      alert("לא ניתן לשתף את המסמך: " + (error.response?.data?.error || error.message));
    } finally { setIsSharing(false); }
  };

  const startCancelWizard = (document) => { setCancelStep("credit"); setDocumentToCredit(document); };
  const closeCancelWizard = () => { setDocumentToCredit(null); setCancelStep("credit"); };
  const creditDocument = async (reason) => { setIsCrediting(true); try { await base44.functions.invoke('invoice4uCancelInvoice', { documentId: documentToCredit.id, reason }); setCancelStep("refund"); queryClient.invalidateQueries({ queryKey: ["financialDocuments"] }); } catch (error) { alert("לא ניתן להפיק זיכוי: " + (error.response?.data?.error || error.message)); } finally { setIsCrediting(false); } };
  const refundReceipt = async (reason) => { setIsCrediting(true); try { await base44.functions.invoke('invoice4uCancelInvoice', { documentId: documentToCredit.id, reason, step: "refund_receipt" }); setCancelStep("done"); queryClient.invalidateQueries({ queryKey: ["financialDocuments"] }); } catch (error) { alert("לא ניתן להפיק קבלה שלילית: " + (error.response?.data?.error || error.message)); } finally { setIsCrediting(false); } };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-white">תשלומים וחשבוניות</h1>
          <p className="mt-1 text-white/80">ניהול המסמכים הפיננסיים שהופקו דרך המערכת.</p>
        </div>
        <BillingActionButtons onImmediateClearing={() => setShowGeneralClearing(true)} onPaymentLink={() => setShowPaymentLink(true)} onCreateDocument={setManualDocumentType} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full max-w-lg grid-cols-3">
          <TabsTrigger value="documents">מסמכים</TabsTrigger>
          <TabsTrigger value="reports">דוחות</TabsTrigger>
          <TabsTrigger value="settings">הגדרות</TabsTrigger>
        </TabsList>

        <TabsContent value="documents" className="mt-6 space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="bg-white/95"><CardContent className="flex items-center gap-3 p-5"><FileText className="h-8 w-8 text-red-800" /><div><p className="text-sm text-gray-500">מסמכים</p><p className="text-2xl font-bold">{documents.length}</p></div></CardContent></Card>
            <Card className="bg-white/95"><CardContent className="flex items-center gap-3 p-5"><CreditCard className="h-8 w-8 text-red-800" /><div><p className="text-sm text-gray-500">מסמכים פתוחים</p><p className="text-2xl font-bold">{openDocuments.length}</p></div></CardContent></Card>
            <Card className="bg-white/95"><CardContent className="flex items-center gap-3 p-5"><Landmark className="h-8 w-8 text-red-800" /><div><p className="text-sm text-gray-500">סך מסמכים פתוחים</p><p className="text-2xl font-bold">₪{openTotal.toLocaleString()}</p></div></CardContent></Card>
          </div>

          <Card className="bg-white/95">
            <CardHeader><CardTitle>מסמכים פיננסיים</CardTitle></CardHeader>
            <CardContent>
              {isLoading ? <p className="py-8 text-center text-gray-500">טוען מסמכים...</p> : <FinancialDocumentsTable documents={documents} eventsById={eventsById} onDetach={detachDocument} onCredit={startCancelWizard} onRefreshPdf={refreshDocumentPdf} onShare={setDocumentToShare} refreshingPdfId={refreshingPdfId} />}
            </CardContent>
          </Card>

          <Card className="bg-white/95">
            <CardHeader><CardTitle>סליקות כלליות</CardTitle></CardHeader>
            <CardContent><GeneralPaymentsTable payments={generalPayments} documentsById={documentsById} /></CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reports" className="mt-6">
          <Suspense fallback={<Loading />}>
            <BillingReports
              documents={documents}
              events={events}
              eventsById={eventsById}
              generalPayments={generalPayments}
              eventServices={allEventServices}
              allPayments={allPayments}
              vatRate={vatRate}
              exchangeRate={exchangeRate}
              balancesLoading={servicesFetching || paymentsFetching}
            />
          </Suspense>
        </TabsContent>

        <TabsContent value="settings" className="mt-6">
          <Suspense fallback={<Loading />}><BillingConfiguration /></Suspense>
        </TabsContent>
      </Tabs>

      <Suspense fallback={null}>
        {documentToCredit && <CancelInvoiceWizard document={documentToCredit} step={cancelStep} onClose={closeCancelWizard} onCredit={creditDocument} onRefund={refundReceipt} loading={isCrediting} />}
        {showGeneralClearing && <GeneralClearingDialog open onOpenChange={setShowGeneralClearing} settings={settings} onStart={startGeneralClearing} loading={startingClearing} />}
        {documentToShare && <ShareDocumentDialog document={documentToShare} onClose={() => setDocumentToShare(null)} onConfirm={shareDocument} loading={isSharing} contacts={shareContacts} />}
        {showPaymentLink && <PaymentLinkDialog open onOpenChange={setShowPaymentLink} settings={settings} onSend={sendGeneralPaymentLink} loading={sendingLink} result={paymentLinkResult} onReset={() => setPaymentLinkResult(null)} />}
        {manualDocumentType && <ManualDocumentDialog open initialType={manualDocumentType} onOpenChange={(open) => !open && setManualDocumentType(null)} events={events} vatPercent={Number(settings.vat_rate) || 18} onCreated={onDocumentCreated} />}
      </Suspense>
    </div>
  );
}