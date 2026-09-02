import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function ShareDocumentDialog({ document, onClose, onConfirm, loading }) {
  const [channel, setChannel] = useState("email");
  const [recipient, setRecipient] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => { if (document) { setChannel("email"); setRecipient(""); setMessage(""); } }, [document]);

  return (
    <Dialog open={!!document} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
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
          <div>
            <Label htmlFor="share-recipient">{channel === "email" ? "כתובת אימייל" : "מספר טלפון"}</Label>
            <Input id="share-recipient" dir="ltr" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder={channel === "email" ? "client@example.com" : "0501234567"} />
          </div>
          <div>
            <Label htmlFor="share-message">הודעה נלווית (אופציונלי)</Label>
            <Textarea id="share-message" value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>ביטול</Button>
          <Button onClick={() => onConfirm({ channel, recipient: recipient.trim(), message: message.trim() })} disabled={loading || !recipient.trim()}>{loading ? "שולח..." : "שלח"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}