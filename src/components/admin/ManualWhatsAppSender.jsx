import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { createNotification } from "@/functions/createNotification";
import { 
  Send, Loader2, MessageCircle, AlertCircle, CheckCircle, Info, Smartphone
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

export default function ManualWhatsAppSender() {
  const [selectedUserId, setSelectedUserId] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [sendResult, setSendResult] = useState(null);

  // Fetch all users
  // Fetch all users and suppliers for intelligent mapping
  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ['allUsersAndSuppliersForWhatsApp'],
    queryFn: async () => {
      // Fetch users, suppliers, AND events (for clients)
      const [allUsers, allSuppliers, allEvents] = await Promise.all([
        base44.entities.User.list(),
        base44.entities.Supplier.list(),
        base44.entities.Event.list() // Fetching all events to find parents
      ]);
      
      // Map external phones to users by email
      const enrichedUsers = allUsers.map(user => {
        let phone = user.phone;
        let source = 'user';
        const userEmail = user.email ? user.email.toLowerCase().trim() : null;
        
        if (!phone && userEmail) {
          // 1. Try Supplier
          const supplier = allSuppliers.find(s => 
            Array.isArray(s.contact_emails) && 
            s.contact_emails.some(email => email && email.toLowerCase().trim() === userEmail)
          );
          
          if (supplier && supplier.phone) {
            phone = supplier.phone;
            source = 'supplier';
          } else {
            // 2. Try Client (Event Parent)
            // Iterate events to find a parent with matching email
            for (const event of allEvents) {
              if (event.parents && Array.isArray(event.parents)) {
                const parent = event.parents.find(p => p.email && p.email.toLowerCase().trim() === userEmail);
                if (parent && parent.phone) {
                  phone = parent.phone;
                  source = 'client';
                  break; // Found matching client phone
                }
              }
            }
          }
        }
        return { ...user, phone, phoneSource: source };
      });

      return enrichedUsers.sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
    },
    staleTime: 2 * 60 * 1000
  });

  const users = usersData || [];

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

      // Note: we don't block here if phone is missing in frontend, 
      // because the backend now has smarter resolution logic (checking Supplier entity).
      // We assume the backend will try its best.

      // Use createNotification to create in-app and send WhatsApp
      const response = await createNotification({
        target_user_id: targetUser.id,
        target_user_email: targetUser.email,
        title: title,
        message: message,
        link: '',
        template_type: 'MANUAL_WHATSAPP',
        send_push: false,
        send_whatsapp: true,
        check_quiet_hours: false
      });

      return {
        ...response.data,
        targetUser
      };
    },
    onSuccess: (result) => {
      setSendResult(result);
      if (result.success) {
        if (result.whatsapp?.sent) {
          toast.success("נשלח בהצלחה!", { 
            description: `הודעת WhatsApp נשלחה ל-${result.targetUser.full_name || result.targetUser.phone}` 
          });
        } else {
          toast.warning("התראה פנימית נוצרה", { 
            description: `WhatsApp לא נשלח: ${result.whatsapp?.reason || result.whatsapp?.error || 'לא ידוע'}` 
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
    <Card className="bg-white/95 backdrop-blur-sm shadow-xl border-green-100">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-green-800">
          <MessageCircle className="h-5 w-5" />
          שליחת WhatsApp ידנית
        </CardTitle>
        <CardDescription>
          שלח הודעת WhatsApp ו-Notification פנימי למשתמש ספציפי לבדיקה
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
                      <div className="flex items-center gap-2 w-full justify-between">
                        <span>{user.full_name || user.email}</span>
                        <div className="flex items-center gap-1">
                          {user.phone ? (
                            <span className="text-xs text-gray-400 flex items-center">
                              {user.phone}
                              {user.phoneSource === 'supplier' && (
                                <Badge variant="outline" className="mr-1 text-[10px] h-4 bg-purple-50 text-purple-700 border-purple-200">
                                  ספק
                                </Badge>
                              )}
                              {user.phoneSource === 'client' && (
                                <Badge variant="outline" className="mr-1 text-[10px] h-4 bg-blue-50 text-blue-700 border-blue-200">
                                  לקוח
                                </Badge>
                              )}
                            </span>
                          ) : (
                            <Badge variant="outline" className="text-xs bg-red-50 text-red-500 border-red-200">
                              אין טלפון
                            </Badge>
                          )}
                        </div>
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
          <Alert className={selectedUser.phone && selectedUser.whatsapp_enabled !== false
            ? "bg-green-50 border-green-200" 
            : "bg-red-50 border-red-200"
          }>
            <Smartphone className={`h-4 w-4 ${selectedUser.phone ? 'text-green-600' : 'text-red-600'}`} />
            <AlertDescription className="text-sm">
              <div className="font-medium">{selectedUser.full_name || 'ללא שם'}</div>
              <div className="mt-1 text-xs">
                {selectedUser.phone ? (
                  <span className="text-green-700">✓ מספר טלפון: {selectedUser.phone}</span>
                ) : (
                  <span className="text-red-700">✗ חסר מספר טלפון - לא ניתן לשלוח WhatsApp</span>
                )}
                {selectedUser.whatsapp_enabled === false && (
                  <div className="text-red-700 mt-1">✗ המשתמש חסם התראות WhatsApp</div>
                )}
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Title */}
        <div>
          <Label>כותרת (מודגש)</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="כותרת ההודעה"
            className="mt-1"
          />
        </div>

        {/* Message */}
        <div>
          <Label>תוכן ההודעה</Label>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="תוכן ההודעה..."
            rows={4}
            className="mt-1"
          />
        </div>

        {/* Send Button */}
        <Button 
          onClick={() => sendMutation.mutate()}
          disabled={sendMutation.isPending || !selectedUserId || !title || !message}
          className="w-full bg-green-600 hover:bg-green-700 text-white"
        >
          {sendMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin ml-2" />
          ) : (
            <Send className="h-4 w-4 ml-2" />
          )}
          שלח WhatsApp
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
                    {sendResult.whatsapp?.sent ? (
                      <div className="text-green-700 font-bold">
                        ✓ WhatsApp נשלח בהצלחה!
                      </div>
                    ) : (
                      <div className="text-red-700">
                        WhatsApp לא נשלח: {sendResult.whatsapp?.reason || sendResult.whatsapp?.error || 'שגיאה לא ידועה'}
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
      </CardContent>
    </Card>
  );
}