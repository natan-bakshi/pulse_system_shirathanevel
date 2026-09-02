import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, FileDown, RotateCcw, Share2, Unlink } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import CreditDocumentDialog from "@/components/billing/CreditDocumentDialog";
import ShareDocumentDialog from "@/components/billing/ShareDocumentDialog";
import { getEventContactList } from "@/lib/eventContactList";

const labels = { invoice: "חשבונית מס", receipt: "קבלה", invoice_receipt: "חשבונית מס/קבלה", invoice_credit: "חשבונית זיכוי", proforma: "חשבונית עסקה" };
const statuses = { open: "פתוח", fully_credited: "זוכה במלואו", partially_credited: "זוכה חלקית", cancelled: "בוטל" };

export default function EventDocumentsCard({ eventId, isAdmin, event }) {
  const contacts = React.useMemo(() => getEventContactList(event), [event]);
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState(null);
  const [documentToCredit, setDocumentToCredit] = useState(null);
  const [documentToShare, setDocumentToShare] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  const { data: documents = [] } = useQuery({
    queryKey: ["eventFinancialDocuments", eventId],
    queryFn: () => base44.entities.FinancialDocument.filter({ linked_event_id: eventId }),
    enabled: !!eventId
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["eventFinancialDocuments", eventId] });
    queryClient.invalidateQueries({ queryKey: ["financialDocuments"] });
  };

  const runAction = async (fn, successMessage) => {
    try { await fn(); refresh(); toast.success(successMessage); }
    catch (error) { toast.error(error.response?.data?.error || error.message); }
  };

  const handleRefreshPdf = async (doc) => {
    setBusyId(doc.id);
    await runAction(() => base44.functions.invoke("invoice4uRefreshDocumentPdf", { documentId: doc.id }), "קישור המסמך עודכן");
    setBusyId(null);
  };

  const handleDetach = async (doc) => {
    if (!window.confirm("לנתק את המסמך מהאירוע? המסמך יישמר בלשונית התשלומים ללא שיוך.")) return;
    await runAction(() => base44.entities.FinancialDocument.update(doc.id, { is_detached_from_event: true }), "המסמך נותק מהאירוע");
  };

  const handleCredit = async (reason) => {
    setActionLoading(true);
    await runAction(() => base44.functions.invoke("invoice4uCancelInvoice", { documentId: documentToCredit.id, reason }), "מסמך הזיכוי הופק");
    setActionLoading(false);
    setDocumentToCredit(null);
  };

  const handleShare = async (payload) => {
    setActionLoading(true);
    await runAction(() => base44.functions.invoke("shareFinancialDocument", { documentId: documentToShare.id, ...payload }), "המסמך נשלח");
    setActionLoading(false);
    setDocumentToShare(null);
  };

  const visible = documents.filter((doc) => !doc.is_detached_from_event);

  return (
    <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
      <CardHeader><h3 className="text-lg font-semibold">מסמכים פיננסיים</h3></CardHeader>
      <CardContent>
        {visible.length === 0 ? <div className="py-4 text-center text-gray-500">אין מסמכים לאירוע זה</div> : (
          <div className="space-y-3">
            {visible.map((doc) => {
              const pdf = doc.pdf_original_url || doc.pdf_certified_url;
              const canCredit = isAdmin && ["invoice", "invoice_receipt"].includes(doc.document_type) && doc.invoice4u_id && doc.status === "open";
              return (
                <div key={doc.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-gray-50 p-3">
                  <div>
                    <div className="font-medium">{labels[doc.document_type] || doc.document_type} {doc.document_number || ""}</div>
                    <div className="text-sm text-gray-600">₪{Number(doc.total || 0).toLocaleString()} · {statuses[doc.status] || doc.status}{doc.issue_date ? ` · ${format(new Date(doc.issue_date), "dd/MM/yyyy")}` : ""}</div>
                  </div>
                  <div className="flex gap-1">
                    {pdf && <Button asChild variant="ghost" size="icon" title="צפייה והורדה"><a href={pdf} target="_blank" rel="noopener noreferrer"><Download className="h-4 w-4" /></a></Button>}
                    {isAdmin && doc.invoice4u_id && <Button variant="ghost" size="icon" title={pdf ? "רענן קישור PDF" : "הפק PDF"} disabled={busyId === doc.id} onClick={() => handleRefreshPdf(doc)}><FileDown className="h-4 w-4" /></Button>}
                    {isAdmin && pdf && <Button variant="ghost" size="icon" title="שיתוף" onClick={() => setDocumentToShare(doc)}><Share2 className="h-4 w-4" /></Button>}
                    {canCredit && <Button variant="ghost" size="icon" title="הפק זיכוי מלא" onClick={() => setDocumentToCredit(doc)}><RotateCcw className="h-4 w-4" /></Button>}
                    {isAdmin && <Button variant="ghost" size="icon" title="נתק מאירוע" onClick={() => handleDetach(doc)}><Unlink className="h-4 w-4" /></Button>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
      <CreditDocumentDialog document={documentToCredit} onClose={() => setDocumentToCredit(null)} onConfirm={handleCredit} loading={actionLoading} />
      <ShareDocumentDialog document={documentToShare} onClose={() => setDocumentToShare(null)} onConfirm={handleShare} loading={actionLoading} contacts={contacts} />
    </Card>
  );
}