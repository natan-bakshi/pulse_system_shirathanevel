import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, Trash2 } from "lucide-react";
import FieldLabel from "../FieldLabel";
import { AUDIENCES, CONDITION_FIELDS, OPERATORS } from "../constants";

// טאב 4: תנאים וקהלי יעד
export default function ConditionsTargetTab({ template, onChange }) {
  const update = (field, value) => onChange({ ...template, [field]: value });

  // Helper to parse conditions safely
  const getConditions = () => {
    try {
      if (!template.event_filter_condition) return [];
      const parsed = JSON.parse(template.event_filter_condition);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  };

  const updateConditions = (newConditions) => {
    update('event_filter_condition', JSON.stringify(newConditions));
  };

  const conditions = getConditions();

  return (
    <div className="space-y-4">
      {/* קהלי יעד */}
      <div>
        <FieldLabel 
          label="למי לשלוח?" 
          tooltip="בחר את קהלי היעד שיקבלו את ההתראה הזו"
        />
        <div className="flex flex-wrap gap-2 mt-2">
          {Object.entries(AUDIENCES).map(([value, info]) => (
            <TooltipProvider key={value}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant={template.target_audiences?.includes(value) ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      const audiences = template.target_audiences || [];
                      if (audiences.includes(value)) {
                        update('target_audiences', audiences.filter(a => a !== value));
                      } else {
                        update('target_audiences', [...audiences, value]);
                      }
                    }}
                  >
                    {info.label}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p className="text-sm">{info.description}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ))}
        </div>
      </div>

      {/* תנאים נוספים */}
      <div className="border rounded-lg p-3 bg-gray-50">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <h4 className="font-medium text-sm text-gray-700">תנאים נוספים</h4>
            <div className="flex bg-gray-100 rounded p-0.5">
              <button
                type="button"
                onClick={() => update('condition_logic', 'and')}
                className={`px-2 py-0.5 text-xs rounded transition-colors ${
                  (template.condition_logic || 'and') === 'and' 
                    ? 'bg-white shadow text-blue-600 font-medium' 
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                גם (AND)
              </button>
              <button
                type="button"
                onClick={() => update('condition_logic', 'or')}
                className={`px-2 py-0.5 text-xs rounded transition-colors ${
                  template.condition_logic === 'or' 
                    ? 'bg-white shadow text-blue-600 font-medium' 
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                או (OR)
              </button>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 text-xs text-blue-600 hover:bg-blue-50"
            onClick={() => updateConditions([...conditions, { field: 'status', operator: 'equals', value: '' }])}
          >
            <Plus className="h-3 w-3 ml-1" />
            הוסף תנאי
          </Button>
        </div>
        
        <div className="space-y-2">
          {conditions.length === 0 && (
            <p className="text-xs text-gray-400 italic">לא הוגדרו תנאים נוספים</p>
          )}
          
          {conditions.map((condition, idx) => (
            <div key={idx} className="flex gap-2 items-start bg-white p-2 rounded border">
              <div className="grid grid-cols-3 gap-2 flex-1">
                {/* Field Selector */}
                <div className="relative">
                  <Input
                    list={`fields-list-${idx}`}
                    className="h-8 text-xs pr-2"
                    placeholder="שדה"
                    value={condition.field}
                    onChange={(e) => {
                      const newConds = [...conditions];
                      newConds[idx] = { ...newConds[idx], field: e.target.value };
                      updateConditions(newConds);
                    }}
                  />
                  <datalist id={`fields-list-${idx}`}>
                    {Object.entries(CONDITION_FIELDS).map(([key, info]) => (
                      <option key={key} value={key}>{info.label}</option>
                    ))}
                  </datalist>
                </div>

                {/* Operator */}
                <Select
                  value={condition.operator}
                  onValueChange={(v) => {
                    const newConds = [...conditions];
                    newConds[idx] = { ...newConds[idx], operator: v };
                    updateConditions(newConds);
                  }}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(OPERATORS).map(([op, label]) => (
                      <SelectItem key={op} value={op}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Value Input */}
                {CONDITION_FIELDS[condition.field]?.type === 'select' ? (
                  <Select
                    value={condition.value}
                    onValueChange={(v) => {
                      const newConds = [...conditions];
                      newConds[idx] = { ...newConds[idx], value: v };
                      updateConditions(newConds);
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="בחר ערך" />
                    </SelectTrigger>
                    <SelectContent>
                      {CONDITION_FIELDS[condition.field].options.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    type={CONDITION_FIELDS[condition.field]?.type === 'number' ? 'number' : 'text'}
                    placeholder={CONDITION_FIELDS[condition.field]?.description || 'ערך'}
                    className="h-8 text-xs"
                    value={condition.value}
                    disabled={condition.operator === 'changed'}
                    onChange={(e) => {
                      const newConds = [...conditions];
                      newConds[idx] = { ...newConds[idx], value: e.target.value };
                      updateConditions(newConds);
                    }}
                  />
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-red-500 hover:bg-red-50 shrink-0"
                onClick={() => updateConditions(conditions.filter((_, i) => i !== idx))}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}