import React from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChevronDown, CreditCard, FilePlus, Link2 } from "lucide-react";
import { STANDALONE_DOCUMENT_TYPES } from "@/components/billing/documentTypes";

// כפתורי הפעולה של לשונית התשלומים: סליקה (מיידית / בקישור) והפקת מסמך.
export default function BillingActionButtons({ onImmediateClearing, onPaymentLink, onCreateDocument }) {
  return (
    <div className="flex flex-wrap gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className="bg-red-800 text-white hover:bg-red-900">
            <CreditCard className="ml-2 h-4 w-4" />סליקה<ChevronDown className="mr-1 h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[240px]">
          <DropdownMenuItem onSelect={onImmediateClearing}><CreditCard className="ml-2 h-4 w-4" />סליקת לקוח כאן ועכשיו</DropdownMenuItem>
          <DropdownMenuItem onSelect={onPaymentLink}><Link2 className="ml-2 h-4 w-4" />שליחת דרישת תשלום בקישור</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className="bg-red-800 text-white hover:bg-red-900">
            <FilePlus className="ml-2 h-4 w-4" />הפקת מסמך<ChevronDown className="mr-1 h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[220px]">
          {STANDALONE_DOCUMENT_TYPES.map((type) => (
            <DropdownMenuItem key={type.value} onSelect={() => onCreateDocument(type.value)}>{type.label}</DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}