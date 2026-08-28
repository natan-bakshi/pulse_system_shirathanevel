import React, { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default function CreditDocumentDialog({ document, onClose, onConfirm, loading }) {
  const [reason, setReason] = useState("");
  return <Dialog open={!!document} onOpenChange={(open) => !open && onClose()}><DialogContent><DialogHeader><DialogTitle>זיכוי מלא לחשבונית</DialogTitle></DialogHeader><p className="text-sm text-gray-600">יופק מסמך זיכוי מלא עבור מסמך מספר {document?.document_number || "—"}. לא ניתן לבטל פעולה זו.</p><div><Label htmlFor="credit-reason">סיבת הזיכוי</Label><Textarea id="credit-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="לדוגמה: ביטול עסקה" /></div><DialogFooter><Button variant="outline" onClick={onClose} disabled={loading}>ביטול</Button><Button variant="destructive" onClick={() => onConfirm(reason)} disabled={loading}>{loading ? "מפיק זיכוי..." : "הפק זיכוי מלא"}</Button></DialogFooter></DialogContent></Dialog>;
}