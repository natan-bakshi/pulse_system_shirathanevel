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

  return (
    <Card className="bg-white/95 backdrop-blur-sm shadow-lg sm:shadow-xl hover:shadow-2xl transition-shadow duration-300">
      <CardContent className="p-3 sm:p-6">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs sm:text-sm font-medium text-gray-600 truncate">{title}</p>
            <p className="text-xl sm:text-2xl font-bold text-gray-900 mt-0.5 sm:mt-1">{value}</p>
          </div>
          <div className={`p-2 sm:p-3 rounded-full bg-gradient-to-r ${colorClasses[color]} shadow-lg shrink-0`}>
            <Icon className="h-4 w-4 sm:h-6 sm:w-6 text-white" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}