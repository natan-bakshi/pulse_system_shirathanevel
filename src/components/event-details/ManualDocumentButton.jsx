import React from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChevronDown, Loader2, Receipt } from "lucide-react";

// בחירת סוג המסמך שיופק עבור תשלום שנרשם ידנית: חשבונית מס/קבלה או קבלה בלבד.
export default function ManualDocumentButton({ paymentId, onCreate, loading }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="ml-2" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 ml-2 animate-spin" /> : <Receipt className="h-4 w-4 ml-2" />}
          הפק מסמך
          <ChevronDown className="h-4 w-4 mr-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onCreate(paymentId, "invoice_receipt")}>חשבונית מס/קבלה</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onCreate(paymentId, "receipt")}>קבלה</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}