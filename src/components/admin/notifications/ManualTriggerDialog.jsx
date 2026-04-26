import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Send } from "lucide-react";
import { toast } from "sonner";

// דיאלוג שליחה ידנית של תבנית התראה לאירוע ספציפי
export default function ManualTriggerDialog({ open, onOpenChange, template }) {
  const [selectedEventId, setSelectedEventId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Fetch upcoming events for selection
  const { data: upcomingEvents = [] } = useQuery({
    queryKey: ['upcomingEventsForTrigger'],
    queryFn: () => base44.entities.Event.filter({ status: 'confirmed' }, '-event_date', 50),
    enabled: open
  });

  const handleTrigger = async () => {
    if (!selectedEventId || !template) return;
    
    setIsSubmitting(true);
    try {
      const res = await base44.functions.invoke('manualTriggerNotification', {
        template_id: template.id,
        event_id: selectedEventId
      });
      
      if (res.data?.success) {
        toast.success(`ההתראה נשלחה בהצלחה! (${res.data.results.whatsapp_sent} הודעות ווצאפ)`);
        onOpenChange(false);
      } else {
        toast.error("שגיאה בשליחת ההתראה: " + (res.data?.error || 'Unknown error'));
      }
    } catch (error) {
      console.error("Manual trigger failed", error);
      toast.error("שגיאה בתקשורת עם השרת");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]" dir="rtl">
        <DialogHeader>
          <DialogTitle>שליחה ידנית: {template?.name}</DialogTitle>
          <DialogDescription>
            בחר אירוע לשליחת ההתראה. הפעולה תשלח הודעות מיידית לכל הנמענים הרלוונטיים (עוקף תזמון ושעות שקט).
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>בחר אירוע</Label>
            <Select value={selectedEventId} onValueChange={setSelectedEventId}>
              <SelectTrigger>
                <SelectValue placeholder="חפש אירוע..." />
              </SelectTrigger>
              <SelectContent>
                {upcomingEvents.map(event => (
                  <SelectItem key={event.id} value={event.id}>
                     {event.family_name} - {event.event_name} ({new Date(event.event_date).toLocaleDateString('he-IL')})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
          <Button 
            onClick={handleTrigger} 
            disabled={!selectedEventId || isSubmitting}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {isSubmitting ? <span className="animate-spin ml-2">⏳</span> : <Send className="ml-2 h-4 w-4" />}
            שלח עכשיו
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}