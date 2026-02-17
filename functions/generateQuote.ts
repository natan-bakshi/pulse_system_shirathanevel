import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

// Helper functions from generateQuotePdf
function groupBy(arr, keyAccessor) {
  return arr.reduce((acc, obj) => {
    const key = keyAccessor(obj);
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(obj);
    return acc; // Keep this return statement
  }, {});
}

function formatDate(dateStringOrDate) {
    if (!dateStringOrDate) return '';
    let date;
    if (dateStringOrDate instanceof Date) {
        date = dateStringOrDate;
    } else {
        try {
            date = new Date(dateStringOrDate);
        } catch (e) {
            return '';
        }
    }
    if (isNaN(date.getTime())) return '';
    // Changed to manual formatting instead of toLocaleDateString for consistency and custom separator
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0'); // Month is 0-indexed
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
}

function getEventType(typeKey) {
    const types = {
        bar_mitzvah: "בר מצווה",
        bat_mitzvah: "בת מצווה",
        wedding: "חתונה",
        other: "אירוע"
    };
    return types[typeKey] || "אירוע";
}


Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Prevent suppliers from generating quotes
    if (user.user_type === 'supplier') {
      return Response.json({ error: 'Unauthorized - Suppliers cannot generate quotes' }, { status: 403 });
    }

    const body = await req.json();
    const eventId = body.eventId;
    const includeIntro = body.includeIntro !== false; // default true
    const includePaymentTerms = body.includePaymentTerms !== false; // default true

    if (!eventId) {
      return Response.json({ error: 'Event ID is required' }, { status: 400 });
    }

    // Using the same logic as generateQuotePdf
    const [event, allServices, allEventServices, payments, templates, appSettingsList] = await Promise.all([
      base44.asServiceRole.entities.Event.get(eventId),
      base44.asServiceRole.entities.Service.list(),
      base44.asServiceRole.entities.EventService.filter({ event_id: eventId }),
      base44.asServiceRole.entities.Payment.filter({ event_id: eventId }),
      base44.asServiceRole.entities.QuoteTemplate.list(),
      base44.asServiceRole.entities.AppSettings.list()
    ]);
    
    if (!event) {
        throw new Error('Event not found');
    }

    const appSettings = appSettingsList.reduce((acc, item) => ({ ...acc, [item.setting_key]: item.setting_value }), {});
    const introTemplate = templates.find(t => t.template_type === 'concept_intro' && t.identifier === event.concept);
    const paymentTemplate = templates.find(t => t.template_type === 'payment_terms');
    
    const quoteBodyFontSize = appSettings.quote_body_font_size || '15';
    const quoteTitleFontSize = appSettings.quote_title_font_size || '16';
    const quoteGeneralLineHeight = appSettings.quote_line_height || '1.6';
    // Intro settings now come from the template itself with defaults
    const quoteIntroLineHeight = introTemplate?.line_height || quoteGeneralLineHeight;
    const quoteIntroFontSize = introTemplate?.font_size || quoteBodyFontSize;

    const quoteSummaryLineHeight = paymentTemplate?.line_height || appSettings.quote_summary_line_height || quoteGeneralLineHeight;
    const backgroundImage = appSettings.quote_background_image || '';
    
    // New Settings
    const quoteHideLogo = String(appSettings.quote_hide_logo).toLowerCase() === 'true';
    const quoteTextColor = appSettings.quote_text_color || '#333333';
    
    const quoteEventDetailsFontSize = appSettings.quote_event_details_font_size || quoteBodyFontSize;
    const quoteEventDetailsLineHeight = appSettings.quote_event_details_line_height || quoteGeneralLineHeight;
    
    const quoteSummaryFontSize = appSettings.quote_summary_font_size || quoteBodyFontSize;

    // Footer settings
    const quoteShowFooter = String(appSettings.quote_show_footer) === 'true';
    const quoteFooterText = appSettings.quote_footer_text || '';

    // HTML Preview - standard padding
    // Margins removed as requested

    // CRITICAL FIX: Sort by order_index BEFORE processing
    const sortedEventServices = [...allEventServices].sort((a, b) => (a.order_index || 0) - (b.order_index || 0));

    // CRITICAL FIX: Spread serviceDetails FIRST, then es, so EventService properties take precedence
    const populatedServices = sortedEventServices.map(es => {
        const serviceDetails = allServices.find(s => s.id === es.service_id) || {};
        return {
            ...serviceDetails, // Service properties first
            ...es,             // EventService properties second (overwrite if names clash)
            details: serviceDetails
        };
    });

    const vatRate = parseFloat(appSettings.vat_rate) / 100 || 0.18;
    
    // Helper to safely parse numbers (aligned with eventFinancials.js)
    const safeFloat = (val) => {
        if (val === null || val === undefined || val === '') return 0;
        const num = parseFloat(val);
        return isNaN(num) ? 0 : num;
    };
    
    // Logic aligned with eventFinancials.js
    let totalCostWithoutVat = 0;
    
    const isAllInclusive = event.all_inclusive === true || event.all_inclusive === 'true';
    const allInclusivePrice = safeFloat(event.all_inclusive_price);
    const totalOverride = safeFloat(event.total_override);

    if (isAllInclusive && allInclusivePrice > 0) {
        let price = allInclusivePrice;
        if (event.all_inclusive_includes_vat) {
            price = price / (1 + vatRate);
        }
        totalCostWithoutVat = price;
    } else if (event.total_override !== null && event.total_override !== undefined && event.total_override !== "" && totalOverride !== 0) {
        let price = totalOverride;
        const overrideIncludesVat = event.total_override_includes_vat !== false;
        
        if (overrideIncludesVat) {
            price = price / (1 + vatRate);
        }
        totalCostWithoutVat = price;
    } else {
        const processedLegacyPackages = new Set();

        totalCostWithoutVat = populatedServices.reduce((sum, s) => {
            const quantity = safeFloat(s.quantity) || 1;
            
            // 1. New Structure: Main Package Item
            if (s.is_package_main_item) {
                const price = safeFloat(s.custom_price);
                let itemTotal = price * quantity;
                if (s.includes_vat) itemTotal = itemTotal / (1 + vatRate);
                return sum + itemTotal;
            }

            // 2. New Structure: Child Item (Skip)
            if (s.parent_package_event_service_id) {
                return sum;
            }

            // 3. Legacy Structure: Item in a package
            if (s.package_id) {
                if (processedLegacyPackages.has(s.package_id)) {
                    return sum;
                }
                processedLegacyPackages.add(s.package_id);
                
                const price = safeFloat(s.package_price);
                let pkgTotal = price;
                if (s.package_includes_vat) {
                    pkgTotal = pkgTotal / (1 + vatRate);
                }
                return sum + pkgTotal;
            }

            // 4. Standalone Service
            const price = safeFloat(s.custom_price);
            let serviceTotal = price * quantity;
            
            if (s.includes_vat) {
                serviceTotal = serviceTotal / (1 + vatRate);
            }
            return sum + serviceTotal;
        }, 0);
    }

    // Apply Discount BEFORE VAT if applicable (aligned with eventFinancials.js)
    let eventDiscountAmount = safeFloat(event.discount_amount);
    let baseForVat = totalCostWithoutVat;
    
    if (event.discount_before_vat) {
        baseForVat = Math.max(0, totalCostWithoutVat - eventDiscountAmount);
    }

    // Calculate VAT
    const vatAmount = baseForVat * vatRate;
    
    // Calculate Total With VAT
    let totalCostWithVat = 0;
    
    if (event.discount_before_vat) {
        totalCostWithVat = baseForVat + vatAmount;
    } else {
        totalCostWithVat = totalCostWithoutVat + vatAmount;
    }

    // Apply Discount AFTER VAT if applicable
    let finalTotal = totalCostWithVat;
    if (!event.discount_before_vat) {
        finalTotal = Math.max(0, totalCostWithVat - eventDiscountAmount);
    }
    
    const baseTotalWithoutDiscount = totalCostWithoutVat; // For display compatibility
    const totalPaid = payments.reduce((sum, p) => sum + safeFloat(p.amount), 0);
    
    // Group services by new and legacy structure
    const structuredServices = [];
    const processedLegacyPackages = new Set();
    
    // Handle new structure: Main Package Items
    const mainPackageItems = populatedServices.filter(s => s.is_package_main_item).sort((a,b) => (a.order_index || 0) - (b.order_index || 0));
    
    mainPackageItems.forEach(mainPkg => {
        const packageChildren = populatedServices.filter(s => s.parent_package_event_service_id === mainPkg.id).sort((a,b) => (a.order_index || 0) - (b.order_index || 0));
        structuredServices.push({
            type: 'package',
            main: mainPkg,
            children: packageChildren
        });
    });

    // Handle legacy structure: package_id grouping
    populatedServices.forEach(service => {
        // Skip if already processed as new structure
        if (service.is_package_main_item || service.parent_package_event_service_id) return;
        
        // Check if this is a legacy package
        if (service.package_id && !processedLegacyPackages.has(service.package_id)) {
            processedLegacyPackages.add(service.package_id);
            
            // Get all services in this legacy package
            const packageServices = populatedServices
                .filter(s => s.package_id === service.package_id && !s.is_package_main_item && !s.parent_package_event_service_id)
                .sort((a,b) => (a.order_index || 0) - (b.order_index || 0));
            
            // Use first service as package representative
            const packageRep = packageServices[0];
            
            structuredServices.push({
                type: 'package',
                main: {
                    package_name: packageRep.package_name,
                    package_description: packageRep.package_description,
                    custom_price: packageRep.package_price,
                    quantity: 1,
                    includes_vat: packageRep.package_includes_vat,
                    order_index: packageRep.order_index
                },
                children: packageServices
            });
        }
    });

    // Handle standalone services (not in any package)
    const standaloneServicesList = populatedServices.filter(s => 
        !s.is_package_main_item && 
        !s.parent_package_event_service_id && 
        !s.package_id
    ).sort((a,b) => (a.order_index || 0) - (b.order_index || 0));

    standaloneServicesList.forEach(s => {
        structuredServices.push({
            type: 'standalone',
            service: s
        });
    });
    
    // Sort structured services: packages first (by order_index), then standalone services (by order_index)
    structuredServices.sort((a, b) => {
        // Packages come before standalone services
        if (a.type === 'package' && b.type === 'standalone') return -1;
        if (a.type === 'standalone' && b.type === 'package') return 1;
        
        // Within the same type, sort by order_index
        const orderA = a.type === 'package' ? a.main.order_index : a.service.order_index;
        const orderB = b.type === 'package' ? b.main.order_index : b.service.order_index;
        return (orderA || 0) - (orderB || 0);
    });

    const hasPackages = structuredServices.some(item => item.type === 'package');
    const hasStandaloneServices = structuredServices.some(item => item.type === 'standalone');
    
    const familyDetailsLine = `${getEventType(event.event_type)} של ${event.child_name || ''} ${event.family_name}`.trim();
    
    // Updated file name format
    const fileAndTitleName = `${getEventType(event.event_type)} של ${event.child_name ? event.child_name + ' ' : ''}${event.family_name} ${formatDate(event.event_date)}`;

    const eventDetailsHtml = `
            <div class="event-details-box">
                <div class="text-center">
                    <span style="font-weight: 700; font-size: calc(${quoteEventDetailsFontSize}px + 1px);">${familyDetailsLine}</span><br>
                    ${event.location ? `<strong>אירוע ב${event.location}</strong> | ` : ''}${formatDate(event.event_date)}<br>
                    ${event.parents && event.parents.length > 0 && event.parents.some(p => p.name) ? `<strong>שמות ההורים:</strong> ${event.parents.map(p => p.name).filter(Boolean).join(', ')}<br>` : ''}
                    ${event.city ? `<strong>עיר מגורים:</strong> ${event.city} |` : ''} ${event.guest_count ? `<strong>כמות מוזמנים:</strong> ${event.guest_count}` : ''}
                </div>
            </div>
    `;

    let servicesHtml = '';
    if (structuredServices.length > 0) {
        servicesHtml = `<div class="section services-section"><h2 class="section-title">חבילת ההפקה כוללת</h2>`;
        
        structuredServices.forEach(item => {
            if (item.type === 'package') {
                const mainPkg = item.main;
                const packageTotal = (mainPkg.custom_price || 0) * (mainPkg.quantity || 1);
                
                servicesHtml += `
                    <div class="package-group">
                        <div class="package-header">
                            <h3 class="package-title">${mainPkg.package_name || mainPkg.service_name}</h3>
                            ${(mainPkg.package_description || mainPkg.service_description) ? `<div class="package-description">${mainPkg.package_description || mainPkg.service_description}</div>` : ''}
                        </div>
                        <div class="package-content">
                `;

                item.children.forEach(service => {
                    const serviceDescription = service.service_description || '';
                    const transportDetailsHtml = service.category === 'נסיעות' 
  ? (() => {
      let units = [];
      try {
         const parsed = JSON.parse(service.pickup_point || '[]');
         units = Array.isArray(parsed) ? parsed : [];
      } catch (e) {
         // Fallback logic
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

      // If simple legacy data with just contact and no units/JSON
      if (units.length === 0 && service.on_site_contact_details?.name) {
         return `<div style="color: #1e40af; font-size: calc(${quoteBodyFontSize}px * 0.85); margin-top: 5px; background-color: rgba(239, 246, 255, 0.5); padding: 4px 6px; border-radius: 4px;">
             <div><strong>איש קשר במקום:</strong> ${service.on_site_contact_details.name}${service.on_site_contact_details.phone ? ` (${service.on_site_contact_details.phone})` : ''}</div>
         </div>`;
      }

      return `<div style="color: #1e40af; font-size: calc(${quoteBodyFontSize}px * 0.85); margin-top: 5px; background-color: rgba(239, 246, 255, 0.5); padding: 4px 6px; border-radius: 4px;">
         ${units.map((unit, uIdx) => `
             <div style="${uIdx > 0 ? 'border-top: 1px solid rgba(30, 64, 175, 0.2); padding-top: 4px; margin-top: 4px;' : ''}">
                 ${units.length > 1 ? `<div style="font-weight: bold; text-decoration: underline; margin-bottom: 2px;">נסיעה ${uIdx + 1}</div>` : ''}
                 ${unit.pickupPoints.map((point, pIdx) => `
                     <div style="margin-bottom: 2px;">
                         ${unit.pickupPoints.length > 1 ? `<span style="font-weight: 600;">נקודה ${pIdx + 1}:</span>` : ''}
                         ${point.time ? `<span style="margin-right: 6px;"><strong>שעה:</strong> ${point.time}</span>` : ''}
                         ${point.location ? `<span style="margin-right: 6px;"><strong>מיקום:</strong> ${point.location}</span>` : ''}
                         ${point.contact?.name ? `<div style="margin-top: 1px;"><strong>איש קשר:</strong> ${point.contact.name} ${point.contact.phone ? `(${point.contact.phone})` : ''}</div>` : ''}
                     </div>
                 `).join('')}
             </div>
         `).join('')}
      </div>`;
  })()
  : '';


                    servicesHtml += `
                        <div class="package-service-item">
                            <div class="package-service-bullet">•</div>
                            <div style="flex: 1;">
                                <strong style="color: #333; font-size: ${quoteBodyFontSize}px;">${service.service_name}</strong>
                                ${serviceDescription ? `<div style="color: #666; font-size: calc(${quoteBodyFontSize}px * 0.95); margin-top: 2px;">${serviceDescription}</div>` : ''}
                                ${service.client_notes ? `<div style="color: #888; font-size: calc(${quoteBodyFontSize}px * 0.9); margin-top: 2px; font-style: italic;">${service.client_notes}</div>` : ''}
                                ${service.quantity > 1 ? `<div style="color: #666; font-size: calc(${quoteBodyFontSize}px * 0.9); margin-top: 2px;">כמות: ${service.quantity}</div>` : ''}
                                ${transportDetailsHtml}
                            </div>
                        </div>
                    `;
                });

                servicesHtml += `</div>`; // Close content

                // Footer with price
                if (!event.all_inclusive) {
                    servicesHtml += `
                        <div class="package-footer">
                            <div class="package-price-label">סה"כ לחבילה:</div>
                            <div class="package-price-container">
                                <span class="package-price-value">₪${packageTotal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                                <span class="package-vat-note">${mainPkg.includes_vat ? '(כולל מע"מ)' : '(לא כולל מע"מ)'}</span>
                            </div>
                        </div>
                    `;
                }
                servicesHtml += `</div>`; // Close group

            } else if (item.type === 'standalone') {
                const service = item.service;
                const serviceTotal = (service.custom_price || 0) * (service.quantity || 1);
                const serviceDescription = service.service_description || '';
                const transportDetailsHtml = service.category === 'נסיעות' 
  ? (() => {
      let units = [];
      try {
         const parsed = JSON.parse(service.pickup_point || '[]');
         units = Array.isArray(parsed) ? parsed : [];
      } catch (e) {
         // Fallback logic
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

      // If simple legacy data with just contact and no units/JSON
      if (units.length === 0 && service.on_site_contact_details?.name) {
         return `<div style="color: #1e40af; font-size: calc(${quoteBodyFontSize}px * 0.85); margin-top: 5px; background-color: rgba(239, 246, 255, 0.5); padding: 4px 6px; border-radius: 4px;">
             <div><strong>איש קשר במקום:</strong> ${service.on_site_contact_details.name}${service.on_site_contact_details.phone ? ` (${service.on_site_contact_details.phone})` : ''}</div>
         </div>`;
      }

      return `<div style="color: #1e40af; font-size: calc(${quoteBodyFontSize}px * 0.85); margin-top: 5px; background-color: rgba(239, 246, 255, 0.5); padding: 4px 6px; border-radius: 4px;">
         ${units.map((unit, uIdx) => `
             <div style="${uIdx > 0 ? 'border-top: 1px solid rgba(30, 64, 175, 0.2); padding-top: 4px; margin-top: 4px;' : ''}">
                 ${units.length > 1 ? `<div style="font-weight: bold; text-decoration: underline; margin-bottom: 2px;">נסיעה ${uIdx + 1}</div>` : ''}
                 ${unit.pickupPoints.map((point, pIdx) => `
                     <div style="margin-bottom: 2px;">
                         ${unit.pickupPoints.length > 1 ? `<span style="font-weight: 600;">נקודה ${pIdx + 1}:</span>` : ''}
                         ${point.time ? `<span style="margin-right: 6px;"><strong>שעה:</strong> ${point.time}</span>` : ''}
                         ${point.location ? `<span style="margin-right: 6px;"><strong>מיקום:</strong> ${point.location}</span>` : ''}
                         ${point.contact?.name ? `<div style="margin-top: 1px;"><strong>איש קשר:</strong> ${point.contact.name} ${point.contact.phone ? `(${point.contact.phone})` : ''}</div>` : ''}
                     </div>
                 `).join('')}
             </div>
         `).join('')}
      </div>`;
  })()
  : '';


                servicesHtml += `
                    <div style="padding: 15px 0; border-bottom: 1px solid #e5e7eb;">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap;">
                            <div style="flex: 1; min-width: 200px;">
                                <strong style="color: #1f2937; font-size: ${quoteBodyFontSize}px;">${service.service_name}</strong>
                                ${serviceDescription ? `<div style="color: #6b7280; font-size: ${quoteBodyFontSize}px; margin-top: 5px;">${serviceDescription}</div>` : ''}
                                ${service.client_notes ? `<div style="color: #9ca3af; font-size: calc(${quoteBodyFontSize}px * 0.9); margin-top: 5px; font-style: italic;">${service.client_notes}</div>` : ''}
                                ${service.quantity > 1 ? `<div style="color: #6b7280; font-size: ${quoteBodyFontSize}px; margin-top: 3px;">כמות: ${service.quantity}</div>` : ''}
                                ${transportDetailsHtml}
                            </div>
                            ${!event.all_inclusive ? `
                            <div style="text-align: left; margin-top: 10px;">
                                <strong style="color: #8B0000; font-size: ${quoteBodyFontSize}px;">₪${serviceTotal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</strong>
                                ${service.includes_vat ? `<div style="font-size: calc(${quoteBodyFontSize}px * 0.8); color: #6b7280;">(כולל מע"מ)</div>` : `<div style="font-size: calc(${quoteBodyFontSize}px * 0.8); color: #6b7280;">(לא כולל מע"מ)</div>`}
                            </div>
                            ` : ''}
                        </div>
                    </div>
                `;
            }
        });
        
        servicesHtml += `</div>`;
    }

    let notesHtml = '';
    if (event.notes) {
        notesHtml = `
        <div class="section" style="margin-top: 40px;">
            <h2 class="section-title">הערות</h2>
            <div class="event-notes">${event.notes}</div>
        </div>`;
    }
    
    // fileAndTitleName already defined above

    const html = `
      <!DOCTYPE html>
      <html dir="rtl" lang="he">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${fileAndTitleName}</title>
          <style>
              @import url('https://fonts.googleapis.com/css2?family=Assistant:wght@300;400;600;700&display=swap');
              
              * { box-sizing: border-box; }
              
              body {
                  font-family: 'Assistant', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
                  margin: 0;
                  padding: 20px;
                  -webkit-print-color-adjust: exact;
                  print-color-adjust: exact;
                  color: ${quoteTextColor};
                  font-size: ${quoteBodyFontSize}px;
                  line-height: ${quoteGeneralLineHeight};
                  position: relative;
                  min-height: 100vh;
                  
                  ${backgroundImage ? `
                  background-image: url('${backgroundImage}');
                  background-size: cover;
                  background-position: center;
                  background-repeat: no-repeat;
                  background-attachment: fixed;
                  ` : 'background-color: #f4f4f4;'}
              }
              
              .page-content {
                  max-width: 210mm;
                  min-height: 297mm;
                  margin: 0 auto;
                  background: transparent;
                  padding: 20mm;
                  box-shadow: none;
                  position: relative;
                  z-index: 1;
                  line-height: ${quoteGeneralLineHeight};
              }
              
              .header { text-align: center; margin-bottom: 30px; display: ${quoteHideLogo ? 'none !important' : 'block'}; }
              .header img { max-height: 80px; margin-bottom: 15px; max-width: 100%; height: auto; }
              .date { text-align: left; font-size: calc(${quoteBodyFontSize}px * 0.9); color: #666; margin-bottom: 20px; font-weight: 600; }
              
              .event-details-box {
                  background-color: transparent;
                  padding: 15px;
                  margin-bottom: 25px;
                  font-size: ${quoteEventDetailsFontSize}px;
                  line-height: ${quoteEventDetailsLineHeight};
                  text-align: center;
              }
              
              .event-details-box * {
                  background-color: transparent !important;
              }
              
              .section { margin-bottom: 40px; page-break-inside: avoid; }
              
              .section-title {
                  font-size: ${quoteTitleFontSize}px;
                  font-weight: 700;
                  color: #8B0000;
                  border-bottom: 2px solid #DAA520;
                  padding-bottom: 10px;
                  margin-top: 0;
                  margin-bottom: 20px;
              }
              
              .category-title {
                  font-size: calc(${quoteTitleFontSize}px * 0.9);
                  font-weight: 600;
                  color: #8B0000;
                  padding-bottom: 8px;
                  margin: 15px 0 10px 0;
                  border-bottom: 1px solid #DAA520;
              }

              .package-section {
                  margin-bottom: 30px;
                  border: 2px solid #8B0000;
                  padding: 15px;
                  border-radius: 8px;
                  background-color: rgba(248,248,248,0.3);
              }
              
              /* Refined Elegant Package Design */
              .package-group {
                  margin-bottom: 40px;
                  page-break-inside: avoid;
                  /* No background or border to allow page background to show */
              }

              .package-header {
                  padding-bottom: 8px;
                  border-bottom: 1px solid #DAA520; /* Matching the theme gold line */
                  margin-bottom: 15px;
                  /* Transparent background */
              }
              
              .package-title {
                  color: #8B0000;
                  font-size: calc(${quoteTitleFontSize}px * 0.95); /* Balanced size */
                  font-weight: 700;
                  margin: 0;
              }

              .package-description {
                  color: #555;
                  font-style: italic;
                  margin-top: 6px;
                  font-size: calc(${quoteBodyFontSize}px * 0.95);
                  line-height: 1.4;
              }

              .package-content {
                  padding-right: 15px; /* Gentle indent to show hierarchy */
              }

              .package-service-item {
                  padding: 8px 0;
                  border-bottom: 1px solid rgba(220, 220, 220, 0.4); /* Very subtle divider */
                  display: flex;
                  align-items: flex-start;
              }

              .package-service-item:last-child {
                  border-bottom: none;
              }

              .package-service-bullet {
                  color: #DAA520; /* Elegant gold bullet */
                  margin-left: 10px;
                  font-size: 1em;
                  line-height: 1.6;
              }

              .package-footer {
                  margin-top: 15px;
                  padding-top: 10px;
                  border-top: 1px solid #DAA520; /* Matching top line */
                  display: flex;
                  justify-content: space-between;
                  align-items: center;
              }

              .package-price-label {
                  font-size: ${quoteBodyFontSize}px;
                  font-weight: 600;
                  color: #444;
              }

              .package-price-container {
                  display: flex;
                  align-items: baseline;
                  gap: 8px;
              }

              .package-price-value {
                  font-size: calc(${quoteBodyFontSize}px * 1.2);
                  font-weight: 700;
                  color: #8B0000;
              }
              
              .package-vat-note {
                  font-size: calc(${quoteBodyFontSize}px * 0.8);
                  color: #777;
              }
              
              .intro-content { 
                  text-align: center; 
                  font-size: ${quoteIntroFontSize}px;
                  line-height: ${quoteIntroLineHeight};
                  color: ${quoteTextColor};
                  padding: 10px 0;
              }
              
              .intro-content *, .intro-content p, .intro-content span, .intro-content div, .intro-content li, .intro-content strong, .intro-content b, .intro-content u, .intro-content em, .intro-content a, .intro-content h1, .intro-content h2, .intro-content h3, .intro-content h4, .intro-content h5, .intro-content h6 {
                  line-height: ${quoteIntroLineHeight} !important;
                  color: ${quoteTextColor} !important;
                  margin-top: 0 !important;
                  margin-bottom: 0 !important;
                  background-color: transparent !important;
              }
              
              .payment-terms {
                  font-size: ${quoteSummaryFontSize}px;
                  line-height: ${quoteSummaryLineHeight};
                  color: ${quoteTextColor};
                  padding: 10px 0;
              }

              .payment-terms *, .payment-terms p, .payment-terms span, .payment-terms div, .payment-terms li, .payment-terms strong, .payment-terms b, .payment-terms u, .payment-terms em, .payment-terms a, .payment-terms h1, .payment-terms h2, .payment-terms h3, .payment-terms h4, .payment-terms h5, .payment-terms h6 {
                  line-height: ${quoteSummaryLineHeight} !important;
                  color: ${quoteTextColor} !important;
                  margin-top: 0 !important;
                  margin-bottom: 0 !important;
              }

              .event-notes {
                  font-size: ${quoteBodyFontSize}px;
                  color: ${quoteTextColor};
                  padding: 10px 0;
              }
              
              table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
              th, td { padding: 8px 10px; text-align: right; vertical-align: top; font-size: ${quoteBodyFontSize}px; }
              th { background-color: rgba(248,248,248,0.95); font-weight: 600; }
              
              .services-table td { border-bottom: 1px solid #eee; padding: 10px; vertical-align: middle; }
              .services-table tr:last-child td { border-bottom: none; }
              
              .service-price { text-align: left; font-weight: 600; white-space: nowrap; font-size: calc(${quoteBodyFontSize}px * 0.95); }
              .vat-included { font-size: calc(${quoteBodyFontSize}px * 0.75); font-weight: normal; color: #777; }
              .total-with-vat { font-weight: 700; color: #8B0000; margin-top: 5px; }
              
              .service-name { font-weight: 600; margin-bottom: 3px; font-size: ${quoteBodyFontSize}px; }
              .service-desc { font-size: calc(${quoteBodyFontSize}px * 0.9); color: #555; text-align: right; padding-right: 15px; }
              .service-desc > * { margin: 0; padding: 0; }
              .client-note { font-size: calc(${quoteBodyFontSize}px * 0.9); font-style: italic; color: #777; margin-top: 3px; }
              
              .summary-table td { border-bottom: none; padding: 6px 0; font-size: ${quoteSummaryFontSize}px; line-height: ${quoteSummaryLineHeight}; }
              .summary-table .label { font-weight: 600; text-align: right; }
              .summary-table .value { text-align: left; white-space: nowrap; }
              .summary-table .total .label, .summary-table .total .value { 
                  font-weight: 700; 
                  font-size: calc(${quoteTitleFontSize}px * 0.9); 
                  color: #8B0000; 
                  padding-top: 10px; 
                  border-top: 2px solid #8B0000; 
              }
              
              .line-through { text-decoration: line-through; color: #888; }
              
              .footer { text-align: center; padding: 15px; font-size: calc(${quoteBodyFontSize}px * 0.8); color: #666; border-top: 1px solid #eee; margin-top: 20px; }
          </style>
      </head>
      <body>
          <div class="page-content">
              ${!quoteHideLogo ? `
              <div class="header">
                  ${appSettings.company_logo_url ? `<img src="${appSettings.company_logo_url}" alt="${appSettings.company_name || 'לוגו'}">` : ''}
              </div>` : ''}
              <div class="date">תאריך הפקה: ${formatDate(new Date())}</div>
              
              ${eventDetailsHtml}

              ${(introTemplate && includeIntro) ? `
              <div class="section">
                  <div class="intro-content">${introTemplate.content}</div>
              </div>` : ''}

              ${servicesHtml}
              
              ${notesHtml}

              <div class="section summary-section" style="margin-top: 50px;">
                  <h2 class="section-title">סיכום כספי</h2>
                  <table class="summary-table">
                      ${event.all_inclusive ? `
                      <tr><td class="label">מחיר חבילה (לפני מע"מ):</td><td class="value">₪${baseTotalWithoutDiscount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td></tr>
                      ` : `
                      <tr><td class="label">סה"כ לפני מע"מ:</td><td class="value">₪${baseTotalWithoutDiscount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td></tr>
                      `}
                      <tr><td class="label">מע"מ (18%):</td><td class="value">₪${vatAmount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td></tr>
                      <tr><td class="label">סה"כ כולל מע"מ:</td><td class="value">₪${totalCostWithVat.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td></tr>
                      ${eventDiscountAmount > 0 ? `
                      <tr><td class="label" style="color: #ef4444;">הנחה:</td><td class="value" style="color: #ef4444;">- ₪${eventDiscountAmount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td></tr>
                      ` : ''}
                      <tr class="total">
                          <td class="label">סה"כ לתשלום:</td>
                          <td class="value">₪${finalTotal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                      </tr>
                      <tr>
                          <td class="label">שולם:</td>
                          <td class="value">₪${totalPaid.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                      </tr>
                      <tr class="total">
                          <td class="label">יתרה לתשלום:</td>
                          <td class="value">₪${(finalTotal - totalPaid).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                      </tr>
                  </table>
              </div>

              ${(paymentTemplate && includePaymentTerms) ? `
              <div class="section payment-section" style="margin-top: 50px;">
                  <h2 class="section-title">תנאי תשלום</h2>
                  <div class="payment-terms">${paymentTemplate.content}</div>
              </div>` : ''}
              
              ${quoteShowFooter ? `
              <div class="footer">
                  <div>${quoteFooterText}</div>
              </div>
              ` : ''}
          </div>
      </body>
      </html>
    `;
    
    return Response.json({ html: html });

  } catch (error) {
    console.error('Error in generateQuote:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});