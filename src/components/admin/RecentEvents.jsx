import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock } from "lucide-react";
import { format } from "date-fns";
import { he } from "date-fns/locale";

export default function RecentEvents({ events }) {
  const getStatusColor = (status) => {
    const colors = {
      planning: "bg-yellow-100 text-yellow-800",
      confirmed: "bg-blue-100 text-blue-800",
      in_progress: "bg-green-100 text-green-800",
      completed: "bg-gray-100 text-gray-800",
      cancelled: "bg-red-100 text-red-800"
    };
    return colors[status] || "bg-gray-100 text-gray-800";
  };

  const getStatusText = (status) => {
    const statusTexts = {
      planning: "תכנון",
      confirmed: "מאושר",
      in_progress: "בביצוע",
      completed: "הושלם",
      cancelled: "בוטל"
    };
    return statusTexts[status] || status;
  };

  return (
    <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
      <CardHeader>
        <CardTitle className="text-xl font-bold flex items-center gap-2">
          <Clock className="h-5 w-5" />
          אירועים אחרונים
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {events.map((event) => (
            <div
              key={event.id}
              className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <div className="flex-1">
                <h4 className="font-medium text-gray-900">{event.event_name}</h4>
                <p className="text-sm text-gray-600">{event.family_name}</p>
                <div className="flex items-center gap-2 mt-1">
                  <Calendar className="h-3 w-3 text-gray-400" />
                  <span className="text-xs text-gray-500">
                    {format(new Date(event.event_date), "dd/MM/yyyy", { locale: he })}
                  </span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Badge className={getStatusColor(event.status)}>
                  {getStatusText(event.status)}
                </Badge>
                {event.total_price && (
                  <span className="text-sm font-medium text-gray-900">
                    ₪{event.total_price.toLocaleString()}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}