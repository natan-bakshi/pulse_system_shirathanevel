import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { deleteMyAccount } from '@/functions/deleteMyAccount';

export default function DeleteAccountButton() {
  const [showDialog, setShowDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteMyAccount({});
      await base44.auth.logout();
    } catch (error) {
      console.error("Failed to delete account:", error);
      alert("שגיאה במחיקת החשבון. נסה שוב.");
      setIsDeleting(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        className="text-red-500 hover:text-red-700 hover:bg-red-50 text-sm"
        onClick={() => setShowDialog(true)}
      >
        <Trash2 className="h-4 w-4 ml-2" />
        מחק חשבון
      </Button>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <AlertTriangle className="h-5 w-5" />
              מחיקת חשבון
            </DialogTitle>
            <DialogDescription className="text-right pt-2">
              פעולה זו תמחק את החשבון שלך לצמיתות. לא ניתן לבטל פעולה זו.
              <br />
              נתוני האירועים והשיבוצים שלך לא ימחקו.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowDialog(false)} disabled={isDeleting}>
              ביטול
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? <Loader2 className="h-4 w-4 ml-2 animate-spin" /> : <Trash2 className="h-4 w-4 ml-2" />}
              מחק את החשבון שלי
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}