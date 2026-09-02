import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreditCard, FileText, Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import FinancialDocumentsTable from "@/components/billing/FinancialDocumentsTable";
import BillingConfiguration from "@/components/billing/BillingConfiguration";
import CancelInvoiceWizard from "@/components/billing/CancelInvoiceWizard";
import GeneralClearingDialog from "@/components/billing/GeneralClearingDialog";
import ShareDocumentDialog from "@/components/billing/ShareDocumentDialog";
import GeneralPaymentsTable from "@/components/billing/GeneralPaymentsTable";
import BillingActionButtons from "@/components/billing/BillingActionButtons";
import PaymentLinkDialog from "@/components/billing/PaymentLinkDialog";
import ManualDocumentDialog from "@/components/billing/ManualDocumentDialog";
import BillingReports from "@/components/billing/BillingReports";
import { getEventContactList } from "@/lib/eventContactList";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function BillingDashboard() {
  const queryClient = useQueryClient();
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
  const { data: documents = [], isLoading } = useQuery({ queryKey: ["financialDocuments"], queryFn: () => base44.entities.FinancialDocument.list() });
  const { data: events = [] } = useQuery({ queryKey: ["events"], queryFn: () => base44.entities.Event.list() });
  const { data: settingRecords = [] } = useQuery({ queryKey: ["appSettings"], queryFn: () => base44.entities.AppSettings.list() });
  const settings = useMemo(() => settingRecords.reduce((all, record) => ({ ...all, [record.setting_key]: record.setting_value }), {}), [settingRecords]);
  const eventsById = useMemo(() => new Map(events.map((event) => [event.id, event])), [events]);
  const { data: generalPayments = [] } = useQuery({ queryKey: ["generalPayments"], queryFn: () => base44.entities.Payment.filter({ charge_type: "general" }, "-payment_date") });
  const documentsById = useMemo(() => new Map(documents.map((doc) => [doc.id, doc])), [documents]);
  const shareContacts = useMemo(() => getEventContactList(documentToShare?.linked_event_id ? eventsById.get(documentToShare.linked_event_id) : null), [documentToShare, eventsById]);
  const startGeneralClearing = async (form) => {
    setStartingClearing(true);
    try {
      const { data } = await base44.functions.invoke('invoice4uCreateClearingRequest', { amount: form.amount, description: form.description, payer: { fullName: form.fullName, phone: form.phone, email: form.email, isInterestedInInvoice: form.isInterestedInInvoice } });
      if (data?.redirectUrl) window.location.href = data.redirectUrl;
    } catch (error) {
      alert("לא ניתן לפתוח סליקה: " + (error.response?.data?.error || error.message));
    } finally { setStartingClearing(false); }
  };
  const sendGeneralPaymentLink = async (form) => {
    setSendingLink(true);
    try {
      const { data } = await base44.functions.invoke('invoice4uCreateClearingRequest', { amount: form.amount, description: form.description, mode: "link", sendLink: { via: form.via, phone: form.phone, email: form.email }, payer: { fullName: form.fullName, phone: form.phone, email: form.email, isInterestedInInvoice: form.isInterestedInInvoice } });
      if (data?.error) throw new Error(data.error);
      setPaymentLinkResult({ paymentLink: data.paymentLink });
      queryClient.invalidateQueries({ queryKey: ["generalPayments"] });
    } catch (error) {
      alert("לא ניתן לשלוח קישור לתשלום: " + (error.response?.data?.error || error.message));
    } finally { setSendingLink(false); }
  };
  const onDocumentCreated = () => {
    queryClient.invalidateQueries({ queryKey: ["financialDocuments"] });
  };
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
    } finally {
      setRefreshingPdfId(null);
    }
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
  return <div className="space-y-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-3xl font-bold text-white">תשלומים וחשבוניות</h1><p className="mt-1 text-white/80">ניהול המסמכים הפיננסיים שהופקו דרך המערכת.</p></div><BillingActionButtons onImmediateClearing={() => setShowGeneralClearing(true)} onPaymentLink={() => setShowPaymentLink(true)} onCreateDocument={setManualDocumentType} /></div><Tabs defaultValue="documents"><TabsList className="grid w-full max-w-lg grid-cols-3"><TabsTrigger value="documents">מסמכים</TabsTrigger><TabsTrigger value="reports">דוחות</TabsTrigger><TabsTrigger value="settings">הגדרות</TabsTrigger></TabsList><TabsContent value="documents" className="space-y-6 mt-6"><div className="grid gap-4 sm:grid-cols-3"><Card className="bg-white/95"><CardContent className="flex items-center gap-3 p-5"><FileText className="h-8 w-8 text-red-800" /><div><p className="text-sm text-gray-500">מסמכים</p><p className="text-2xl font-bold">{documents.length}</p></div></CardContent></Card><Card className="bg-white/95"><CardContent className="flex items-center gap-3 p-5"><CreditCard className="h-8 w-8 text-red-800" /><div><p className="text-sm text-gray-500">מסמכים פתוחים</p><p className="text-2xl font-bold">{documents.filter((doc) => doc.status === "open").length}</p></div></CardContent></Card><Card className="bg-white/95"><CardContent className="flex items-center gap-3 p-5"><Landmark className="h-8 w-8 text-red-800" /><div><p className="text-sm text-gray-500">סך מסמכים פתוחים</p><p className="text-2xl font-bold">₪{documents.filter((doc) => doc.status === "open").reduce((sum, doc) => sum + (Number(doc.total) || 0), 0).toLocaleString()}</p></div></CardContent></Card></div><Card className="bg-white/95"><CardHeader><CardTitle>מסמכים פיננסיים</CardTitle></CardHeader><CardContent>{isLoading ? <p className="py-8 text-center text-gray-500">טוען מסמכים...</p> : <FinancialDocumentsTable documents={documents} eventsById={eventsById} onDetach={detachDocument} onCredit={startCancelWizard} onRefreshPdf={refreshDocumentPdf} onShare={setDocumentToShare} refreshingPdfId={refreshingPdfId} />}</CardContent></Card><Card className="bg-white/95"><CardHeader><CardTitle>סליקות כלליות</CardTitle></CardHeader><CardContent><GeneralPaymentsTable payments={generalPayments} documentsById={documentsById} /></CardContent></Card></TabsContent><TabsContent value="reports" className="mt-6"><BillingReports documents={documents} events={events} eventsById={eventsById} generalPayments={generalPayments} /></TabsContent><TabsContent value="settings" className="mt-6"><BillingConfiguration /></TabsContent></Tabs><CancelInvoiceWizard document={documentToCredit} step={cancelStep} onClose={closeCancelWizard} onCredit={creditDocument} onRefund={refundReceipt} loading={isCrediting} /><GeneralClearingDialog open={showGeneralClearing} onOpenChange={setShowGeneralClearing} settings={settings} onStart={startGeneralClearing} loading={startingClearing} /><ShareDocumentDialog document={documentToShare} onClose={() => setDocumentToShare(null)} onConfirm={shareDocument} loading={isSharing} contacts={shareContacts} /><PaymentLinkDialog open={showPaymentLink} onOpenChange={setShowPaymentLink} settings={settings} onSend={sendGeneralPaymentLink} loading={sendingLink} result={paymentLinkResult} onReset={() => setPaymentLinkResult(null)} /><ManualDocumentDialog open={!!manualDocumentType} initialType={manualDocumentType || "invoice"} onOpenChange={(open) => !open && setManualDocumentType(null)} events={events} vatPercent={Number(settings.vat_rate) || 18} onCreated={onDocumentCreated} /></div>;
}