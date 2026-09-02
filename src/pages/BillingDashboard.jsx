import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreditCard, FileText, Landmark } from "lucide-react";
import FinancialDocumentsTable from "@/components/billing/FinancialDocumentsTable";
import BillingConfiguration from "@/components/billing/BillingConfiguration";
import CreditDocumentDialog from "@/components/billing/CreditDocumentDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function BillingDashboard() {
  const queryClient = useQueryClient();
  const [documentToCredit, setDocumentToCredit] = useState(null);
  const [isCrediting, setIsCrediting] = useState(false);
  const [refreshingPdfId, setRefreshingPdfId] = useState(null);
  const { data: documents = [], isLoading } = useQuery({ queryKey: ["financialDocuments"], queryFn: () => base44.entities.FinancialDocument.list() });
  const { data: events = [] } = useQuery({ queryKey: ["events"], queryFn: () => base44.entities.Event.list() });
  const eventsById = useMemo(() => new Map(events.map((event) => [event.id, event])), [events]);
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
  const creditDocument = async (reason) => { setIsCrediting(true); try { await base44.functions.invoke('invoice4uCancelInvoice', { documentId: documentToCredit.id, reason }); setDocumentToCredit(null); queryClient.invalidateQueries({ queryKey: ["financialDocuments"] }); } catch (error) { alert("לא ניתן להפיק זיכוי: " + (error.response?.data?.error || error.message)); } finally { setIsCrediting(false); } };
  return <div className="space-y-6"><div><h1 className="text-3xl font-bold text-white">תשלומים וחשבוניות</h1><p className="mt-1 text-white/80">ניהול המסמכים הפיננסיים שהופקו דרך המערכת.</p></div><Tabs defaultValue="documents"><TabsList className="grid w-full max-w-md grid-cols-2"><TabsTrigger value="documents">מסמכים</TabsTrigger><TabsTrigger value="settings">הגדרות</TabsTrigger></TabsList><TabsContent value="documents" className="space-y-6 mt-6"><div className="grid gap-4 sm:grid-cols-3"><Card className="bg-white/95"><CardContent className="flex items-center gap-3 p-5"><FileText className="h-8 w-8 text-red-800" /><div><p className="text-sm text-gray-500">מסמכים</p><p className="text-2xl font-bold">{documents.length}</p></div></CardContent></Card><Card className="bg-white/95"><CardContent className="flex items-center gap-3 p-5"><CreditCard className="h-8 w-8 text-red-800" /><div><p className="text-sm text-gray-500">מסמכים פתוחים</p><p className="text-2xl font-bold">{documents.filter((doc) => doc.status === "open").length}</p></div></CardContent></Card><Card className="bg-white/95"><CardContent className="flex items-center gap-3 p-5"><Landmark className="h-8 w-8 text-red-800" /><div><p className="text-sm text-gray-500">סך מסמכים פתוחים</p><p className="text-2xl font-bold">₪{documents.filter((doc) => doc.status === "open").reduce((sum, doc) => sum + (Number(doc.total) || 0), 0).toLocaleString()}</p></div></CardContent></Card></div><Card className="bg-white/95"><CardHeader><CardTitle>מסמכים פיננסיים</CardTitle></CardHeader><CardContent>{isLoading ? <p className="py-8 text-center text-gray-500">טוען מסמכים...</p> : <FinancialDocumentsTable documents={documents} eventsById={eventsById} onDetach={detachDocument} onCredit={setDocumentToCredit} onRefreshPdf={refreshDocumentPdf} refreshingPdfId={refreshingPdfId} />}</CardContent></Card></TabsContent><TabsContent value="settings" className="mt-6"><BillingConfiguration /></TabsContent></Tabs><CreditDocumentDialog document={documentToCredit} onClose={() => setDocumentToCredit(null)} onConfirm={creditDocument} loading={isCrediting} /></div>;
}