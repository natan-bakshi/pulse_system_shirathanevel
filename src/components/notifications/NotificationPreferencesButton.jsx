import React, { useState } from "react";
import { Bell, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import UserNotificationPreferences from "./UserNotificationPreferences";

/**
 * A button that opens a dialog with user notification preferences
 * Can be placed anywhere in the app (sidebar, settings, dashboards)
 */
export default function NotificationPreferencesButton({ user, variant = "outline", size = "default", showIcon = true, showText = true }) {
  const [isOpen, setIsOpen] = useState(false);

  if (!user) return null;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size} className="gap-2">
          {showIcon && <Bell className="h-4 w-4" />}
          {showText && "הגדרות התראות"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            הגדרות התראות אישיות
          </DialogTitle>
        </DialogHeader>
        <UserNotificationPreferences user={user} onClose={() => setIsOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}