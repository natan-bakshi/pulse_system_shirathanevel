// חישובי עמלת סליקה ומקדמה בצד הממשק - להצגה בלבד. האימות המחייב מתבצע בשרת.
export function calcProcessingFee(settings, amount) {
  if (settings?.processing_fee_enabled !== "true") return { amount: 0, label: "" };
  const value = parseFloat(settings.processing_fee_value) || 0;
  if (value <= 0) return { amount: 0, label: "" };
  const fee = settings.processing_fee_type === "fixed" ? value : (Number(amount) || 0) * value / 100;
  return { amount: Math.round(fee * 100) / 100, label: settings.processing_fee_label || "עמלת סליקה" };
}

export function calcAdvanceAmount(settings, balance) {
  const configured = parseFloat(settings?.default_advance_amount) || 0;
  const suggested = Math.max(configured, (Number(balance) || 0) * 0.2);
  return Math.round(Math.min(Number(balance) || 0, suggested) * 100) / 100;
}