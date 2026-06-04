import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, GripVertical, ChevronUp, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const BLOCK_TYPES = [
  { value: 'quote_date', label: 'תאריך הנפקת הצעה', color: 'bg-gray-100 text-gray-700' },
  { value: 'event_header', label: 'כותרת ראשית (פרטי אירוע)', color: 'bg-blue-100 text-blue-700' },
  { value: 'intro', label: 'פתיח מעוצב (קונספט)', color: 'bg-purple-100 text-purple-700' },
  { value: 'services', label: 'שירותים וחבילות', color: 'bg-green-100 text-green-700' },
  { value: 'excluded_services', label: 'שירותים חיצוניים (צד שלישי)', color: 'bg-teal-100 text-teal-700' },
  { value: 'financial_summary', label: 'סיכום כספי', color: 'bg-amber-100 text-amber-700' },
  { value: 'schedule', label: 'לוח זמנים', color: 'bg-orange-100 text-orange-700' },
  { value: 'payment_terms', label: 'תנאי תשלום', color: 'bg-red-100 text-red-700' },
  { value: 'agreement_disclaimer', label: 'תנאי התקשרות', color: 'bg-rose-100 text-rose-700' },
  { value: 'notes', label: 'הערות', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'assigned_suppliers', label: 'ספקים משובצים', color: 'bg-indigo-100 text-indigo-700' },
  { value: 'tasks_summary', label: 'משימות לביצוע', color: 'bg-pink-100 text-pink-700' },
  { value: 'spacer', label: 'רווח', color: 'bg-gray-50 text-gray-500' },
  { value: 'divider', label: 'קו הפרדה', color: 'bg-gray-50 text-gray-500' },
  { value: 'footer', label: 'כותרת תחתונה', color: 'bg-gray-100 text-gray-600' },
  { value: 'custom_html', label: 'טקסט חופשי', color: 'bg-cyan-100 text-cyan-700' },
  { value: 'custom_text', label: 'טקסט חופשי (עם משתנים)', color: 'bg-violet-100 text-violet-700' },
];

const BLOCK_LABELS = BLOCK_TYPES.reduce((acc, bt) => { acc[bt.value] = bt.label; return acc; }, {});
const BLOCK_COLORS = BLOCK_TYPES.reduce((acc, bt) => { acc[bt.value] = bt.color; return acc; }, {});

// Blocks that don't need subtitle
const NO_SUBTITLE_BLOCKS = ['spacer', 'divider', 'quote_date', 'footer'];

