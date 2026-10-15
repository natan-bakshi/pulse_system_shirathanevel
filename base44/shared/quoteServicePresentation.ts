// Shared presentation only: never changes billable amounts or totals.
const escapeText = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function quotePriceLabel(service) {
  const mode = service.price_display_mode || 'default';
  if (mode === 'direct_payment') return 'תשלום ישיר';
  if (mode === 'estimated_price') return 'מחיר מוערך';
  return mode === 'custom_text' ? String(service.price_display_text || '') : '';
}
export function quotePriceVisible(service, enabled = true) {
  return enabled && service.show_price_in_quote !== false && service.show_price !== false;
}
export function quoteServicePriceHtml(service, total, fontSize = '15', enabled = true) {
  const label = quotePriceLabel(service);
  const visible = quotePriceVisible(service, enabled);
  const amount = `₪${(Number(total) || 0).toLocaleString('he-IL', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
  return `${label ? `<div style="font-size:calc(${fontSize}px * 0.9);color:#b45309;font-weight:600;white-space:pre-wrap;">${escapeText(label)}</div>` : ''}${visible ? `<strong style="color:#8B0000;font-size:${fontSize}px;">${amount}</strong><div style="font-size:calc(${fontSize}px * 0.8);color:#6b7280;">${service.includes_vat ? '(כולל מע״מ)' : '(לא כולל מע״מ)'}</div>` : ''}`;
}
export function quoteServiceNotesHtml(service, fontSize = '15') {
  return service.client_notes ? `<div style="color:#6b7280;font-size:calc(${fontSize}px * 0.9);margin-top:5px;font-style:italic;white-space:pre-wrap;">${escapeText(service.client_notes)}</div>` : '';
}