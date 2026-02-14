import React, { useState, useEffect, useCallback, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Edit, Mail, Phone, UserCheck, Settings } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SyncPhonesButton from "@/components/admin/SyncPhonesButton";

export default function UserManagement() {
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [userFormData, setUserFormData] = useState({
    user_type: "client",
    phone: "",
    language: "he"
  });

  const queryClient = useQueryClient();

  // Debouncing effect for search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchTerm(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // React Query for users
  const { data: users = [], isLoading: loading } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    staleTime: 2 * 60 * 1000,
    cacheTime: 5 * 60 * 1000,
    select: (data) => Array.isArray(data) ? data : []
  });

  const handleEditUser = useCallback((user) => {
    setEditingUser(user);
    const allowedUserTypes = ["admin", "client", "supplier"];
    const initialUserType = allowedUserTypes.includes(user.user_type) ? user.user_type : "client";

    setUserFormData({
      user_type: initialUserType || "client",
      phone: user.phone || "",
      language: user.language || "he"
    });
    setShowEditDialog(true);
  }, []);

  const handleSaveUser = useCallback(async () => {
    if (!editingUser) return;

    try {
      await base44.entities.User.update(editingUser.id, userFormData);
      setShowEditDialog(false);
      setEditingUser(null);
      
      // Invalidate cache to refresh users
      queryClient.invalidateQueries({ queryKey: ['users'] });
    } catch (error) {
      console.error("Failed to update user:", error);
    }
  }, [editingUser, userFormData, queryClient]);

  const getUserTypeText = useCallback((userType) => {
    const types = {
      admin: "מנהל",
      client: "לקוח", 
      supplier: "ספק",
    };
    return types[userType] || "לא מוגדר";
  }, []);

  const getUserTypeColor = useCallback((userType) => {
    const colors = {
      admin: "bg-red-100 text-red-800",
      client: "bg-blue-100 text-blue-800",
      supplier: "bg-green-100 text-green-800",
    };
    return colors[userType] || "bg-gray-100 text-gray-800";
  }, []);

  const filteredUsers = useMemo(() => {
    return users.filter(user => {
      const searchLower = debouncedSearchTerm.toLowerCase();
      return (
        user.full_name?.toLowerCase().includes(searchLower) ||
        user.email?.toLowerCase().includes(searchLower) ||
        user.phone?.toLowerCase().includes(searchLower)
      );
    });
  }, [users, debouncedSearchTerm]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-48 bg-gray-200 rounded-lg"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">ניהול משתמשים</h1>
          <p className="text-white/80 mt-1">נהל את סוגי המשתמשים והרשאותיהם במערכת</p>
        </div>
        <SyncPhonesButton />
      </div>

      {/* Filters */}
      <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
        <CardContent className="p-6">
          <div className="relative">
            <Search className="absolute right-3 top-3 h-4 w-4 text-gray-400" />
            <Input
              placeholder="חיפוש משתמש לפי שם, אימייל או טלפון..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pr-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* Users Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredUsers.map((user) => (
          <Card key={user.id} className="bg-white/95 backdrop-blur-sm shadow-xl hover:shadow-2xl transition-shadow duration-300">
            <CardHeader>
              <div className="flex justify-between items-start">
                <CardTitle className="text-lg font-bold text-gray-900">
                  {user.full_name || "משתמש"}
                </CardTitle>
                <Badge className={getUserTypeColor(user.user_type)}>
                  {getUserTypeText(user.user_type)}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Mail className="h-4 w-4" />
                <span>{user.email}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Phone className="h-4 w-4" />
                <span>{user.phone || "לא צוין"}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Settings className="h-4 w-4" />
                <span>שפה: {user.language === 'he' ? 'עברית' : 'אנגלית'}</span>
              </div>
              <div className="flex gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => handleEditUser(user)} className="flex-1">
                  <Edit className="h-4 w-4 ml-1" /> ערוך הרשאות
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Edit User Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>ערוך הרשאות משתמש</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="user_type" className="text-right">
                סוג משתמש
              </Label>
              <Select value={userFormData.user_type} onValueChange={(value) => setUserFormData({...userFormData, user_type: value})}>
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder="בחר סוג משתמש" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">מנהל</SelectItem>
                  <SelectItem value="client">לקוח</SelectItem>
                  <SelectItem value="supplier">ספק</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="phone" className="text-right">
                טלפון
              </Label>
              <Input
                id="phone"
                value={userFormData.phone}
                onChange={(e) => setUserFormData({...userFormData, phone: e.target.value})}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="language" className="text-right">
                שפה
              </Label>
              <Select value={userFormData.language} onValueChange={(value) => setUserFormData({...userFormData, language: value})}>
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder="בחר שפה" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="he">עברית</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleSaveUser}>שמור שינויים</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}