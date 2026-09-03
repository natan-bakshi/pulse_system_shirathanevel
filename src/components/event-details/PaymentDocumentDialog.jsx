import React, { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import DialogLanguageToggle from "@/components/billing/DialogLanguageToggle";
import { DOCUMENT_TYPE_LABELS_EN, PAYMENT_METHOD_LABELS_EN, billingText } from "@/components/billing/billingI18n";
import { DOCUMENT_TYPE_LABELS, PAYMENT_METHOD_LABELS } from "@/components/billing/documentTypes";
import { getEventContactList } from "@/lib/eventContactList";
import { getCurrencySymbol } from "@/components/utils/currencyUtils";

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

// הפקת מסמך עבור תשלום שנרשם ידנית - כל הפרטים מולאו מראש מהתשלום ומהאירוע וניתנים לעריכה.
export default function PaymentDocumentDialog({ open, onOpenChange, payment, event, documentType = "invoice_receipt", onCreated }) {
  const [lang, setLang] = useState("he");
  const [customer, setCustomer] = useState({ name: "", identifier: "", phone: "", email: "" });
  const [item, setItem] = useState({ name: "", quantity: 1, price: "" });
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [sendToClient, setSendToClient] = useState(false);
  const [channel, setChannel] = useState("email");
  const [recipient, setRecipient] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const text = billingText(lang);
  const amount = round2(payment?.amount);
  const symbol = getCurrencySymbol(payment?.currency || event?.primary_currency || "ILS");
  const typeLabel = lang === "en" ? DOCUMENT_TYPE_LABELS_EN[documentType] : DOCUMENT_TYPE_LABELS[documentType];
  const methods = lang === "en" ? PAYMENT_METHOD_LABELS_EN : PAYMENT_METHOD_LABELS;

  useEffect(() => {
    if (!open || !payment) return;
    const contact = getEventContactList(event)[0] || {};
    const defaultName = payment.payer_name || contact.name || event?.family_name || "";
    const defaultEmail = payment.payer_email || contact.email || "";
    const defaultPhone = payment.payer_phone || contact.phone || "";
    setLang(payment.document_language === "en" ? "en" : "he");
    setCustomer({ name: defaultName, identifier: "", phone: defaultPhone, email: defaultEmail });
    setItem({ name: event?.event_name ? `תשלום עבור ${event.event_name}` : (payment.notes || "תשלום"), quantity: 1, price: round2(payment.amount) });
    setPaymentMethod(payment.payment_method || "cash");
    setSendToClient(false);
    setChannel(defaultEmail ? "email" : "whatsapp");
    setRecipient(defaultEmail || defaultPhone);
    setError("");
  }, [open, payment, event]);

  const lineTotal = useMemo(() => round2((parseFloat(item.price) || 0) * (parseFloat(item.quantity) || 0)), [item]);
  const totalMismatch = Math.abs(lineTotal - amount) > 0.01;
  const canSubmit = !loading && customer.name.trim() && !totalMismatch && (!sendToClient || recipient.trim());

  const submit = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await base44.functions.invoke("invoice4uCreateManualDocument", {
        paymentId: payment.id,
        documentType,
        language: lang,
        customer,
        item: { name: item.name, quantity: parseFloat(item.quantity) || 1, price: parseFloat(item.price) || 0 },
        paymentMethod,
        subject: item.name
      });
      if (response.data?.error) throw new Error(response.data.error);
      const document = response.data?.document;
      if (sendToClient && document?.id) {
        try {
          await base44.functions.invoke("shareFinancialDocument", { documentId: document.id, channel, recipients: [recipient.trim()] });
        } catch (shareError) {
          setError("המסמך הופק אך השליחה ללקוח נכשלה: " + (shareError.response?.data?.error || shareError.message));
          onCreated?.(document);
          setLoading(false);
          return;
        }
      }
      onOpenChange(false);
      onCreated?.(document);
    } catch (submitError) {
      setError(submitError.response?.data?.error || submitError.message);
    } finally {
      setLoading(false);
    }
  };

  if (!payment) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={text.dir} className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3 pe-6">
            <span>{lang === "en" ? `${text.issue} ${typeLabel}` : `הפקת ${typeLabel}`}</span>
            <DialogLanguageToggle lang={lang} onChange={setLang} />
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="rounded-lg bg-gray-50 p-3 text-sm">
            <div className="flex justify-between font-semibold"><span>{text.amount}</span><span>{symbol}{amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
          </div>

          <div className="space-y-3 rounded-lg border border-gray-200 p-3">
            <Label className="font-semibold">{text.customerDetails}</Label>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label className="text-xs text-gray-500">{text.clientName}</Label><Input value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} /></div>
              <div><Label className="text-xs text-gray-500">{text.identifier}</Label><Input dir="ltr" value={customer.identifier} onChange={(e) => setCustomer({ ...customer, identifier: e.target.value })} /></div>
              <div><Label className="text-xs text-gray-500">{text.phone}</Label><Input dir="ltr" value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} /></div>
              <div><Label className="text-xs text-gray-500">{text.email}</Label><Input type="email" dir="ltr" value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} /></div>
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-gray-200 p-3">
            <Label className="font-semibold">{text.documentLines}</Label>
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="sm:col-span-2"><Label className="text-xs text-gray-500">{text.itemDescription}</Label><Input value={item.name} onChange={(e) => setItem({ ...item, name: e.target.value })} placeholder={text.itemNamePlaceholder} /></div>
              <div><Label className="text-xs text-gray-500">{text.quantity}</Label><Input type="number" inputMode="decimal" dir="ltr" value={item.quantity} onChange={(e) => setItem({ ...item, quantity: e.target.value })} /></div>
              <div><Label className="text-xs text-gray-500">{lang === "en" ? "Unit price (incl. VAT)" : "מחיר ליחידה (כולל מע״מ)"}</Label><Input type="number" inputMode="decimal" dir="ltr" value={item.price} onChange={(e) => setItem({ ...item, price: e.target.value })} /></div>
            </div>
            {totalMismatch && <p className="text-xs text-amber-600">{lang === "en" ? "The line total must match the payment amount" : "סך השורה חייב להיות זהה לסכום התשלום"} ({symbol}{amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}).</p>}
          </div>

          <div>
            <Label>{text.paymentMethod}</Label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(methods).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3 rounded-lg border border-gray-200 p-3">
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox checked={sendToClient} onCheckedChange={(checked) => setSendToClient(!!checked)} />
              <span className="text-sm">{lang === "en" ? "Send the document to the customer after it is issued" : "שלח את המסמך ללקוח לאחר ההפקה"}</span>
            </label>
            {sendToClient && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-xs text-gray-500">{text.channel}</Label>
                  <Select value={channel} onValueChange={(value) => { setChannel(value); setRecipient(value === "email" ? customer.email : customer.phone); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="email">{text.emailChannel}</SelectItem>
                      <SelectItem value="whatsapp">{text.whatsapp}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label className="text-xs text-gray-500">{channel === "email" ? text.emailForLink : text.phoneForLink}</Label><Input dir="ltr" value={recipient} onChange={(e) => setRecipient(e.target.value)} /></div>
              </div>
            )}
          </div>

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