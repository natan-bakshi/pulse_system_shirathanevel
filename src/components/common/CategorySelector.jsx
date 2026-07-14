import React, { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function CategorySelector({ label = "קטגוריה", options = [], selectedCategories = [], onChange, multiple = false }) {
  const [newCategory, setNewCategory] = useState("");
  const selected = useMemo(() => selectedCategories.map(c => String(c || "").trim()).filter(Boolean), [selectedCategories]);
  const normalizedOptions = useMemo(() => Array.from(new Set(options.map(c => String(c || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "he")), [options]);
  const availableOptions = normalizedOptions.filter(category => !selected.includes(category));

  const addCategory = (category) => {
    const clean = String(category || "").trim();
    if (!clean) return;
    onChange(multiple ? Array.from(new Set([...selected, clean])) : [clean]);
    setNewCategory("");
  };

  const removeCategory = (category) => {
    onChange(selected.filter(item => item !== category));
  };

  return (
    <div className="space-y-2">
      {label && <Label>{label}</Label>}
      {availableOptions.length > 0 && (
        <Select key={selected.join("|")} onValueChange={addCategory}>
          <SelectTrigger>
            <SelectValue placeholder="בחר קטגוריה קיימת" />
          </SelectTrigger>
          <SelectContent>
            {availableOptions.map(category => (
              <SelectItem key={category} value={category}>{category}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <div className="flex gap-2">
        <Input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="או הקלד קטגוריה חדשה" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCategory(newCategory); } }} />
        <Button type="button" variant="outline" onClick={() => addCategory(newCategory)} disabled={!newCategory.trim()}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map(category => (
            <Badge key={category} variant="secondary" className="gap-1">
              {category}
              <button type="button" onClick={() => removeCategory(category)} className="hover:text-red-600" aria-label={`הסר ${category}`}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}