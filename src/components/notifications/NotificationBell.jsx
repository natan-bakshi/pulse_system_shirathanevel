import React, { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Bell, Check, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Link } from "react-router-dom";
import { markNotificationsAsRead } from "@/functions/markNotificationsAsRead";

export default function NotificationBell({ user }) {
  const [isOpen, setIsOpen] = useState(false);
  const queryClient = useQueryClient();

  // Fetch unread notifications
  const { data: notifications = [], isLoading, refetch } = useQuery({
    queryKey: ['inAppNotifications', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      try {
        const allNotifications = await base44.entities.InAppNotification.filter(
          { user_id: user.id },
          '-created_date',
          50
        );
        return allNotifications;
      } catch (error) {
        console.error('Error fetching notifications:', error);
        return [];
      }
    },
    enabled: !!user?.id,
    refetchInterval: 60000, // Refresh every minute
    staleTime: 30000,
  });

  // Mark all as read mutation
  const markAsReadMutation = useMutation({
    mutationFn: async () => {
      return await markNotificationsAsRead({});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inAppNotifications', user?.id] });
    },
  });

  // Count unread notifications
  const unreadCount = notifications.filter(n => !n.is_read).length;

  // Handle dropdown open - mark all as read
  const handleOpenChange = useCallback((open) => {
    setIsOpen(open);
    if (open && unreadCount > 0) {
      // Mark all as read when opening the dropdown
      markAsReadMutation.mutate();
    }
  }, [unreadCount, markAsReadMutation]);

  // Format relative time
  const formatRelativeTime = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'עכשיו';
    if (diffMins < 60) return `לפני ${diffMins} דקות`;
    if (diffHours < 24) return `לפני ${diffHours} שעות`;
    if (diffDays < 7) return `לפני ${diffDays} ימים`;
    return date.toLocaleDateString('he-IL');
  };

  // Subscribe to real-time updates
  useEffect(() => {
    if (!user?.id) return;

    const unsubscribe = base44.entities.InAppNotification.subscribe((event) => {
      if (event.data?.user_id === user.id || event.data?.user_email === user.email) {
        refetch();
      }
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [user?.id, user?.email, refetch]);

  if (!user) return null;

  return (
    <DropdownMenu open={isOpen} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative text-white hover:bg-white/20"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs bg-red-600 hover:bg-red-600"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent 
        align="end" 
        className="w-80 max-h-[70vh]"
        dir="rtl"
      >
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="font-semibold text-sm">התראות</span>
          {unreadCount > 0 && (
            <Badge variant="secondary" className="text-xs">
              {unreadCount} חדשות
            </Badge>
          )}
        </div>

        <ScrollArea className="h-[350px]">
          {isLoading ? (
            <div className="p-4 text-center text-gray-500 text-sm">
              טוען התראות...
            </div>
          ) : notifications.length === 0 ? (
            <div className="p-6 text-center text-gray-500">
              <Bell className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">אין התראות</p>
            </div>
          ) : (
            notifications.map((notification) => (
              <DropdownMenuItem
                key={notification.id}
                className={`flex flex-col items-start gap-1 p-3 cursor-pointer ${
                  !notification.is_read ? 'bg-blue-50/50' : ''
                }`}
                asChild
              >
                {notification.link ? (
                  <Link to={notification.link} className="w-full">
                    <div className="flex items-start justify-between w-full gap-2">
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium truncate ${
                          !notification.is_read ? 'text-gray-900' : 'text-gray-700'
                        }`}>
                          {notification.title}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                          {notification.message}
                        </p>
                        <p className="text-xs text-gray-400 mt-1">
                          {formatRelativeTime(notification.created_date)}
                        </p>
                      </div>
                      {!notification.is_read && (
                        <div className="w-2 h-2 bg-blue-500 rounded-full mt-1.5 shrink-0" />
                      )}
                    </div>
                  </Link>
                ) : (
                  <div className="w-full">
                    <div className="flex items-start justify-between w-full gap-2">
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium truncate ${
                          !notification.is_read ? 'text-gray-900' : 'text-gray-700'
                        }`}>
                          {notification.title}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                          {notification.message}
                        </p>
                        <p className="text-xs text-gray-400 mt-1">
                          {formatRelativeTime(notification.created_date)}
                        </p>
                      </div>
                      {!notification.is_read && (
                        <div className="w-2 h-2 bg-blue-500 rounded-full mt-1.5 shrink-0" />
                      )}
                    </div>
                  </div>
                )}
              </DropdownMenuItem>
            ))
          )}
        </ScrollArea>

        {notifications.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <div className="p-2 text-center">
              <span className="text-xs text-gray-500">
                {unreadCount === 0 ? (
                  <span className="flex items-center justify-center gap-1">
                    <Check className="h-3 w-3" />
                    כל ההתראות נקראו
                  </span>
                ) : (
                  `לחיצה על הפעמון מסמנת הכל כנקרא`
                )}
              </span>
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}