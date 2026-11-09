import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2 } from "lucide-react";
import { billingText } from "@/components/billing/billingI18n";
import { editDocumentUnitPrice, editDocumentVatRate, itemUnitGross, totalDocumentGross, totalDocumentNet } from "./documentAmountMath";
import {useLanguage} from '@/i18n/LanguageProvider';

// עורך שורות הפריטים של מסמך ידני, כולל סיכום לפני מע״מ / מע״מ / סה״כ.
export default function DocumentItemsEditor({ items, onChange, vatPercent = 18, symbol = "₪", lang = "he" }) {
  const {t: uiTranslate}=useLanguage();
  const text = billingText(lang);
  const update = (index, key, value) => onChange(items.map((item, position) => (position === index ? { ...item, [key]: value } : item)));
  const updateUnit = (index, mode, value) => onChange(items.map((item, position) => position === index ? editDocumentUnitPrice(item, mode, value, vatPercent) : item));
  const updateVat = (index, value) => onChange(items.map((item, position) => position === index ? editDocumentVatRate(item, value, vatPercent) : item));
  const add = () => onChange([...items, { name: "", quantity: 1, price: "", grossPrice: "", taxRate: vatPercent, priceSource: "gross" }]);
  const remove = (index) => onChange(items.filter((_, position) => position !== index));

  const beforeVat = totalDocumentNet(items, vatPercent);
  const gross = totalDocumentGross(items, vatPercent);
  const vat = Math.round((gross - beforeVat) * 100) / 100;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>{text.documentLines}</Label>
        <Button type="button" variant="outline" size="sm" onClick={add}><Plus className="h-4 w-4" />{text.addLine}</Button>
      </div>

      <div className="space-y-2">
        {items.length === 0 && <p className="rounded border border-dashed border-gray-300 p-3 text-center text-sm text-gray-500">{text.noLines}</p>}
        {items.map((item, index) => (
          <div key={index} className="grid grid-cols-2 gap-2 rounded-lg border border-gray-200 p-2 sm:grid-cols-12">
            <div className="col-span-2 sm:col-span-4">
              <Label className="text-xs text-gray-500">{text.itemDescription}</Label>
              <Input value={item.name} onChange={(event) => update(index, "name", event.target.value)} placeholder={text.itemNamePlaceholder} />
            </div>
            <div className="sm:col-span-1">
              <Label className="text-xs text-gray-500">{text.quantity}</Label>
              <Input type="number" inputMode="decimal" dir="ltr" value={item.quantity} onChange={(event) => update(index, "quantity", event.target.value)} />
            </div>
            <div className="sm:col-span-3">
              <Label className="text-xs text-gray-500">{lang === "en" ? "Unit price before VAT" : uiTranslate("מחיר יחידה לפני מע״מ")}</Label>
              <Input type="number" min="0" step="0.01" inputMode="decimal" dir="ltr" value={item.price} onChange={(event) => updateUnit(index, "net", event.target.value)} />
            </div>
            <div className="sm:col-span-3">
              <Label className="text-xs text-gray-500">{lang === "en" ? "Unit price including VAT" : uiTranslate("מחיר יחידה כולל מע״מ")}</Label>
              <Input type="number" min="0" step="0.01" inputMode="decimal" dir="ltr" value={item.grossPrice ?? itemUnitGross(item, vatPercent)} onChange={(event) => updateUnit(index, "gross", event.target.value)} />
            </div>
            <div className="sm:col-span-1">
              <Label className="text-xs text-gray-500">{text.vatPercent}</Label>
              <Input type="number" inputMode="decimal" dir="ltr" value={item.taxRate} onChange={(event) => updateVat(index, event.target.value)} />
            </div>
            <div className="flex items-end sm:col-span-1">
              <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)} aria-label={text.deleteLine}><Trash2 className="h-4 w-4 text-red-600" /></Button>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg bg-gray-50 p-3 text-sm">
        <div className="flex justify-between"><span className="text-gray-600">{text.totalBeforeVat}</span><span>{symbol}{beforeVat.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
        <div className="flex justify-between"><span className="text-gray-600">{text.vat}</span><span>{symbol}{vat.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
        <div className="mt-1 flex justify-between border-t border-gray-200 pt-1 font-semibold"><span>{text.totalDue}</span><span>{symbol}{gross.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
      </div>
    </div>
  );
}