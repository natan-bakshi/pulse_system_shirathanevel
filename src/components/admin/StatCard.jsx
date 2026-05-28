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

  const gradientBorders = {
    wine: "from-red-800 via-red-600 to-red-800",
    gold: "from-amber-500 via-amber-400 to-amber-600",
    blue: "from-red-800 via-red-600 to-red-800",
    green: "from-amber-500 via-amber-400 to-amber-600",
    purple: "from-red-800 via-red-600 to-red-800",
    orange: "from-amber-500 via-amber-400 to-amber-600"
  };

  return (
    <>
      {/* Mobile: gradient border wrapper */}
      <div className={`sm:hidden rounded-xl p-[2.5px] bg-gradient-to-br ${gradientBorders[color]} shadow-lg hover:shadow-xl transition-shadow duration-300`}>
        <div className="bg-white rounded-[10px] p-2.5 text-center">
          <p className="text-[10px] font-medium text-gray-600 leading-tight">{title}</p>
          <p className="text-lg font-bold text-gray-900 mt-0.5">{value}</p>
        </div>
      </div>
      {/* Desktop: original card */}
      <Card className="hidden sm:block bg-white/95 backdrop-blur-sm shadow-xl hover:shadow-2xl transition-shadow duration-300">
        <CardContent className="p-6">
          <div className="flex items-center justify-between gap-2">
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
    </>
  );
}