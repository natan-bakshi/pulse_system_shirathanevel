import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { billingText } from "@/components/billing/billingI18n";

export default function ClearingAmountSelector({ chargeType, onChangeType, amount, onChangeAmount, balance, advanceAmount, allowAdvance, symbol, lang = "he" }) {
  const text = billingText(lang);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant={chargeType === "regular" ? "default" : "outline"} onClick={() => onChangeType("regular")}>{text.balanceDue}</Button>
        {allowAdvance && <Button type="button" size="sm" variant={chargeType === "advance" ? "default" : "outline"} onClick={() => onChangeType("advance")}>{text.advance}</Button>}
      </div>
      <div>
        <Label htmlFor="clearing-amount">{text.clearingAmount}</Label>
        <Input id="clearing-amount" type="number" min="1" max={balance} step="0.01" value={amount} onChange={(event) => onChangeAmount(event.target.value)} />
        <p className="mt-1 text-xs text-gray-500">
          {chargeType === "advance" ? `${text.advanceSuggested}: ${symbol}${advanceAmount.toLocaleString()} · ` : ""}
          {text.balanceDue}: {symbol}{Number(balance).toLocaleString()} ({text.balanceNote})
        </p>
      </div>
    </div>
  );
}