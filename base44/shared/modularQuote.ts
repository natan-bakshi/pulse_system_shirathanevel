import sanitizeHtml from 'npm:sanitize-html@2.17.0';
import { quoteDocumentStyle } from './quoteDocumentStyle.ts';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rich = (value) => sanitizeHtml(String(value || ''), {allowedTags: ['p','br','strong','b','em','i','u','s','h1','h2','h3','h4','ul','ol','li','blockquote','a','span','div','table','tbody','thead','tr','td','th','hr'], allowedAttributes: {'a':['href','target','rel'], '*':['style']}, allowedStyles: {'*': {'text-align':[/^(left|right|center|justify)$/], 'color':[/^#[0-9a-f]{3,8}$/i], 'font-size':[/^\d+(px|pt)$/], 'line-height':[/^[\d.]+$/]}}});
const num = value => Math.max(0, Number(value) || 0);
const fmt = value => '₪' + num(value).toLocaleString('he-IL', {minimumFractionDigits:2, maximumFractionDigits:2});

export function modularTitle(c = {}) {
  const type = c.show_event_type !== false ? String(c.event_type || '').trim() : '';
  const concept = c.show_concept !== false ? String(c.concept || '').trim() : '';
  if (!c.custom_title) return `הצעת מחיר מודולרית${type ? ` ל${type}` : ''}${concept ? ` בקונספט ${concept}` : ''}`;
  let title = String(c.custom_title);
  if (!concept) title = title.replace(/בקונספט\s*\{סוג הקונספט\}/g, '');
  if (!type) title = title.replace(/ל\{סוג האירוע\}/g, '');
  return title.replaceAll('{סוג האירוע}', type).replaceAll('{סוג הקונספט}', concept).replaceAll('{כמות}', c.show_quantity !== false && c.guest_count ? String(c.guest_count) : '').replace(/\s+/g,' ').trim();
}

export async function composeModularQuoteHtml(quote, client) {
  const rows = await client.asServiceRole.entities.AppSettings.list();
  const settings = Object.fromEntries(rows.map(s => [s.setting_key,s.setting_value]));
  const c = quote.content || {};
  const title = c.show_title === false ? '' : modularTitle(c);
  const vat = Number(settings.vat_rate || 18) / 100;
  const visibleItems = (Array.isArray(c.items) ? c.items : []).filter(i => i.visible !== false);
  const bodySize = settings.quote_body_font_size || '15';
  const description = (i, child=false) => c.show_descriptions !== false && i.show_description !== false ? `<div style="color:${child?'#666':'#6b7280'};font-size:${child?`calc(${bodySize}px * 0.95)`:`${bodySize}px`};margin-top:${child?'2':'5'}px;">${rich(i.description)}</div>` : '';
  const quantity = i => c.show_quantity !== false && i.show_quantity !== false ? `<div style="color:#666;font-size:${bodySize}px;margin-top:3px;">כמות: ${esc(num(i.quantity))}</div>` : '';
  const vatNote = i => i.includes_vat ? '(כולל מע״מ)' : '(לא כולל מע״מ)';
  const showPrice = i => c.show_prices !== false && i.show_price !== false;
  const renderItem = (i, child=false) => {
    if(child)return `<div class="package-service-item"><div class="package-service-bullet">•</div><div style="flex:1;"><strong style="color:#333;font-size:${bodySize}px;">${esc(i.name)}</strong>${description(i,true)}${quantity(i)}</div></div>`;
    if(i.kind==='package')return `<div class="package-group"><div class="package-header"><h3 class="package-title">${esc(i.name)}</h3>${c.show_descriptions !== false && i.show_description !== false ? `<div class="package-description">${rich(i.description)}</div>` : ''}${quantity(i)}</div><div class="package-content">${(i.children||[]).filter(s=>s.visible!==false).map(s=>renderItem(s,true)).join('')}</div>${showPrice(i)?`<div class="package-footer"><div class="package-price-label">סה״כ לחבילה:</div><div class="package-price-container"><span class="package-price-value">${fmt(num(i.price)*num(i.quantity))}</span><span class="package-vat-note">${vatNote(i)}</span></div></div>`:''}</div>`;
    return `<div style="padding:15px 0;border-bottom:1px solid #e5e7eb;page-break-inside:avoid;"><div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;"><div style="flex:1;min-width:200px;"><strong style="color:#1f2937;font-size:${bodySize}px;">${esc(i.name)}</strong>${description(i)}${quantity(i)}</div>${showPrice(i)?`<div style="text-align:left;margin-top:10px;"><strong style="color:#8B0000;font-size:${bodySize}px;">${fmt(num(i.price)*num(i.quantity))}</strong><div style="font-size:calc(${bodySize}px * 0.8);color:#6b7280;">${vatNote(i)}</div></div>`:''}</div></div>`;
  };
  const beforeVat = visibleItems.reduce((total,i) => total + num(i.price)*num(i.quantity)/(i.includes_vat ? 1+vat : 1),0);
  const heading = title || (c.show_quantity !== false && c.guest_count) ? `<div class="event-details-box">${title?`<strong style="font-size:calc(${settings.quote_event_details_font_size||bodySize}px + 1px);">${esc(title)}</strong>`:''}${c.show_quantity !== false && c.guest_count?`<div><strong>כמות משתתפים:</strong> ${esc(num(c.guest_count))}</div>`:''}</div>` : '';
  const body = `${heading}${c.show_intro !== false && c.intro ? `<div class="section"><div class="intro-content">${rich(c.intro)}</div></div>` : ''}${c.show_services !== false && visibleItems.length ? `<div class="section services-section">${c.services_title !== ''?`<h2 class="section-title">${esc(c.services_title??'חבילות ושירותים')}</h2>`:''}${visibleItems.map(i=>renderItem(i)).join('')}</div>`:''}${c.show_prices !== false && c.show_summary !== false && c.show_services !== false ? `<div class="section summary-section" style="margin-top:50px;page-break-inside:avoid;"><h2 class="section-title">סיכום כספי</h2><table class="summary-table"><tr><td class="label">סה״כ לפני מע״מ:</td><td class="value">${fmt(beforeVat)}</td></tr><tr><td class="label">מע״מ (${vat*100}%):</td><td class="value">${fmt(beforeVat*vat)}</td></tr><tr class="total"><td class="label">סה״כ כולל מע״מ:</td><td class="value">${fmt(beforeVat*(1+vat))}</td></tr></table></div>`:''}${c.show_payment_terms !== false && c.payment_terms?`<div class="section payment-section" style="margin-top:50px;page-break-inside:avoid;"><h2 class="section-title">תנאי תשלום</h2><div class="payment-terms">${rich(c.payment_terms)}</div></div>`:''}${c.show_agreement !== false && c.agreement?`<div class="payment-terms">${rich(c.agreement)}</div>`:''}${c.notes?`<div class="section"><div class="event-notes">${rich(c.notes)}</div></div>`:''}`;
  const html = `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title||'הצעה מודולרית')}</title>${quoteDocumentStyle(settings)}</head><body><table style="width:100%;border-collapse:collapse;border:none;"><thead><tr><td><div style="height:${settings.quote_margin_top_mm||'20'}mm;">&nbsp;</div></td></tr></thead><tbody><tr><td><div class="page-content">${body}${settings.quote_show_footer==='true'?`<div class="footer"><div>${esc(settings.quote_footer_text)}</div></div>`:''}</div></td></tr></tbody><tfoot><tr><td><div style="height:${settings.quote_margin_bottom_mm||'35'}mm;">&nbsp;</div></td></tr></tfoot></table></body></html>`;
  return {html, fileBaseName: title || 'הצעה מודולרית', event:null};
}