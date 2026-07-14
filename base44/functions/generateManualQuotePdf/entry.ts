import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// =====================================================================
// Helpers
// =====================================================================

function formatDate(dateStringOrDate) {
  if (!dateStringOrDate) return '';
  const date = dateStringOrDate instanceof Date ? dateStringOrDate : new Date(dateStringOrDate);
  if (isNaN(date.getTime())) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

function getEventType(typeKey) {
  const types = {
    bar_mitzvah: 'בר מצווה',
    bat_mitzvah: 'בת מצווה',
    wedding: 'חתונה',
    other: 'אירוע'
  };
  return types[typeKey] || 'אירוע';
}

function safeFloat(val) {
  if (val === null || val === undefined || val === '') return 0;
  const num = parseFloat(val);
  return isNaN(num) ? 0 : num;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// =====================================================================
// Block Renderers (mirror automatic quote styling)
// =====================================================================

function renderHeadingBlock(block) {
  const level = Math.min(Math.max(parseInt(block.options?.level, 10) || 2, 1), 6);
  const align = block.options?.align || 'center';
  const text = escapeHtml(block.content || '');
  return `<div class="section" style="margin-bottom: 20px;"><h${level} style="text-align: ${align}; color: #8B0000; font-weight: 700; margin: 0;">${text}</h${level}></div>`;
}

function renderFreeTextBlock(block, settings) {
  // The HTML is already produced by Tiptap and considered safe (created by admin).
  return `<div class="manual-block-text" style="margin-bottom: 20px; line-height: ${settings.quoteGeneralLineHeight}; font-size: ${settings.quoteBodyFontSize}px; color: ${settings.quoteTextColor};">${block.content || ''}</div>`;
}

function renderEventDetailsBlock(block, event, settings) {
  if (!event) return '';
  const opts = block.options || {};
  const familyLine = `${getEventType(event.event_type)} של ${event.child_name || ''} ${event.family_name || ''}`.trim();
  const parts = [];
  const showFamilyName = opts.showFamilyName !== false;
  const showChildName = opts.showChildName !== false;
  if (showFamilyName || showChildName) {
    parts.push(`<span style="font-weight: 700; font-size: calc(${settings.quoteEventDetailsFontSize}px + 1px);">${escapeHtml(familyLine)}</span>`);
  }
  const line2Parts = [];
  if (opts.showLocation !== false && event.location) line2Parts.push(`<strong>אירוע ב${escapeHtml(event.location)}</strong>`);
  if (opts.showDate !== false && event.event_date) line2Parts.push(formatDate(event.event_date));
  if (line2Parts.length) parts.push(line2Parts.join(' | '));

  if (opts.showParents !== false && Array.isArray(event.parents) && event.parents.some(p => p.name)) {
    parts.push(`<strong>שמות ההורים:</strong> ${event.parents.map(p => escapeHtml(p.name)).filter(Boolean).join(', ')}`);
  }
  const line4Parts = [];
  if (opts.showCity !== false && event.city) line4Parts.push(`<strong>עיר מגורים:</strong> ${escapeHtml(event.city)}`);
  if (opts.showGuestCount !== false && event.guest_count) line4Parts.push(`<strong>כמות מוזמנים:</strong> ${event.guest_count}`);
  if (line4Parts.length) parts.push(line4Parts.join(' | '));

  return `
    <div class="event-details-box" style="background-color: transparent; padding: 15px; margin-bottom: 30px; font-size: ${settings.quoteEventDetailsFontSize}px; line-height: ${settings.quoteEventDetailsLineHeight}; text-align: center; page-break-inside: avoid;">
      <div class="text-center">${parts.join('<br>')}</div>
    </div>`;
}

function renderIntroBlock(block, event, templates, settings) {
  const opts = block.options || {};

  // 1) Custom content for this quote only — overrides templates
  if (opts.useCustomContent && opts.customContent) {
    const fs = settings.quoteBodyFontSize;
    const lh = settings.quoteGeneralLineHeight;
    return `
      <div class="section">
        <div class="intro-content" style="text-align: center; margin-bottom: 30px; font-size: ${fs}px; line-height: ${lh}; color: ${settings.quoteTextColor}; padding: 10px 0;">${opts.customContent}</div>
      </div>`;
  }

  let template = null;
  if (opts.useEventConcept !== false && event?.concept) {
    template = templates.find(t => t.template_type === 'concept_intro' && t.identifier === event.concept);
  }
  if (!template && opts.templateId) {
    template = templates.find(t => t.id === opts.templateId);
  }
  if (!template) return '';
  const fs = template.font_size || settings.quoteBodyFontSize;
  const lh = template.line_height || settings.quoteGeneralLineHeight;
  return `
    <div class="section">
      <div class="intro-content" style="text-align: center; margin-bottom: 30px; font-size: ${fs}px; line-height: ${lh}; color: ${settings.quoteTextColor}; padding: 10px 0;">${template.content || ''}</div>
    </div>`;
}

function renderTransportDetails(service, settings) {
  if (service.category !== 'נסיעות') return '';
  let units = [];
  try {
    const parsed = JSON.parse(service.pickup_point || '[]');
    units = Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    if (service.pickup_point || service.standing_time) {
      units = [{
        pickupPoints: [{
          time: service.standing_time,
          location: service.pickup_point,
          contact: service.on_site_contact_details
        }]
      }];
    }
  }

  if (units.length === 0 && !service.on_site_contact_details?.name) return '';

  if (units.length === 0 && service.on_site_contact_details?.name) {
    return `<div style="color: #1e40af; font-size: calc(${settings.quoteBodyFontSize}px * 0.85); margin-top: 5px; background-color: rgba(239, 246, 255, 0.5); padding: 4px 6px; border-radius: 4px;">
        <div><strong>איש קשר במקום:</strong> ${escapeHtml(service.on_site_contact_details.name)}${service.on_site_contact_details.phone ? ` (${escapeHtml(service.on_site_contact_details.phone)})` : ''}</div>
    </div>`;
  }

  return `<div style="color: #1e40af; font-size: calc(${settings.quoteBodyFontSize}px * 0.85); margin-top: 5px; background-color: rgba(239, 246, 255, 0.5); padding: 4px 6px; border-radius: 4px;">
    ${units.map((unit, uIdx) => `
      <div style="${uIdx > 0 ? 'border-top: 1px solid rgba(30, 64, 175, 0.2); padding-top: 4px; margin-top: 4px;' : ''}">
        ${units.length > 1 ? `<div style="font-weight: bold; text-decoration: underline; margin-bottom: 2px;">נסיעה ${uIdx + 1}</div>` : ''}
        ${(unit.pickupPoints || []).map((point, pIdx) => `
          <div style="margin-bottom: 2px;">
            ${unit.pickupPoints.length > 1 ? `<span style="font-weight: 600;">נקודה ${pIdx + 1}:</span>` : ''}
            ${point.time ? `<span style="margin-right: 6px;"><strong>שעה:</strong> ${escapeHtml(point.time)}</span>` : ''}
            ${point.location ? `<span style="margin-right: 6px;"><strong>מיקום:</strong> ${escapeHtml(point.location)}</span>` : ''}
            ${point.contact?.name ? `<div style="margin-top: 1px;"><strong>איש קשר:</strong> ${escapeHtml(point.contact.name)} ${point.contact.phone ? `(${escapeHtml(point.contact.phone)})` : ''}</div>` : ''}
          </div>
        `).join('')}
      </div>
    `).join('')}
  </div>`;
}

function renderServicesBlock(block, event, allServices, eventServices, settings) {
  if (!event || !eventServices || eventServices.length === 0) return '';
  const opts = block.options || {};
  const showPrices = opts.showPrices !== false && !event.all_inclusive;
  const showDescriptions = opts.showDescriptions !== false;
  const showQuantities = opts.showQuantities !== false;
  const showClientNotes = opts.showClientNotes !== false;
  const showTransportDetails = opts.showTransportDetails !== false;

  const populated = eventServices.map(es => {
    const sd = allServices.find(s => s.id === es.service_id) || {};
    return { ...sd, ...es, details: sd };
  }).sort((a, b) => (a.order_index || 0) - (b.order_index || 0));

  const mainPackages = populated.filter(s => s.is_package_main_item);
  const standalones = populated.filter(s => !s.is_package_main_item && !s.parent_package_event_service_id && !s.package_id);
  const processedLegacy = new Set();

  const fmt = (n) => `₪${safeFloat(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const servicesSectionTitle = event.services_section_title || 'חבילת ההפקה כוללת';
  const standaloneServicesTitle = event.standalone_services_title || '';
  let standaloneServicesTitleRendered = false;
  let html = `<div class="section services-section"><h2 class="section-title">${servicesSectionTitle}</h2>`;

  // New packages
  mainPackages.forEach(mp => {
    const children = populated.filter(c => c.parent_package_event_service_id === mp.id).sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
    const total = safeFloat(mp.custom_price) * (mp.quantity || 1);
    html += `
      <div class="package-group" style="margin-bottom: 40px;">
        <div class="package-header" style="padding-bottom: 8px; border-bottom: 1px solid #DAA520; margin-bottom: 15px;">
          <h3 class="package-title" style="color: #8B0000; font-size: calc(${settings.quoteTitleFontSize}px * 0.95); font-weight: 700; margin: 0;">${escapeHtml(mp.package_name || mp.service_name || '')}</h3>
          ${showDescriptions && (mp.package_description || mp.service_description) ? `<div class="package-description" style="color: #555; font-style: italic; margin-top: 6px; font-size: calc(${settings.quoteBodyFontSize}px * 0.95); line-height: 1.4;">${mp.package_description || mp.service_description}</div>` : ''}
        </div>
        <div class="package-content" style="padding-right: 15px;">
          ${children.map(child => `
            <div class="package-service-item" style="padding: 8px 0; border-bottom: 1px solid rgba(220,220,220,0.4); display: flex; align-items: flex-start;">
              <div style="color: #DAA520; margin-left: 10px;">•</div>
              <div style="flex: 1;">
                <strong style="color: #333; font-size: ${settings.quoteBodyFontSize}px;">${escapeHtml(child.service_name || '')}</strong>
                ${showDescriptions && child.service_description ? `<div style="color: #666; font-size: calc(${settings.quoteBodyFontSize}px * 0.95); margin-top: 2px;">${child.service_description}</div>` : ''}
                ${showClientNotes && child.client_notes ? `<div style="color: #888; font-size: calc(${settings.quoteBodyFontSize}px * 0.9); margin-top: 2px; font-style: italic;">${child.client_notes}</div>` : ''}
                ${showQuantities && child.quantity > 1 ? `<div style="color: #666; font-size: calc(${settings.quoteBodyFontSize}px * 0.9); margin-top: 2px;">כמות: ${child.quantity}</div>` : ''}
                ${showTransportDetails ? renderTransportDetails(child, settings) : ''}
              </div>
            </div>
          `).join('')}
        </div>
        ${showPrices ? `
        <div class="package-footer" style="margin-top: 15px; padding-top: 10px; border-top: 1px solid #DAA520; display: flex; justify-content: space-between; align-items: center;">
          <div style="font-size: ${settings.quoteBodyFontSize}px; font-weight: 600; color: #444;">סה"כ לחבילה:</div>
          <div>
            <span style="font-size: calc(${settings.quoteBodyFontSize}px * 1.2); font-weight: 700; color: #8B0000;">${fmt(total)}</span>
            <span style="font-size: calc(${settings.quoteBodyFontSize}px * 0.8); color: #777; margin-right: 8px;">${mp.includes_vat ? '(כולל מע"מ)' : '(לא כולל מע"מ)'}</span>
          </div>
        </div>` : ''}
      </div>`;
  });

  // Legacy packages
  populated.forEach(s => {
    if (s.is_package_main_item || s.parent_package_event_service_id) return;
    if (s.package_id && !processedLegacy.has(s.package_id)) {
      processedLegacy.add(s.package_id);
      const pkgServices = populated.filter(x => x.package_id === s.package_id && !x.is_package_main_item && !x.parent_package_event_service_id).sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
      const rep = pkgServices[0] || s;
      const total = safeFloat(rep.package_price);
      html += `
        <div class="package-group" style="margin-bottom: 40px;">
          <div class="package-header" style="padding-bottom: 8px; border-bottom: 1px solid #DAA520; margin-bottom: 15px;">
            <h3 class="package-title" style="color: #8B0000; font-size: calc(${settings.quoteTitleFontSize}px * 0.95); font-weight: 700; margin: 0;">${escapeHtml(rep.package_name || '')}</h3>
            ${showDescriptions && rep.package_description ? `<div style="color: #555; font-style: italic; margin-top: 6px; font-size: calc(${settings.quoteBodyFontSize}px * 0.95);">${rep.package_description}</div>` : ''}
          </div>
          <div style="padding-right: 15px;">
            ${pkgServices.map(child => `
              <div style="padding: 8px 0; border-bottom: 1px solid rgba(220,220,220,0.4); display: flex; align-items: flex-start;">
                <div style="color: #DAA520; margin-left: 10px;">•</div>
                <div style="flex: 1;">
                  <strong style="color: #333; font-size: ${settings.quoteBodyFontSize}px;">${escapeHtml(child.service_name || '')}</strong>
                  ${showDescriptions && child.service_description ? `<div style="color: #666; font-size: calc(${settings.quoteBodyFontSize}px * 0.95); margin-top: 2px;">${child.service_description}</div>` : ''}
                  ${showClientNotes && child.client_notes ? `<div style="color: #888; font-size: calc(${settings.quoteBodyFontSize}px * 0.9); margin-top: 2px; font-style: italic;">${child.client_notes}</div>` : ''}
                  ${showQuantities && child.quantity > 1 ? `<div style="color: #666; font-size: calc(${settings.quoteBodyFontSize}px * 0.9); margin-top: 2px;">כמות: ${child.quantity}</div>` : ''}
                  ${showTransportDetails ? renderTransportDetails(child, settings) : ''}
                </div>
              </div>
            `).join('')}
          </div>
          ${showPrices ? `
          <div style="margin-top: 15px; padding-top: 10px; border-top: 1px solid #DAA520; display: flex; justify-content: space-between;">
            <div style="font-size: ${settings.quoteBodyFontSize}px; font-weight: 600; color: #444;">סה"כ לחבילה:</div>
            <div>
              <span style="font-size: calc(${settings.quoteBodyFontSize}px * 1.2); font-weight: 700; color: #8B0000;">${fmt(total)}</span>
              <span style="font-size: calc(${settings.quoteBodyFontSize}px * 0.8); color: #777; margin-right: 8px;">${rep.package_includes_vat ? '(כולל מע"מ)' : '(לא כולל מע"מ)'}</span>
            </div>
          </div>` : ''}
        </div>`;
    }
  });

  // Standalone
  standalones.forEach(s => {
    if (standaloneServicesTitle && !standaloneServicesTitleRendered) {
      html += `<h3 class="category-title" style="font-size: calc(${settings.quoteTitleFontSize}px * 0.9); font-weight: 600; color: #8B0000; padding-bottom: 8px; margin: 15px 0 10px 0; border-bottom: 1px solid #DAA520;">${escapeHtml(standaloneServicesTitle)}</h3>`;
      standaloneServicesTitleRendered = true;
    }
    const total = safeFloat(s.custom_price) * (s.quantity || 1);
    html += `
      <div style="padding: 15px 0; border-bottom: 1px solid #e5e7eb; page-break-inside: avoid;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 200px;">
            <strong style="color: #1f2937; font-size: ${settings.quoteBodyFontSize}px;">${escapeHtml(s.service_name || '')}</strong>
            ${showDescriptions && s.service_description ? `<div style="color: #6b7280; font-size: ${settings.quoteBodyFontSize}px; margin-top: 5px;">${s.service_description}</div>` : ''}
            ${showClientNotes && s.client_notes ? `<div style="color: #9ca3af; font-size: calc(${settings.quoteBodyFontSize}px * 0.9); margin-top: 5px; font-style: italic;">${s.client_notes}</div>` : ''}
            ${showQuantities && s.quantity > 1 ? `<div style="color: #6b7280; font-size: ${settings.quoteBodyFontSize}px; margin-top: 3px;">כמות: ${s.quantity}</div>` : ''}
            ${showTransportDetails ? renderTransportDetails(s, settings) : ''}
          </div>
          ${showPrices ? `
          <div style="text-align: left; margin-top: 10px;">
            <strong style="color: #8B0000; font-size: ${settings.quoteBodyFontSize}px;">${fmt(total)}</strong>
            <div style="font-size: calc(${settings.quoteBodyFontSize}px * 0.8); color: #6b7280;">${s.includes_vat ? '(כולל מע"מ)' : '(לא כולל מע"מ)'}</div>
          </div>` : ''}
        </div>
      </div>`;
  });

  html += `</div>`;
  return html;
}

function renderFinancialSummaryBlock(block, event, eventServices, payments, settings) {
  if (!event) return '';
  const opts = block.options || {};
  const vatRate = settings.vatRate;

  // Mirror logic from generateQuotePdf
  let totalCostWithoutVat = 0;
  const isAllInclusive = event.all_inclusive === true || event.all_inclusive === 'true';
  const allInclusivePrice = safeFloat(event.all_inclusive_price);
  const totalOverride = safeFloat(event.total_override);

  if (isAllInclusive && allInclusivePrice > 0) {
    let p = allInclusivePrice;
    if (event.all_inclusive_includes_vat) p = p / (1 + vatRate);
    totalCostWithoutVat = p;
  } else if (event.total_override !== null && event.total_override !== undefined && event.total_override !== '' && totalOverride !== 0) {
    let p = totalOverride;
    if (event.total_override_includes_vat !== false) p = p / (1 + vatRate);
    totalCostWithoutVat = p;
  } else {
    const processed = new Set();
    totalCostWithoutVat = (eventServices || []).reduce((sum, s) => {
      const qty = safeFloat(s.quantity) || 1;
      if (s.is_package_main_item) {
        let t = safeFloat(s.custom_price) * qty;
        if (s.includes_vat) t = t / (1 + vatRate);
        return sum + t;
      }
      if (s.parent_package_event_service_id) return sum;
      if (s.package_id) {
        if (processed.has(s.package_id)) return sum;
        processed.add(s.package_id);
        let t = safeFloat(s.package_price);
        if (s.package_includes_vat) t = t / (1 + vatRate);
        return sum + t;
      }
      let t = safeFloat(s.custom_price) * qty;
      if (s.includes_vat) t = t / (1 + vatRate);
      return sum + t;
    }, 0);
  }

  const discount = safeFloat(event.discount_amount);
  let baseForVat = totalCostWithoutVat;
  if (event.discount_before_vat) baseForVat = Math.max(0, totalCostWithoutVat - discount);
  const vatAmount = baseForVat * vatRate;
  let totalCostWithVat = event.discount_before_vat ? (baseForVat + vatAmount) : (totalCostWithoutVat + vatAmount);
  let finalTotal = totalCostWithVat;
  if (!event.discount_before_vat) finalTotal = Math.max(0, totalCostWithVat - discount);
  const totalPaid = (payments || []).reduce((s, p) => s + safeFloat(p.amount), 0);

  const fmt = (n) => `₪${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return `
    <div class="section summary-section" style="margin-top: 50px; page-break-inside: avoid;">
      <h2 class="section-title">סיכום כספי</h2>
      <table class="summary-table" style="width:100%; border-collapse:collapse; font-size: ${settings.quoteSummaryFontSize}px; line-height: ${settings.quoteSummaryLineHeight};">
        <tr><td style="padding:6px 0; font-weight:600;">${event.all_inclusive ? 'מחיר חבילה (לפני מע"מ):' : 'סה"כ לפני מע"מ:'}</td><td style="text-align:left;">${fmt(totalCostWithoutVat)}</td></tr>
        ${opts.showDiscount !== false && event.discount_before_vat && discount > 0 ? `<tr><td style="padding:6px 0; color:#ef4444; font-weight:600;">הנחה${event.discount_reason ? ' (' + escapeHtml(event.discount_reason) + ')' : ''}:</td><td style="text-align:left; color:#ef4444;">- ${fmt(discount)}</td></tr>` : ''}
        ${opts.showVat !== false ? `<tr><td style="padding:6px 0; font-weight:600;">מע"מ:</td><td style="text-align:left;">${fmt(vatAmount)}</td></tr>` : ''}
        ${opts.showVat !== false ? `<tr><td style="padding:6px 0; font-weight:600;">סה"כ כולל מע"מ:</td><td style="text-align:left;">${fmt(totalCostWithVat)}</td></tr>` : ''}
        ${opts.showDiscount !== false && !event.discount_before_vat && discount > 0 ? `<tr><td style="padding:6px 0; color:#ef4444; font-weight:600;">הנחה${event.discount_reason ? ' (' + escapeHtml(event.discount_reason) + ')' : ''}:</td><td style="text-align:left; color:#ef4444;">- ${fmt(discount)}</td></tr>` : ''}
        <tr><td style="padding-top:10px; border-top:2px solid #8B0000; font-weight:700; color:#8B0000;">סה"כ לתשלום:</td><td style="padding-top:10px; border-top:2px solid #8B0000; text-align:left; font-weight:700; color:#8B0000;">${fmt(finalTotal)}</td></tr>
        ${opts.showPaid !== false ? `<tr><td style="padding:6px 0; font-weight:600;">שולם:</td><td style="text-align:left;">${fmt(totalPaid)}</td></tr>` : ''}
        ${opts.showBalance !== false ? `<tr><td style="padding-top:10px; border-top:2px solid #8B0000; font-weight:700; color:#8B0000;">יתרה לתשלום:</td><td style="padding-top:10px; border-top:2px solid #8B0000; text-align:left; font-weight:700; color:#8B0000;">${fmt(finalTotal - totalPaid)}</td></tr>` : ''}
      </table>
    </div>`;
}

function renderScheduleBlock(block, event, settings) {
  if (!event || !event.schedule || event.schedule.length === 0) return '';
  const esc = escapeHtml;
  return `
    <div class="section schedule-section" style="margin-top: 50px; page-break-inside: avoid;">
      <h2 class="section-title">לוח זמנים</h2>
      <table class="schedule-table" style="width: 100%; border-collapse: collapse; margin-top: 15px;">
        <tbody>
          ${(event.schedule || []).map(item => `
            <tr>
              <td style="width: 80px; padding: 10px 0; font-weight: 700; color: #8B0000; font-size: ${settings.quoteBodyFontSize}px; border-bottom: 1px solid #eee;">${esc(item.time)}</td>
              <td style="padding: 10px; font-size: ${settings.quoteBodyFontSize}px; color: ${settings.quoteTextColor}; border-bottom: 1px solid #eee;">
                <strong style="display: block; margin-bottom: 4px;">${esc(item.activity)}</strong>
                ${item.notes ? `<div style="font-size: calc(${settings.quoteBodyFontSize}px * 0.9); color: #666; font-style: italic; line-height: 1.4;">${esc(item.notes)}</div>` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderTemplateBlock(block, templates, type, sectionTitle, settings) {
  const opts = block.options || {};

  // Custom content for this quote only — falls back to template fonts/line-height
  if (opts.useCustomContent && opts.customContent) {
    const fallback = templates.find(t => t.id === opts.templateId) || templates.find(t => t.template_type === type);
    const fs = fallback?.font_size || settings.quoteSummaryFontSize;
    const lh = fallback?.line_height || settings.quoteSummaryLineHeight;
    if (type === 'agreement_disclaimer') {
      return `<div class="payment-terms" style="font-size: ${fs}px; line-height: ${lh}; color: ${settings.quoteTextColor}; padding: 10px 0;">${opts.customContent}</div>`;
    }
    return `
      <div class="section payment-section" style="margin-top: 50px; page-break-inside: avoid;">
        ${sectionTitle ? `<h2 class="section-title">${sectionTitle}</h2>` : ''}
        <div class="payment-terms" style="font-size: ${fs}px; line-height: ${lh}; color: ${settings.quoteTextColor}; padding: 10px 0;">${opts.customContent}</div>
      </div>`;
  }

  let template = null;
  if (opts.templateId) {
    template = templates.find(t => t.id === opts.templateId);
  }
  if (!template) {
    template = templates.find(t => t.template_type === type);
  }
  if (!template) return '';
  const fs = template.font_size || settings.quoteSummaryFontSize;
  const lh = template.line_height || settings.quoteSummaryLineHeight;
  if (type === 'agreement_disclaimer') {
    return `<div class="payment-terms" style="font-size: ${fs}px; line-height: ${lh}; color: ${settings.quoteTextColor}; padding: 10px 0;">${template.content || ''}</div>`;
  }
  return `
    <div class="section payment-section" style="margin-top: 50px; page-break-inside: avoid;">
      ${sectionTitle ? `<h2 class="section-title">${sectionTitle}</h2>` : ''}
      <div class="payment-terms" style="font-size: ${fs}px; line-height: ${lh}; color: ${settings.quoteTextColor}; padding: 10px 0;">${template.content || ''}</div>
    </div>`;
}

function renderSpacerBlock(block) {
  const h = parseInt(block.options?.height, 10) || 20;
  if (block.options?.showLine) {
    return `<div style="height: ${h}px; display: flex; align-items: center;"><hr style="border: 0; border-top: 1px solid #DAA520; width: 100%;" /></div>`;
  }
  return `<div style="height: ${h}px;"></div>`;
}

// =====================================================================
// Main HTML composer
// =====================================================================

async function composeManualQuoteHtml(manualQuote, base44Instance) {
  // Parse blocks
  let blocks = [];
  try {
    blocks = manualQuote.blocks ? JSON.parse(manualQuote.blocks) : [];
  } catch (e) {
    blocks = [];
  }

  // Load context
  const [appSettingsList, templates] = await Promise.all([
    base44Instance.asServiceRole.entities.AppSettings.list(),
    base44Instance.asServiceRole.entities.QuoteTemplate.list()
  ]);

  const appSettings = appSettingsList.reduce((acc, item) => ({ ...acc, [item.setting_key]: item.setting_value }), {});

  let event = null;
  let allServices = [];
  let eventServices = [];
  let payments = [];
  if (manualQuote.linked_event_id) {
    try {
      [event, allServices, eventServices, payments] = await Promise.all([
        base44Instance.asServiceRole.entities.Event.get(manualQuote.linked_event_id),
        base44Instance.asServiceRole.entities.Service.list(),
        base44Instance.asServiceRole.entities.EventService.filter({ event_id: manualQuote.linked_event_id }),
        base44Instance.asServiceRole.entities.Payment.filter({ event_id: manualQuote.linked_event_id })
      ]);
    } catch (e) {
      console.error('Failed to load linked event context:', e);
    }
  }

  const settings = {
    quoteBodyFontSize: appSettings.quote_body_font_size || '15',
    quoteTitleFontSize: appSettings.quote_title_font_size || '16',
    quoteGeneralLineHeight: appSettings.quote_line_height || '1.6',
    quoteSummaryLineHeight: appSettings.quote_summary_line_height || appSettings.quote_line_height || '1.6',
    quoteEventDetailsFontSize: appSettings.quote_event_details_font_size || appSettings.quote_body_font_size || '15',
    quoteEventDetailsLineHeight: appSettings.quote_event_details_line_height || appSettings.quote_line_height || '1.6',
    quoteSummaryFontSize: appSettings.quote_summary_font_size || appSettings.quote_body_font_size || '15',
    quoteTextColor: appSettings.quote_text_color || '#333333',
    backgroundImage: appSettings.quote_background_image || '',
    quoteShowFooter: String(appSettings.quote_show_footer) === 'true',
    quoteFooterText: appSettings.quote_footer_text || '',
    quoteMarginTop: appSettings.quote_margin_top_mm || '20',
    quoteMarginBottom: appSettings.quote_margin_bottom_mm || '35',
    quoteMarginLeft: appSettings.quote_margin_left_mm || '20',
    quoteMarginRight: appSettings.quote_margin_right_mm || '20',
    vatRate: parseFloat(appSettings.vat_rate) / 100 || 0.18
  };

  // Render blocks
  let body = '';
  for (const block of blocks) {
    switch (block.type) {
      case 'free_text': body += renderFreeTextBlock(block, settings); break;
      case 'heading': body += renderHeadingBlock(block); break;
      case 'event_details': body += renderEventDetailsBlock(block, event, settings); break;
      case 'intro_template': body += renderIntroBlock(block, event, templates, settings); break;
      case 'services': body += renderServicesBlock(block, event, allServices, eventServices, settings); break;
      case 'financial_summary': body += renderFinancialSummaryBlock(block, event, eventServices, payments, settings); break;
      case 'schedule': body += renderScheduleBlock(block, event, settings); break;
      case 'payment_terms': body += renderTemplateBlock(block, templates, 'payment_terms', 'תנאי תשלום', settings); break;
      case 'agreement_disclaimer': body += renderTemplateBlock(block, templates, 'agreement_disclaimer', '', settings); break;
      case 'spacer': body += renderSpacerBlock(block); break;
      default: break;
    }
  }

  // Build file name
  let fileBaseName = manualQuote.title || 'הצעת מחיר ידנית';
  if (event) {
    fileBaseName = `${getEventType(event.event_type)} של ${event.child_name ? event.child_name + ' ' : ''}${event.family_name || ''} ${formatDate(event.event_date)}`.trim();
  }

  const html = `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(fileBaseName)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Assistant:wght@300;400;600;700&display=swap');
    * { box-sizing: border-box; }
    @page { size: A4; margin: 0; }
    body {
      font-family: 'Assistant', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
      margin: 0; padding: 0;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
      color: ${settings.quoteTextColor};
      font-size: ${settings.quoteBodyFontSize}px;
      line-height: ${settings.quoteGeneralLineHeight};
      position: relative;
      background-color: transparent;
    }
    ${settings.backgroundImage ? `
    body::before {
      content: ""; position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background-image: url('${settings.backgroundImage}');
      background-size: cover; background-position: center; background-repeat: no-repeat;
      z-index: -1;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }` : 'body { background-color: #ffffff; }'}
    .page-content {
      width: 100%;
      background: transparent;
      position: relative;
      z-index: 1;
      padding-left: ${settings.quoteMarginLeft}mm;
      padding-right: ${settings.quoteMarginRight}mm;
    }
    .section { margin-bottom: 40px; }
    .section-title {
      font-size: ${settings.quoteTitleFontSize}px;
      font-weight: 700; color: #8B0000;
      border-bottom: 2px solid #DAA520;
      padding-bottom: 10px;
      margin-top: 0; margin-bottom: 20px;
      page-break-after: avoid;
    }
    .footer { text-align: center; padding: 15px; font-size: calc(${settings.quoteBodyFontSize}px * 0.8); color: #666; border-top: 1px solid #eee; margin-top: 40px; page-break-inside: avoid; }
    .manual-block-text * { line-height: inherit; }
    .manual-block-text img { max-width: 100%; height: auto; }
    .manual-block-text table { border-collapse: collapse; }
    .manual-block-text table td, .manual-block-text table th { border: 1px solid #ccc; padding: 6px 8px; }
    .manual-block-text [data-text-align="right"] { text-align: right; }
    .manual-block-text [data-text-align="center"] { text-align: center; }
    .manual-block-text [data-text-align="left"] { text-align: left; }
    .manual-block-text [data-text-align="justify"] { text-align: justify; }
    .manual-block-text blockquote { border-right: 3px solid #DAA520; border-left: none; padding-right: 1em; padding-left: 0; color: #555; font-style: italic; margin: 1em 0; }
  </style>
</head>
<body>
  <table style="width:100%; border-collapse:collapse; border:none;">
    <thead><tr><td><div style="height: ${settings.quoteMarginTop}mm;">&nbsp;</div></td></tr></thead>
    <tbody>
      <tr><td>
        <div class="page-content">
          ${body}
          ${settings.quoteShowFooter ? `<div class="footer"><div>${escapeHtml(settings.quoteFooterText)}</div></div>` : ''}
        </div>
      </td></tr>
    </tbody>
    <tfoot><tr><td><div style="height: ${settings.quoteMarginBottom}mm;">&nbsp;</div></td></tr></tfoot>
  </table>
</body>
</html>`;

  return { html, fileBaseName, event };
}

// =====================================================================
// Main handler
// =====================================================================

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await req.json();
    const { manualQuoteId } = body;
    if (!manualQuoteId) {
      return Response.json({ error: 'manualQuoteId is required' }, { status: 400 });
    }

    const manualQuote = await base44.asServiceRole.entities.ManualQuote.get(manualQuoteId);
    if (!manualQuote) {
      return Response.json({ error: 'Manual quote not found' }, { status: 404 });
    }

    const { html, fileBaseName, event } = await composeManualQuoteHtml(manualQuote, base44);

    const apiKey = Deno.env.get('API2PDF_API_KEY');
    if (!apiKey) throw new Error('API2PDF_API_KEY is not set');

    const response = await fetch('https://v2.api2pdf.com/chrome/html', {
      method: 'POST',
      headers: { 'Authorization': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html,
        inlinePdf: true,
        fileName: `${fileBaseName}.pdf`,
        options: {
          printBackground: true,
          preferCSSPageSize: true,
          displayHeaderFooter: false,
          marginTop: '0', marginBottom: '0', marginLeft: '0', marginRight: '0',
          landscape: false, scale: 1
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API2PDF failed: ${errorText}`);
    }

    const result = await response.json();
    if (!result.pdf) throw new Error('No PDF URL in API2PDF response');
    const pdfUrl = result.pdf;
    const fileName = `${fileBaseName}.pdf`;
    let savedFileUri = null;

    // Save to private storage + update quote history (if linked) + update manual quote record
    try {
      const pdfDownload = await fetch(pdfUrl);
      const pdfArrayBuffer = await pdfDownload.arrayBuffer();
      const pdfBlob = new Blob([new Uint8Array(pdfArrayBuffer)], { type: 'application/pdf' });
      const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });
      const uploadResult = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file: pdfFile });
      const fileUri = uploadResult.file_uri;
      savedFileUri = fileUri;

      // Update manual quote record
      await base44.asServiceRole.entities.ManualQuote.update(manualQuoteId, {
        last_pdf_uri: fileUri,
        last_pdf_name: fileName,
        status: 'finalized'
      });

      // Append to event quote_history if linked
      if (event && event.id) {
        const currentEvent = await base44.asServiceRole.entities.Event.get(event.id);
        const existingHistory = currentEvent.quote_history || [];
        const newEntry = {
          file_uri: fileUri,
          file_name: fileName,
          created_at: new Date().toISOString(),
          created_by_user_name: user.full_name || user.email || 'לא ידוע',
          event_status: currentEvent.status || 'quote'
        };
        await base44.asServiceRole.entities.Event.update(event.id, {
          quote_history: [...existingHistory, newEntry]
        });
      }
    } catch (historyError) {
      console.error('Non-blocking: failed to save PDF to storage/history:', historyError);
    }

    return Response.json({ pdf_url: pdfUrl, fileName, file_uri: savedFileUri });
  } catch (error) {
    console.error('Error in generateManualQuotePdf:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});