import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Users } from "lucide-react";
import { getCurrencySymbol } from "@/components/utils/currencyUtils";
import {useLanguage} from '@/i18n/LanguageProvider';

export default function GuestCountChangeDialog({
  isOpen,
  onClose,
  oldGuestCount,
  newGuestCount,
  currentPricePerGuest,
  currentTotal,
  currency,
  onKeepPricePerGuest,
  onKeepTotalPrice
}) {
  const {t: uiTranslate}=useLanguage();
  const cs = getCurrencySymbol(currency || 'ILS');
  const newTotalIfKeepPerGuest = currentPricePerGuest * newGuestCount;
  const newPerGuestIfKeepTotal = currentTotal / newGuestCount;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent dir="rtl" className="sm:max-w-[480px]" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-blue-600" />
            {uiTranslate("שינוי כמות משתתפים")}
          </DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <p className="text-sm text-gray-600">
            {uiTranslate("כמות המשתתפים השתנתה מ-")}<strong>{oldGuestCount}</strong> {uiTranslate("ל-")}<strong>{newGuestCount}</strong>.
            <br />
            {uiTranslate("המחיר הנוכחי למשתתף:")} <strong>{cs}{currentPricePerGuest?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
          </p>

          <p className="text-sm font-medium">{uiTranslate("כיצד לעדכן את המחירים?")}</p>

          <div className="space-y-3">
            <button
              type="button"
              onClick={onKeepPricePerGuest}
              className="w-full text-right p-4 rounded-lg border-2 border-blue-200 hover:border-blue-500 hover:bg-blue-50 transition-all"
            >
              <div className="font-semibold text-blue-800">{uiTranslate("שמור מחיר למשתתף")}</div>
              <div className="text-sm text-gray-600 mt-1">
                {uiTranslate("המחיר למשתתף יישאר")} {cs}{currentPricePerGuest?.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                <br />
                {uiTranslate("מחיר האירוע ישתנה ל-")}<strong>{cs}{newTotalIfKeepPerGuest.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>
              </div>
            </button>

            <button
              type="button"
              onClick={onKeepTotalPrice}
              className="w-full text-right p-4 rounded-lg border-2 border-green-200 hover:border-green-500 hover:bg-green-50 transition-all"
            >
              <div className="font-semibold text-green-800">{uiTranslate("שמור מחיר אירוע")}</div>
              <div className="text-sm text-gray-600 mt-1">
                {uiTranslate("מחיר האירוע יישאר")} {cs}{currentTotal?.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                <br />
                {uiTranslate("המחיר למשתתף ישתנה ל-")}<strong>{cs}{newPerGuestIfKeepTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>
              </div>
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}