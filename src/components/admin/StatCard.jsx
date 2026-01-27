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
    <Card className="bg-white/95 backdrop-blur-sm shadow-xl hover:shadow-2xl transition-shadow duration-300">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-600">{title}</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
          </div>
          <div className={`p-3 rounded-full bg-gradient-to-r ${colorClasses[color]} shadow-lg`}>
            <Icon className="h-6 w-6 text-white" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}