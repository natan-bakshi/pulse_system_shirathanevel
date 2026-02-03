import React from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Bell, ArrowRight, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import UserNotificationPreferences from "@/components/notifications/UserNotificationPreferences";

/**
 * Personal notification settings page
 * Accessible by all users (suppliers, clients, admins)
 */
export default function MyNotificationSettings() {
  const { data: user, isLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-white" />
      </div>
    );
  }

  const dashboardUrl = user?.user_type === 'admin' 
    ? createPageUrl("AdminDashboard")
    : user?.user_type === 'supplier'
    ? createPageUrl("SupplierDashboard")
    : createPageUrl("ClientDashboard");

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Bell className="h-6 w-6" />
          הגדרות התראות
        </h1>
        <Link 
          to={dashboardUrl}
          className="flex items-center gap-1 text-white/80 hover:text-white transition-colors text-sm"
        >
          <ArrowRight className="h-4 w-4" />
          חזרה לדשבורד
        </Link>
      </div>

      <div className="bg-white/95 backdrop-blur-sm rounded-xl shadow-xl overflow-hidden">
        <UserNotificationPreferences user={user} />
      </div>
    </div>
  );
}