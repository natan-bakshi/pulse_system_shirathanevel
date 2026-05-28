import React from "react";
import { Card, CardContent } from "@/components/ui/card";

export default function StatCard({ title, value, icon: Icon, color }) {
  const colorClasses = {
    wine: "from-red-800 to-red-700",
    gold: "from-amber-500 to-amber-600",
    blue: "from-red-800 to-red-700",
    green: "from-amber-500 to-amber-600",
    purple: "from-red-800 to-red-700",
    orange: "from-amber-500 to-amber-600"
  };

  const borderColors = {
    wine: "border-red-700",
    gold: "border-amber-500",
    blue: "border-red-700",
    green: "border-amber-500",
    purple: "border-red-700",
    orange: "border-amber-500"
  };

  return (
    <Card className={`bg-white/95 backdrop-blur-sm shadow-lg sm:shadow-xl hover:shadow-2xl transition-shadow duration-300 border-t-[3px] sm:border-t-0 ${borderColors[color]}`}>
      <CardContent className="p-2 sm:p-6">
        {/* Mobile: centered text only, no icon */}
        <div className="sm:hidden text-center">
          <p className="text-[10px] font-medium text-gray-600 leading-tight">{title}</p>
          <p className="text-lg font-bold text-gray-900 mt-0.5">{value}</p>
        </div>
        {/* Desktop: icon + text side by side */}
        <div className="hidden sm:flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-600 leading-tight">{title}</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
          </div>
          <div className={`p-3 rounded-full bg-gradient-to-r ${colorClasses[color]} shadow-lg shrink-0`}>
            <Icon className="h-6 w-6 text-white" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}