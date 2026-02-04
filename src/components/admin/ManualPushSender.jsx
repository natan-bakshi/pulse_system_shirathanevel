import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { sendOneSignalPush } from "@/functions/sendOneSignalPush";
import { createNotification } from "@/functions/createNotification";
import { 
  Send, Loader2, User, Users, Bell, AlertCircle, CheckCircle, Info
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export default function ManualPushSender() {
  const [selectedUserId, setSelectedUserId] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [sendResult, setSendResult] = useState(null);

  // Fetch all users
  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ['allUsersForPush'],
    queryFn: async () => {
      const allUsers = await base44.entities.User.list();
      return allUsers.sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
    },
    staleTime: 2 * 60 * 1000
  });

  // Group users by type
  const groupedUsers = users.reduce((acc, user) => {
    const type = user.user_type || 'other';
    if (!acc[type]) acc[type] = [];
    acc[type].push(user);
    return acc;
  }, {});

  // Send notification mutation
  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUserId || !title || !message) {
        throw new Error('נא למלא את כל השדות');
      }

      const targetUser = users.find(u => u.id === selectedUserId);
      if (!targetUser) {
        throw new Error('משתמש לא נמצא');
      }

      // Use createNotification to create both in-app and push
      const response = await createNotification({
        target_user_id: targetUser.id,
        target_user_email: targetUser.email,
        title: title,
        message: message,
        link: '',
        template_type: 'MANUAL_PUSH',
        send_push: true,
        check_quiet_hours: false // Skip quiet hours for manual sends
      });

      return {
        ...response.data,
        targetUser
      };
    },
    onSuccess: (result) => {
      setSendResult(result);
      if (result.success) {
        if (result.push?.sent) {
          toast.success("נשלח בהצלחה!", { 
            description: `התראה ו-Push נשלחו ל-${result.targetUser.full_name || result.targetUser.email}` 
          });
        } else {
          toast.warning("התראה פנימית נוצרה", { 
            description: `Push לא נשלח: ${result.push?.reason || result.push?.error || 'לא ידוע'}` 
          });
        }
      }
    },
    onError: (error) => {
      setSendResult({ success: false, error: error.message });
      toast.error("שגיאה", { description: error.message });
    }
  });

  const selectedUser = users.find(u => u.id === selectedUserId);

  const getUserTypeLabel = (type) => {
    switch (type) {
      case 'admin': return 'מנהלים';
      case 'supplier': return 'ספקים';
      case 'client': return 'לקוחות';
      default: return 'אחר';
    }
  };

  return (
    <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="h-5 w-5" />
          שליחת התראה ידנית
        </CardTitle>
        <CardDescription>
          שלח התראת Push וNotification פנימית למשתמש ספציפי לבדיקת המערכת
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* User Selection */}
        <div>
          <Label>בחר נמען</Label>
          <Select value={selectedUserId} onValueChange={setSelectedUserId}>
            <SelectTrigger className="mt-1">
              <SelectValue placeholder="בחר משתמש..." />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(groupedUsers).map(([type, typeUsers]) => (
                <React.Fragment key={type}>
                  <div className="px-2 py-1.5 text-xs font-semibold text-gray-500 bg-gray-100">
                    {getUserTypeLabel(type)} ({typeUsers.length})
                  </div>
                  {typeUsers.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      <div className="flex items-center gap-2">
                        <span>{user.full_name || user.email}</span>
                        {user.push_enabled && user.onesignal_subscription_id && (
                          <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">
                            Push
                          </Badge>
                        )}
                        {!user.push_enabled && (
                          <Badge variant="outline" className="text-xs bg-gray-50 text-gray-500">
                            ללא Push
                          </Badge>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </React.Fragment>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Selected user info */}
        {selectedUser && (
          <Alert className={selectedUser.push_enabled && selectedUser.onesignal_subscription_id 
            ? "bg-green-50 border-green-200" 
            : "bg-yellow-50 border-yellow-200"
          }>
            <Info className={`h-4 w-4 ${selectedUser.push_enabled && selectedUser.onesignal_subscription_id ? 'text-green-600' : 'text-yellow-600'}`} />
            <AlertDescription className="text-sm">
              <div className="font-medium">{selectedUser.full_name || 'ללא שם'}</div>
              <div className="text-xs text-gray-600">{selectedUser.email}</div>
              <div className="mt-1 text-xs">
                {selectedUser.push_enabled && selectedUser.onesignal_subscription_id ? (
                  <span className="text-green-700">✓ Push מופעל - subscription ID: {selectedUser.onesignal_subscription_id.substring(0, 15)}...</span>
                ) : selectedUser.push_enabled ? (
                  <span className="text-yellow-700">⚠ push_enabled=true אבל אין subscription ID</span>
                ) : (
                  <span className="text-gray-600">Push לא מופעל - יישלח רק Notification פנימי</span>
                )}
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Title */}
        <div>
          <Label>כותרת ההתראה</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="לדוגמה: בדיקת מערכת"
            className="mt-1"
          />
        </div>

        {/* Message */}
        <div>
          <Label>תוכן ההודעה</Label>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="לדוגמה: זוהי הודעת בדיקה לוודא שמערכת ההתראות עובדת"
            rows={3}
            className="mt-1"
          />
        </div>

        {/* Send Button */}
        <Button 
          onClick={() => sendMutation.mutate()}
          disabled={sendMutation.isPending || !selectedUserId || !title || !message}
          className="w-full"
        >
          {sendMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin ml-2" />
          ) : (
            <Send className="h-4 w-4 ml-2" />
          )}
          שלח התראה
        </Button>

        {/* Result Display */}
        {sendResult && (
          <Alert className={sendResult.success ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}>
            {sendResult.success ? (
              <CheckCircle className="h-4 w-4 text-green-600" />
            ) : (
              <AlertCircle className="h-4 w-4 text-red-600" />
            )}
            <AlertDescription className="text-sm">
              {sendResult.success ? (
                <div>
                  <div className="font-medium text-green-800">התראה נוצרה בהצלחה</div>
                  <div className="text-xs text-green-700 mt-1">
                    <div>Notification ID: {sendResult.notification_id}</div>
                    {sendResult.push?.sent ? (
                      <div className="text-green-700">
                        ✓ Push נשלח - נמענים: {sendResult.push.recipients}
                      </div>
                    ) : (
                      <div className="text-yellow-700">
                        Push לא נשלח: {sendResult.push?.reason || sendResult.push?.error || 'לא ידוע'}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-red-800">
                  שגיאה: {sendResult.error}
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Help text */}
        <p className="text-xs text-gray-500 text-center">
          שליחה ידנית עוקפת את שעות השקט ומאפשרת בדיקת מערכת ההתראות בכל עת
        </p>
      </CardContent>
    </Card>
  );
}