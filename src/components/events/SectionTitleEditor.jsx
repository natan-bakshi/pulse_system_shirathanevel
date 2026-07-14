import React from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

const colorStyles = {
  red: {
    box: "border-red-200 bg-red-50/40",
    title: "text-red-900",
    input: "border-red-200 bg-white/80 focus-visible:ring-red-700"
  },
  purple: {
    box: "border-purple-200 bg-purple-50/40",
    title: "text-purple-900",
    input: "border-purple-200 bg-white/80 focus-visible:ring-purple-700"
  },
  orange: {
    box: "border-orange-200 bg-orange-50/40",
    title: "text-orange-800",
    input: "border-orange-200 bg-white/80 focus-visible:ring-orange-700"
  }
};

export default function SectionTitleEditor({ value, fallback, placeholder, onChange, onBlur, color = "red", badge }) {
  const styles = colorStyles[color] || colorStyles.red;
  const title = value?.trim() || fallback;

  return (
    <div className={`rounded-xl border p-3 ${styles.box}`}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <h4 className={`text-sm font-semibold truncate ${styles.title}`}>{title}</h4>
          {badge && <Badge className="text-xs shrink-0">{badge}</Badge>}
        </div>
        {onChange && (
          <Input
            value={value || ""}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            placeholder={placeholder}
            className={`text-sm h-8 sm:max-w-xs ${styles.input}`}
          />
        )}
      </div>
    </div>
  );
}