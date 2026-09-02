// לוגיקת חישוב כספי לאירוע בצד השרת - מקבילה ל-src/components/utils/eventFinancials.jsx
// נדרשת כדי לאמת סכומי סליקה ולבנות שורות מסמך ללא הסתמכות על הדפדפן.

const num = (value) => {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const round2 = (value) => Math.round(value * 100) / 100;

function convert(amount, from, to, usdIlsRate) {
  if (!from || from === to) return amount;
  if (from === "USD" && to === "ILS") return amount * usdIlsRate;
  if (from === "ILS" && to === "USD") return amount / usdIlsRate;
  return amount;
}

// מחזיר את הסכום הכולל, הסכום ששולם והיתרה - במטבע האירוע.
export function calculateEventBalance(event, services = [], payments = [], vatRate = 0.18, usdIlsRate = 3.6) {
  const eventCurrency = event.primary_currency || "ILS";
  const toEventCurrency = (amount, currency) => convert(amount, currency || eventCurrency, eventCurrency, usdIlsRate);
  let totalWithoutVat = 0;
  const allInclusivePrice = num(event.all_inclusive_price);
  const totalOverride = num(event.total_override);

  if ((event.all_inclusive === true || event.all_inclusive === "true") && allInclusivePrice > 0) {
    totalWithoutVat = event.all_inclusive_includes_vat ? allInclusivePrice / (1 + vatRate) : allInclusivePrice;
  } else if (totalOverride !== 0) {
    totalWithoutVat = event.total_override_includes_vat !== false ? totalOverride / (1 + vatRate) : totalOverride;
  } else {
    const legacyPackages = new Set();
    totalWithoutVat = services.reduce((sum, service) => {
      if (service.is_external) return sum;
      const quantity = num(service.quantity) || 1;
      if (service.is_package_main_item) {
        let total = num(service.custom_price) * quantity;
        if (service.includes_vat) total = total / (1 + vatRate);
        return sum + toEventCurrency(total, service.currency);
      }
      if (service.parent_package_event_service_id) return sum;
      if (service.package_id) {
        if (legacyPackages.has(service.package_id)) return sum;
        legacyPackages.add(service.package_id);
        let total = num(service.package_price);
        if (service.package_includes_vat) total = total / (1 + vatRate);
        return sum + toEventCurrency(total, service.currency);
      }
      let total = num(service.custom_price) * quantity;
      if (service.includes_vat) total = total / (1 + vatRate);
      return sum + toEventCurrency(total, service.currency);
    }, 0);
  }

  const guestCount = num(event.guest_count);
  const pricePerGuest = num(event.price_per_guest);
  if ((event.is_price_per_guest === true || event.is_price_per_guest === "true") && pricePerGuest > 0 && guestCount > 0) {
    totalWithoutVat = pricePerGuest * guestCount;
  }

  const rawDiscount = num(event.discount_amount);
  const discountAmount = (event.discount_type || "fixed") === "per_guest" && guestCount > 0 ? rawDiscount * guestCount : rawDiscount;
  const baseForVat = event.discount_before_vat ? Math.max(0, totalWithoutVat - discountAmount) : totalWithoutVat;
  const totalWithVat = baseForVat + baseForVat * vatRate;
  const finalTotal = event.discount_before_vat ? totalWithVat : Math.max(0, totalWithVat - discountAmount);

  // רק תשלומים שהושלמו נחשבים כשולמו - סליקות ממתינות או שנכשלו אינן מקטינות את היתרה.
  const totalPaid = payments.reduce((sum, payment) => {
    if (payment.payment_status && payment.payment_status !== "completed") return sum;
    return sum + toEventCurrency(num(payment.amount), payment.currency);
  }, 0);

  return { currency: eventCurrency, discountAmount, finalTotal: round2(finalTotal), totalPaid: round2(totalPaid), balance: round2(finalTotal - totalPaid) };
}

// עמלת סליקה לפי הגדרות המערכת - אחוזים או סכום קבוע.
export function calculateProcessingFee(config, amount, language = "he") {
  if (config.processing_fee_enabled !== "true") return { amount: 0, label: "" };
  const value = num(config.processing_fee_value);
  if (value <= 0) return { amount: 0, label: "" };
  const fee = config.processing_fee_type === "fixed" ? value : amount * value / 100;
  const label = language === "en"
    ? (config.processing_fee_label_en || "Processing fee")
    : (config.processing_fee_label || "עמלת סליקה");
  return { amount: round2(fee), label };
}

// סכום מקדמה מוצע - הגבוה מבין הסכום המינימלי המוגדר לאחוז מהיתרה שהוגדר בהגדרות (ברירת מחדל 20%).
export function calculateAdvanceAmount(config, balance) {
  const configured = num(config.default_advance_amount);
  const rawPercent = config.default_advance_percent;
  const percent = rawPercent === undefined || rawPercent === null || rawPercent === "" ? 20 : Math.max(0, num(rawPercent));
  return round2(Math.min(balance, Math.max(configured, balance * percent / 100)));
}

// בונה שורות מסמך. פירוט מלא רק כשנסלק כל הסכום, אחרת שורה כללית -
// כדי שסך השורות יהיה תמיד זהה לסכום שנסלק בפועל.
export function buildDocumentItems({ event, services = [], amount, fee, itemized, financials, vatRate = 0.18, usdIlsRate = 3.6, language = "he" }) {
  const items = [];
  const eventCurrency = event.primary_currency || "ILS";
  const canItemize = itemized && Math.abs(amount - financials.finalTotal) < 0.01 && financials.totalPaid === 0;

  if (canItemize) {
    const legacyPackages = new Set();
    services.forEach((service) => {
      if (service.is_external || service.parent_package_event_service_id) return;
      const quantity = num(service.quantity) || 1;
      if (service.is_package_main_item) {
        let price = num(service.custom_price);
        if (service.includes_vat) price = price / (1 + vatRate);
        items.push({ name: service.package_name || service.service_name || "חבילת הפקה", quantity, price: round2(convert(price, service.currency || eventCurrency, eventCurrency, usdIlsRate)) });
        return;
      }
      if (service.package_id) {
        if (legacyPackages.has(service.package_id)) return;
        legacyPackages.add(service.package_id);
        let price = num(service.package_price);
        if (service.package_includes_vat) price = price / (1 + vatRate);
        items.push({ name: service.package_name || "חבילת הפקה", quantity: 1, price: round2(convert(price, service.currency || eventCurrency, eventCurrency, usdIlsRate)) });
        return;
      }
      let price = num(service.custom_price);
      if (service.includes_vat) price = price / (1 + vatRate);
      if (price <= 0) return;
      items.push({ name: service.service_name || "שירות", quantity, price: round2(convert(price, service.currency || eventCurrency, eventCurrency, usdIlsRate)) });
    });
    if (financials.discountAmount > 0) items.push({ name: event.discount_reason || (language === "en" ? "Discount" : "הנחה"), quantity: 1, price: -round2(financials.discountAmount / (1 + vatRate)) });
  }

  if (!items.length) items.push({ name: language === "en" ? `Payment for ${event.event_name}` : `תשלום עבור ${event.event_name}`, quantity: 1, price: round2(amount / (1 + vatRate)) });
  if (fee?.amount > 0) items.push({ name: fee.label, quantity: 1, price: round2(fee.amount / (1 + vatRate)) });
  return items;
}

// Invoice4U מקבל את שורות המסמך כמחרוזות מופרדות בצינור, שדה לכל מאפיין.
export function itemsToPipedFields(items, vatPercent) {
  return {
    DocItemName: items.map((item) => item.name).join("|"),
    DocItemQuantity: items.map((item) => item.quantity).join("|"),
    DocItemPrice: items.map((item) => item.price).join("|"),
    DocItemTaxRate: items.map(() => vatPercent).join("|")
  };
}