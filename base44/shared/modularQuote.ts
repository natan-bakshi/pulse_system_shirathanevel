import sanitizeHtml from 'npm:sanitize-html@2.17.0';

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
  const renderItem = (i, child = false) => `<section class="item ${child ? 'child' : ''}"><h3>${esc(i.name)}</h3>${c.show_descriptions !== false && i.show_description !== false ? rich(i.description) : ''}${c.show_quantity !== false && i.show_quantity !== false ? `<p class="muted">כמות: ${esc(num(i.quantity))}</p>` : ''}${c.show_prices !== false && i.show_price !== false && !child ? `<p class="price">${fmt(num(i.price) * num(i.quantity))} <small>${i.includes_vat ? '(כולל מע״מ)' : '(לא כולל מע״מ)'}</small></p>` : ''}${i.kind === 'package' ? (i.children || []).filter(s => s.visible !== false).map(s => renderItem(s,true)).join('') : ''}</section>`;
  const beforeVat = visibleItems.reduce((total,i) => total + num(i.price)*num(i.quantity)/(i.includes_vat ? 1+vat : 1),0);
  const body = `${title ? `<h1>${esc(title)}</h1>` : ''}${c.show_quantity !== false && c.guest_count ? `<p class="details">כמות משתתפים: ${esc(num(c.guest_count))}</p>` : ''}${c.show_intro !== false ? `<div class="intro">${rich(c.intro)}</div>` : ''}${c.show_services !== false && visibleItems.length ? `<section><h2>${esc(c.services_title ?? 'חבילות ושירותים')}</h2>${visibleItems.map(i=>renderItem(i)).join('')}</section>` : ''}${c.show_prices !== false && c.show_summary !== false && c.show_services !== false ? `<section class="summary"><h2>סיכום כספי</h2><p>סה״כ לפני מע״מ: <strong>${fmt(beforeVat)}</strong></p><p>מע״מ (${vat*100}%): <strong>${fmt(beforeVat*vat)}</strong></p><p class="price">סה״כ כולל מע״מ: <strong>${fmt(beforeVat*(1+vat))}</strong></p></section>` : ''}${c.show_payment_terms !== false && c.payment_terms ? `<section><h2>תנאי תשלום</h2>${rich(c.payment_terms)}</section>` : ''}${c.show_agreement !== false && c.agreement ? `<section>${rich(c.agreement)}</section>` : ''}${c.notes ? `<section>${rich(c.notes)}</section>` : ''}`;
  const size = Math.min(30, Math.max(10,Number(settings.quote_body_font_size)||15));
  const color = /^#[0-9a-f]{3,8}$/i.test(settings.quote_text_color || '') ? settings.quote_text_color : '#333333';
  const margin = key => Math.min(60,Math.max(0,Number(settings[key] ?? 20)||0));
  const logo = settings.quote_hide_logo !== 'true' && /^https:\/\//.test(settings.company_logo_url || '') ? `<img class="logo" src="${esc(settings.company_logo_url)}" alt="${esc(settings.company_name || 'Pulse')}">` : '';
  const background = /^https:\/\//.test(settings.quote_background_image || '') ? `body::before{content:"";position:fixed;inset:0;background:url("${esc(settings.quote_background_image)}") center/cover no-repeat;z-index:-1;}` : '';
  const html = `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title || 'הצעה מודולרית')}</title><style>@import url('https://fonts.googleapis.com/css2?family=Assistant:wght@400;600;700&display=swap');*{box-sizing:border-box}body{margin:0;background:#fff;color:${color};font:${size}px/${Number(settings.quote_line_height)||1.6} Assistant,Arial,sans-serif;overflow-wrap:anywhere;-webkit-print-color-adjust:exact;print-color-adjust:exact}${background}.page-content{padding:0 ${margin('quote_margin_right_mm')}mm 0 ${margin('quote_margin_left_mm')}mm;max-width:100%;}h1{text-align:center;font-size:1.6em;color:#8b0000}h2{font-size:1.2em;color:#8b0000;border-bottom:2px solid #daa520;padding-bottom:8px;page-break-after:avoid}h3{margin:0 0 6px;color:#8b0000;font-size:1.05em}section{margin:24px 0}.item{border-bottom:1px solid #e5e7eb;padding:12px 0;page-break-inside:avoid}.child{margin:8px 0 0;padding:10px 18px 0 0}.child h3{color:#333}.details,.intro{text-align:center}.muted,small{color:#666}.price{font-weight:700;color:#8b0000}.summary{page-break-inside:avoid}.logo{display:block;max-width:160px;max-height:75px;object-fit:contain;margin:0 auto 24px}p{margin:8px 0}table{width:100%;border-collapse:collapse}td,th{padding:5px}footer{text-align:center;border-top:1px solid #eee;color:#666;margin-top:30px;font-size:.85em}@page{size:A4;margin:0}@media screen and (max-width:600px){.page-content{padding:20px}.spacer{height:12px!important}h1{font-size:1.4em}}</style></head><body><table><thead><tr><td><div class="spacer" style="height:${margin('quote_margin_top_mm')}mm"></div></td></tr></thead><tbody><tr><td><main class="page-content">${logo}${body}${settings.quote_show_footer==='true' ? `<footer>${esc(settings.quote_footer_text)}</footer>` : ''}</main></td></tr></tbody><tfoot><tr><td><div class="spacer" style="height:${margin('quote_margin_bottom_mm')}mm"></div></td></tr></tfoot></table></body></html>`;
  return {html, fileBaseName: title || 'הצעה מודולרית', event:null};
}