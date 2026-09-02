import React, { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import DocumentItemsEditor from "@/components/billing/DocumentItemsEditor";
import DocumentPaymentsEditor from "@/components/billing/DocumentPaymentsEditor";
import DialogLanguageToggle from "@/components/billing/DialogLanguageToggle";
import { DOCUMENT_TYPE_LABELS_EN, billingText } from "@/components/billing/billingI18n";
import { STANDALONE_DOCUMENT_TYPES, getStandaloneType } from "@/components/billing/documentTypes";

const emptyCustomer = { name: "", identifier: "", phone: "", email: "", address: "" };

// דיאלוג הנפקת מסמך ידני עצמאי - ללא תלות בתשלום קיים במערכת.
export default function ManualDocumentDialog({ open, initialType = "invoice", onOpenChange, events = [], vatPercent = 18, onCreated }) {
  const [documentType, setDocumentType] = useState(initialType);
  const [customer, setCustomer] = useState(emptyCustomer);
  const [items, setItems] = useState([]);
  const [payments, setPayments] = useState([]);
  const [linkedEventId, setLinkedEventId] = useState("none");
  const [subject, setSubject] = useState("");
  const [comments, setComments] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lang, setLang] = useState("he");
  const text = billingText(lang);

  useEffect(() => {
    if (!open) return;
    setDocumentType(initialType);
    setCustomer(emptyCustomer);
    setItems([{ name: "", quantity: 1, price: "", taxRate: vatPercent }]);
    setPayments([{ amount: "", type: "cash", date: new Date().toISOString().slice(0, 10) }]);
    setLinkedEventId("none");
    setSubject("");
    setComments("");
    setError("");
    setLang("he");
  }, [open, initialType, vatPercent]);

  const config = getStandaloneType(documentType);
  const typeLabel = lang === "en" ? DOCUMENT_TYPE_LABELS_EN[documentType] || config.label : config.label;
  const itemsTotal = useMemo(() => items.reduce((sum, item) => {
    const line = (parseFloat(item.price) || 0) * (parseFloat(item.quantity) || 0);
    const rate = item.taxRate === "" || item.taxRate === undefined ? vatPercent : parseFloat(item.taxRate) || 0;
    return sum + line * (1 + rate / 100);
  }, 0), [items, vatPercent]);

  const hasValidItems = items.some((item) => String(item.name || "").trim() && parseFloat(item.price));
  const hasValidPayments = payments.some((payment) => parseFloat(payment.amount) > 0);
  const canSubmit = !loading && customer.name.trim() && (!config.needsItems || hasValidItems) && (!config.needsPayments || hasValidPayments);

  const submit = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await base44.functions.invoke("invoice4uCreateStandaloneDocument", {
        documentType,
        customer,
        items: config.needsItems ? items : [],
        payments: config.needsPayments ? payments : [],
        linkedEventId: linkedEventId === "none" ? "" : linkedEventId,
        subject,
        comments,
        language: lang
      });
      if (response.data?.error) throw new Error(response.data.error);
      onOpenChange(false);
      onCreated?.(response.data.document);
    } catch (submitError) {
      setError(submitError.response?.data?.error || submitError.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={text.dir} className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3 pe-6">
            <span>{lang === "en" ? `${text.issue} ${typeLabel}` : `הפקת ${typeLabel}`}</span>
            <DialogLanguageToggle lang={lang} onChange={setLang} />
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div>
            <Label>{text.documentType}</Label>
            <Select value={documentType} onValueChange={setDocumentType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STANDALONE_DOCUMENT_TYPES.map((type) => <SelectItem key={type.value} value={type.value}>{lang === "en" ? DOCUMENT_TYPE_LABELS_EN[type.value] || type.label : type.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3 rounded-lg border border-gray-200 p-3">
            <Label className="font-semibold">{text.customerDetails}</Label>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label className="text-xs text-gray-500">{text.clientName}</Label><Input value={customer.name} onChange={(event) => setCustomer({ ...customer, name: event.target.value })} /></div>
              <div><Label className="text-xs text-gray-500">{text.identifier}</Label><Input dir="ltr" value={customer.identifier} onChange={(event) => setCustomer({ ...customer, identifier: event.target.value })} /></div>
              <div><Label className="text-xs text-gray-500">{text.phone}</Label><Input dir="ltr" value={customer.phone} onChange={(event) => setCustomer({ ...customer, phone: event.target.value })} /></div>
              <div><Label className="text-xs text-gray-500">{text.email}</Label><Input type="email" dir="ltr" value={customer.email} onChange={(event) => setCustomer({ ...customer, email: event.target.value })} /></div>
              <div className="sm:col-span-2"><Label className="text-xs text-gray-500">{text.address}</Label><Input value={customer.address} onChange={(event) => setCustomer({ ...customer, address: event.target.value })} /></div>
            </div>
          </div>

          {config.needsItems && (
            <div className="rounded-lg border border-gray-200 p-3">
              <DocumentItemsEditor items={items} onChange={setItems} vatPercent={vatPercent} lang={lang} />
            </div>
          )}

          {config.needsPayments && (
            <div className="rounded-lg border border-gray-200 p-3">
              <DocumentPaymentsEditor payments={payments} onChange={setPayments} expectedTotal={config.needsItems ? Math.round(itemsTotal * 100) / 100 : 0} lang={lang} />
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>{text.linkEventOptional}</Label>
              <Select value={linkedEventId} onValueChange={setLinkedEventId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-64">
                  <SelectItem value="none">{text.noEventLink}</SelectItem>
                  {events.map((event) => <SelectItem key={event.id} value={event.id}>{event.event_name || event.family_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>{text.documentSubject}</Label><Input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder={typeLabel} /></div>
          </div>

          <div><Label>{text.documentComments}</Label><Textarea value={comments} onChange={(event) => setComments(event.target.value)} /></div>

          {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>{text.cancel}</Button>
          <Button className="bg-red-800 text-white hover:bg-red-900" onClick={submit} disabled={!canSubmit}>
            {loading ? <><Loader2 className="h-4 w-4 animate-spin" />{text.issuing}</> : `${text.issue} ${typeLabel}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}