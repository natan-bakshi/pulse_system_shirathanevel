import React, { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { 
  Edit, Trash2, Plus, Save, Loader2, GripVertical, 
  Copy, ClipboardPaste, Check 
} from 'lucide-react';
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter 
} from "@/components/ui/dialog";

export default function ScheduleCard({
  event,
  isAdmin,
  editingSection,
  setEditingSection,
  editableSchedule,
  setEditableSchedule,
  handleSaveSchedule,
  isSavingSchedule
}) {
  const [importText, setImportText] = useState("");
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  // 1. העתקה ללוח
  const copyToClipboard = () => {
    if (!event.schedule) return;
    const text = event.schedule
      .map(item => `◦ ${item.time ? item.time + ' - ' : ''}${item.activity}`)
      .join('\n');
    
    navigator.clipboard.writeText(text);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  // 2. ניתוח טקסט חכם (מזהה מספר פעילויות בשורה אחת)
  const processBulkImport = () => {
    const lines = importText.split('\n').filter(line => line.trim() !== "");
    const allParsedItems = [];

    lines.forEach(line => {
      // רג'קס גלובלי לחיפוש כל מופעי השעה בשורה
      const timeRegex = /(\d{1,2})[\.:](\d{2})/g;
      let match;
      const matches = [];

      // שלב א': מציאת כל השעות והמיקומים שלהן בשורה
      while ((match = timeRegex.exec(line)) !== null) {
        matches.push({
          fullMatch: match[0],
          hours: match[1],
          minutes: match[2],
          index: match.index
        });
      }

      if (matches.length === 0) {
        // אם אין שעה בכלל, מוסיפים את כל השורה כפעילות ללא שעה
        const cleanActivity = line.replace(/^[^a-zA-Z0-9א-ת]+/, '').trim();
        if (cleanActivity) {
          allParsedItems.push({ time: "", activity: cleanActivity, notes: "" });
        }
      } else {
        // שלב ב': חיתוך הטקסט שבין שעה לשעה
        for (let i = 0; i < matches.length; i++) {
          const currentTime = matches[i];
          const nextTime = matches[i + 1];
          
          const formattedTime = `${currentTime.hours.padStart(2, '0')}:${currentTime.minutes}`;
          
          // הטקסט שמתחיל אחרי השעה הנוכחית ועד השעה הבאה (או סוף השורה)
          const startPos = currentTime.index + currentTime.fullMatch.length;
          const endPos = nextTime ? nextTime.index : line.length;
          
          let activity = line.substring(startPos, endPos).trim();
          // ניקוי תווים מיותרים בתחילת הפעילות
          activity = activity.replace(/^[^a-zA-Z0-9א-ת]+/, '').trim();

          allParsedItems.push({ 
            time: formattedTime, 
            activity: activity || "פעילות חדשה", 
            notes: "" 
          });
        }
      }
    });

    setEditableSchedule([...editableSchedule, ...allParsedItems]);
    setImportText("");
    setIsImportOpen(false);
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(editableSchedule);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    setEditableSchedule(items);
  };

  const handleScheduleChange = (index, field, value) => {
    const newSchedule = [...editableSchedule];
    newSchedule[index] = { ...newSchedule[index], [field]: value };
    setEditingSection('schedule'); // וודא שאנחנו במוד עריכה
    setEditableSchedule(newSchedule);
  };

  const addScheduleItem = () => {
    setEditableSchedule([...editableSchedule, { time: "", activity: "", notes: "" }]);
  };

  const removeScheduleItem = (index) => {
    setEditableSchedule(editableSchedule.filter((_, i) => i !== index));
  };

  return (
    <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
      <CardHeader>
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold">לוח זמנים</h3>
            {event.schedule?.length > 0 && (
              <Button variant="ghost" size="sm" onClick={copyToClipboard} className="h-8 w-8 p-0">
                {isCopied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
              </Button>
            )}
          </div>
          {isAdmin && editingSection !== 'schedule' && (
            <Button variant="outline" size="sm" onClick={() => { 
              setEditingSection('schedule'); 
              setEditableSchedule([...(event.schedule || [])]); 
            }}>
              <Edit className="h-4 w-4 ml-2" />ערוך
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {editingSection === 'schedule' ? (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={addScheduleItem} className="flex-1">
                <Plus className="h-4 w-4 ml-1" />הוסף ידנית
              </Button>
              
              <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
                <DialogTrigger asChild>
                  <Button variant="secondary" size="sm" className="flex-1">
                    <ClipboardPaste className="h-4 w-4 ml-1" />טעינה חכמה
                  </Button>
                </DialogTrigger>
                <DialogContent dir="rtl">
                  <DialogHeader>
                    <DialogTitle>ייבוא לו"ז מהיר</DialogTitle>
                  </DialogHeader>
                  <div className="py-4">
                    <Textarea 
                      placeholder="הדבק כאן... (למשל: 10.00 קבלת פנים 11.30 חופה)&#10;המערכת תפריד זמנים ופעילויות באופן אוטומטי." 
                      className="h-64 font-mono text-sm" 
                      value={importText}
                      onChange={(e) => setImportText(e.target.value)}
                    />
                  </div>
                  <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={() => setIsImportOpen(false)}>ביטול</Button>
                    <Button onClick={processBulkImport}>הוסף ללו"ז</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>

            <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable droppableId="schedule-edit">
                {(provided) => (
                  <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-2">
                    {editableSchedule.map((item, index) => (
                       <Draggable key={`item-${index}`} draggableId={`item-${index}`} index={index}>
                         {(provided) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            className="flex gap-2 items-center p-2 bg-gray-100 rounded-lg"
                          >
                            <GripVertical className="h-5 w-5 text-gray-400 shrink-0" />
                            <Input
                              type="time"
                              value={item.time}
                              onChange={(e) => handleScheduleChange(index, "time", e.target.value)}
                              className="w-24 sm:w-32"
                            />
                            <Input
                              value={item.activity}
                              onChange={(e) => handleScheduleChange(index, "activity", e.target.value)}
                              placeholder="פעילות"
                              className="flex-1"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeScheduleItem(index)}
                              className="shrink-0"
                            >
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          </div>
                         )}
                       </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
            
            <div className="flex gap-2 justify-end pt-4">
              <Button variant="outline" onClick={() => setEditingSection(null)} disabled={isSavingSchedule}>ביטול</Button>
              <Button onClick={handleSaveSchedule} disabled={isSavingSchedule}>
                {isSavingSchedule && <Loader2 className="h-4 w-4 ml-2 animate-spin" />}
                <Save className="h-4 w-4 ml-2" />
                שמור
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {(event.schedule && event.schedule.length > 0) ? (
              event.schedule.map((item, index) => (
                <div key={index} className="p-3 bg-gray-50 rounded border-r-4 border-red-800 transition-all hover:bg-gray-100">
                  <div className="flex items-start gap-4">
                    <div className="font-bold text-red-800 min-w-[55px] pt-0.5">
                      {item.time || "--:--"}
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-gray-900">{item.activity}</div>
                      {item.notes && <div className="text-sm text-gray-600 mt-1">{item.notes}</div>}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-6 text-gray-500 italic">אין לו"ז מעודכן</div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}