import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function ShareDocumentDialog({ document, onClose, onConfirm, loading, contacts = [] }) {
  const [channel, setChannel] = useState("email");
  const [selected, setSelected] = useState([]);
  const [recipient, setRecipient] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => { if (document) { setChannel("email"); setSelected([]); setRecipient(""); setMessage(""); } }, [document]);
  useEffect(() => { setSelected([]); }, [channel]);

  const valueOf = (contact) => (channel === "email" ? contact.email : contact.phone);
  const available = contacts.filter((contact) => valueOf(contact));
  const toggle = (value) => setSelected((prev) => prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]);

  const recipients = [...selected, ...(recipient.trim() ? [recipient.trim()] : [])];

  return (
    <Dialog open={!!document} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>שיתוף מסמך {document?.document_number || ""}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>ערוץ שליחה</Label>
            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="email">אימייל</SelectItem>
                <SelectItem value="whatsapp">וואטסאפ</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {available.length > 0 && (
            <div>
              <Label>אנשי הקשר של האירוע</Label>
              <div className="mt-2 space-y-2 rounded border border-gray-200 p-3">
                {available.map((contact) => {
                  const value = valueOf(contact);
                  return (
                    <label key={value} className="flex cursor-pointer items-center gap-2 text-sm">
                      <Checkbox checked={selected.includes(value)} onCheckedChange={() => toggle(value)} />
                      <span className="font-medium">{contact.name}</span>
                      <span dir="ltr" className="text-gray-500">{value}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <Label htmlFor="share-recipient">{channel === "email" ? "כתובת אימייל נוספת" : "מספר טלפון נוסף"}</Label>
            <Input id="share-recipient" dir="ltr" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder={channel === "email" ? "client@example.com" : "0501234567"} />
          </div>
          <div>
            <Label htmlFor="share-message">הודעה נלווית (אופציונלי)</Label>
            <Textarea id="share-message" value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>ביטול</Button>
          <Button onClick={() => onConfirm({ channel, recipients, message: message.trim() })} disabled={loading || recipients.length === 0}>
            {loading ? "שולח..." : `שלח${recipients.length > 1 ? ` (${recipients.length})` : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}