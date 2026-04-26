import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Save } from 'lucide-react';
import { base44 } from '@/api/base44Client';

/**
 * דיאלוג מינימלי ליצירת אירוע חדש מתוך הצעת מחיר ידנית.
 * חובה: שם אירוע + תאריך. שאר השדות אופציונליים — נטענים אחר כך דרך עריכת אירוע.
 */
export default function QuickEventCreateDialog({ open, onOpenChange, onCreated }) {
  const [eventName, setEventName] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const reset = () => {
    setEventName('');
    setEventDate('');
    setFamilyName('');
  };

  const handleClose = () => {
    if (isSaving) return;
    reset();
    onOpenChange(false);
  };

  const handleCreate = async () => {
    if (!eventName.trim() || !eventDate) {
      alert('שם אירוע ותאריך הם שדות חובה');
      return;
    }
    setIsSaving(true);
    try {
      // family_name is required by schema — use eventName as fallback if not provided
      const created = await base44.entities.Event.create({
        event_name: eventName.trim(),
        event_date: eventDate,
        family_name: familyName.trim() || eventName.trim(),
        status: 'quote'
      });
      onCreated?.(created);
      reset();
      onOpenChange(false);
    } catch (e) {
      console.error('Failed to create quick event:', e);
      alert('שגיאה ביצירת האירוע: ' + (e.message || 'שגיאה לא ידועה'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>יצירת אירוע חדש מהצעה</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>שם האירוע *</Label>
            <Input value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder="לדוגמה: בר מצווה של מיכאל" disabled={isSaving} />
          </div>
          <div>
            <Label>תאריך האירוע *</Label>
            <Input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} disabled={isSaving} />
          </div>
          <div>
            <Label>שם משפחה (אופציונלי)</Label>
            <Input value={familyName} onChange={(e) => setFamilyName(e.target.value)} placeholder="ניתן להשאיר ריק" disabled={isSaving} />
            <p className="text-xs text-gray-500 mt-1">
              ניתן להשלים פרטים נוספים (שירותים, חבילות, וכו') בעריכת האירוע לאחר היצירה.
            </p>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose} disabled={isSaving}>ביטול</Button>
          <Button onClick={handleCreate} disabled={isSaving}>
            {isSaving ? <Loader2 className="h-4 w-4 ml-2 animate-spin" /> : <Save className="h-4 w-4 ml-2" />}
            צור אירוע ושייך
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}