export default function OrganizerBlocksEditor({ blocks, onChange, fields = [], availableVars = [] }) {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [selectedBlockType, setSelectedBlockType] = useState('');

  const addBlock = () => {
    if (!selectedBlockType) return;
    const newBlock = {
      block_id: `block_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      block_type: selectedBlockType,
      order: blocks.length,
      enabled: true,
      subtitle_title: getDefaultSubtitle(selectedBlockType),
    };
    // Handle field blocks
    if (selectedBlockType.startsWith('field:')) {
      const fieldId = selectedBlockType.replace('field:', '');
      const field = fields.find(f => f.id === fieldId);
      newBlock.block_type = 'field';
      newBlock.field_id = fieldId;
      newBlock.field_label = field?.name || fieldId;
      newBlock.subtitle_title = '';
    }
    // Handle custom_text blocks
    if (selectedBlockType === 'custom_text') {
      newBlock.content = '';
    }
    onChange([...blocks, newBlock]);
    setShowAddDialog(false);
    setSelectedBlockType('');
  };

  const removeBlock = (index) => {
    onChange(blocks.filter((_, i) => i !== index));
  };

  const moveBlock = (index, direction) => {
    const newBlocks = [...blocks];
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= newBlocks.length) return;
    [newBlocks[index], newBlocks[targetIndex]] = [newBlocks[targetIndex], newBlocks[index]];
    // Update order
    newBlocks.forEach((b, i) => { b.order = i; });
    onChange(newBlocks);
  };

  const updateBlockSubtitle = (index, value) => {
    const updated = [...blocks];
    updated[index] = { ...updated[index], subtitle_title: value };
    onChange(updated);
  };

  const updateBlockContent = (index, value) => {
    const updated = [...blocks];
    updated[index] = { ...updated[index], content: value };
    onChange(updated);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h4 className="font-semibold text-sm">בלוקים בהצעת מחיר ({blocks.length})</h4>
          <p className="text-xs text-gray-500">הגדר סדר ומבנה הצעת המחיר. ריק = מבנה ברירת מחדל הקיים</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowAddDialog(true)}>
          <Plus className="h-4 w-4 ml-1" />
          הוסף בלוק
        </Button>
      </div>

      {blocks.length === 0 && (
        <div className="text-center py-6 border-2 border-dashed rounded-lg text-gray-400 text-sm">
          לא הוגדרו בלוקים - ישמש מבנה הצעה ברירת מחדל
        </div>
      )}

      <div className="space-y-2">
        {blocks.map((block, index) => {
          const showSubtitle = !NO_SUBTITLE_BLOCKS.includes(block.block_type);
          return (
            <div key={block.block_id || index} className="border rounded-lg p-3 bg-gray-50/50">
              <div className="flex items-center gap-2">
                <div className="flex flex-col gap-0.5">
                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => moveBlock(index, -1)} disabled={index === 0}>
                    <ChevronUp className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => moveBlock(index, 1)} disabled={index === blocks.length - 1}>
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </div>
                <Badge className={`${block.block_type === 'field' ? 'bg-emerald-100 text-emerald-700' : (BLOCK_COLORS[block.block_type] || 'bg-gray-100')} text-xs shrink-0`}>
                  {block.block_type === 'field' ? `שדה: ${block.field_label || ''}` : (BLOCK_LABELS[block.block_type] || block.block_type)}
                </Badge>
                <div className="flex-1 min-w-0">
                  {showSubtitle && (
                    <Input
                      value={block.subtitle_title || ''}
                      onChange={(e) => updateBlockSubtitle(index, e.target.value)}
                      placeholder="כותרת משנה (אופציונלי)"
                      className="h-8 text-sm"
                    />
                  )}
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 shrink-0" onClick={() => removeBlock(index)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              {block.block_type === 'custom_text' && (
                <div className="mt-2 space-y-2 pr-8">
                  <Textarea
                    value={block.content || ''}
                    onChange={(e) => updateBlockContent(index, e.target.value)}
                    placeholder={'לדוגמה:\n((מיקום האירוע: [location]))\n((שעת האירוע: [event_time]))'}
                    rows={3}
                    className="text-sm font-mono"
                  />
                  {availableVars.length > 0 && (
                    <div className="bg-blue-50 rounded p-2">
                      <p className="text-[10px] text-blue-600 mb-1 font-medium">לחץ על משתנה להוספה · [שם] = ערך · ((טקסט [שם])) = מותנה</p>
                      <div className="flex flex-wrap gap-1">
                        {availableVars.map(v => (
                          <Badge
                            key={v.key}
                            variant="outline"
                            className="text-[10px] cursor-pointer hover:bg-blue-100"
                            onClick={() => updateBlockContent(index, (block.content || '') + `[${v.key}]`)}
                            title={v.label}
                          >
                            [{v.key}]
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add Block Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent dir="rtl" className="sm:max-w-[450px]" onPointerDownOutside={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>הוסף בלוק</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 max-h-[60vh] overflow-y-auto">
            {BLOCK_TYPES.map(bt => (
              <button
                key={bt.value}
                onClick={() => setSelectedBlockType(bt.value)}
                className={`w-full text-right p-3 rounded-lg border transition-colors ${
                  selectedBlockType === bt.value 
                    ? 'border-blue-500 bg-blue-50' 
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <Badge className={`${bt.color} text-xs`}>{bt.label}</Badge>
              </button>
            ))}
            {fields.length > 0 && (
              <>
                <div className="text-xs font-semibold text-gray-500 pt-3 border-t mt-1">שדות מוגדרים (מטאב שדות)</div>
                {fields.map(f => (
                  <button
                    key={`field:${f.id}`}
                    onClick={() => setSelectedBlockType(`field:${f.id}`)}
                    className={`w-full text-right p-3 rounded-lg border transition-colors ${
                      selectedBlockType === `field:${f.id}` 
                        ? 'border-blue-500 bg-blue-50' 
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <Badge className="bg-emerald-100 text-emerald-700 text-xs">שדה: {f.name}</Badge>
                  </button>
                ))}
              </>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>ביטול</Button>
            <Button onClick={addBlock} disabled={!selectedBlockType}>הוסף</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function getDefaultSubtitle(blockType) {
  const defaults = {
    event_header: 'פרטי אירוע',
    intro: '',
    services: 'חבילת ההפקה כוללת',
    excluded_services: 'שירותים נוספים',
    financial_summary: 'סיכום כספי',
    schedule: 'לוח זמנים',
    payment_terms: 'תנאי תשלום',
    agreement_disclaimer: '',
    notes: 'הערות',
    assigned_suppliers: 'ספקים משובצים',
    tasks_summary: 'משימות לביצוע',
    custom_html: '',
    custom_text: '',
  };
  return defaults[blockType] || '';
}