import React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, Calendar, Clock, MapPin, Eye } from "lucide-react";
import { format } from "date-fns";
import { he } from "date-fns/locale";

export default function EventCard({ event, onSelect, onStatusChange, totals }) {
  const getStatusText = (status) => {
    switch (status) {
      case "quote": return "הצעת מחיר";
      case "confirmed": return "אירוע סגור";
      case "in_progress": return "אירוע תפור";
      case "completed": return "אירוע עבר";
      case "cancelled": return "אירוע בוטל";
      default: return status;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case "quote": return "bg-yellow-100 text-yellow-800";
      case "confirmed": return "bg-blue-100 text-blue-800";
      case "in_progress": return "bg-green-100 text-green-800";
      case "completed": return "bg-gray-100 text-gray-800";
      case "cancelled": return "bg-red-100 text-red-800";
      default: return "bg-gray-100";
    }
  };
  
  // Use passed totals or fallbacks from event object if available (for backward compatibility)
  const finalTotal = totals?.finalTotal ?? event.finalTotal ?? 0;
  const totalPaid = totals?.totalPaid ?? event.totalPaid ?? 0;
  const balance = totals?.balance ?? event.balance ?? 0;
  const discountAmount = totals?.discountAmount ?? event.discount_amount ?? 0;

  return (
    <Card className="bg-white/95 backdrop-blur-sm shadow-xl flex flex-col hover:shadow-2xl transition-shadow duration-300 h-full w-full max-w-full overflow-hidden">
      <CardHeader className="p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row justify-between items-start gap-2">
            <CardTitle className="text-lg text-gray-900 break-words w-full">{event.event_name} - {event.family_name}</CardTitle>
            <Badge className={`${getStatusColor(event.status)} shrink-0`}>{getStatusText(event.status)}</Badge>
        </div>
        <p className="text-sm text-gray-600">{event.child_name && `לכבוד ${event.child_name}`}</p>
      </CardHeader>
      <CardContent className="flex-grow space-y-3 p-4 sm:p-6 pt-0">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div className="flex items-center gap-2 overflow-hidden"><Calendar className="h-4 w-4 text-gray-500 shrink-0" /><span className="truncate">{event.event_date ? format(new Date(event.event_date), 'dd/MM/yyyy', { locale: he }) : 'N/A'}</span></div>
          <div className="flex items-center gap-2 overflow-hidden"><Clock className="h-4 w-4 text-gray-500 shrink-0" /><span className="truncate">{event.event_time || 'N/A'}</span></div>
          <div className="flex items-center gap-2 overflow-hidden"><MapPin className="h-4 w-4 text-gray-500 shrink-0" /><span className="truncate">{event.location || 'N/A'}</span></div>
          <div className="flex items-center gap-2 overflow-hidden"><Users className="h-4 w-4 text-gray-500 shrink-0" /><span className="truncate">{event.guest_count || 0} אורחים</span></div>
        </div>
        <div className="text-sm text-gray-700 pt-3 border-t">
          <div className="flex justify-between items-center mb-1">
            <span>עלות כוללת:</span>
            <span className="font-semibold">₪{finalTotal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
          </div>
          {discountAmount > 0 && (
             <div className="flex justify-between items-center mb-1 text-red-600 text-xs">
               <span>הנחה:</span>
               <span>-₪{discountAmount.toLocaleString()}</span>
             </div>
          )}
          <div className="flex justify-between items-center mb-1 text-gray-600">
            <span>שולם:</span>
            <span>₪{totalPaid.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
          </div>
          <div className="flex justify-between items-center font-bold mt-2">
            <span>יתרה לתשלום:</span>
            <span className={balance > 0 ? "text-red-700" : "text-green-700"}>₪{balance.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
          </div>
        </div>
      </CardContent>
      <CardFooter className="p-4 sm:p-6 pt-0">
        <Button className="w-full bg-red-800 hover:bg-red-700 whitespace-normal h-auto py-2" onClick={() => onSelect(event.id)}>
            <Eye className="h-4 w-4 ml-2 shrink-0" />
            צפה בפרטי האירוע
        </Button>
      </CardFooter>
    </Card>
  );
}