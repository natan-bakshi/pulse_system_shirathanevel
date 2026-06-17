import { convertCurrency } from './currencyUtils';

export const calculateEventFinancials = (event, services = [], payments = [], vatRate = 0.18, exchangeRate = 3.6) => {
    
    if (!event) {
        return {
            totalCostWithoutVat: 0,
            vatAmount: 0,
            totalCostWithVat: 0,
            discountAmount: 0,
            finalTotal: 0,
            totalPaid: 0,
            balance: 0
        };
    }

    const eventCurrency = event.primary_currency || 'ILS';

    // Helper to safely parse numbers
    const safeFloat = (val) => {
        if (val === null || val === undefined || val === '') return 0;
        const num = parseFloat(val);
        return isNaN(num) ? 0 : num;
    };

    // Convert a service price to event currency
    const toEventCurrency = (amount, itemCurrency) => {
        const from = itemCurrency || eventCurrency;
        if (from === eventCurrency) return amount;
        return convertCurrency(amount, from, eventCurrency, exchangeRate);
    };

    let totalCostWithoutVat = 0;
    
    // Check for override/all-inclusive logic
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
        // Sum up services
        const processedLegacyPackages = new Set();

        totalCostWithoutVat = services.reduce((sum, s) => {
            if (s.is_external) return sum;
            const quantity = safeFloat(s.quantity) || 1;
            
            // 1. New Structure: Main Package Item
            if (s.is_package_main_item) {
                 const price = safeFloat(s.custom_price);
                 let itemTotal = price * quantity;
                 if (s.includes_vat) itemTotal = itemTotal / (1 + vatRate);
                 return sum + toEventCurrency(itemTotal, s.currency);
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
                return sum + toEventCurrency(pkgTotal, s.currency);
            }

            // 4. Standalone Service
            const price = safeFloat(s.custom_price);
            let serviceTotal = price * quantity;
            
            if (s.includes_vat) {
                serviceTotal = serviceTotal / (1 + vatRate);
            }
            return sum + toEventCurrency(serviceTotal, s.currency);

        }, 0);
    }

    // --- Price Per Guest logic ---
    // If price_per_guest mode is active, the total is price_per_guest * guest_count
    const isPricePerGuest = event.is_price_per_guest === true || event.is_price_per_guest === 'true';
    const guestCount = safeFloat(event.guest_count) || 0;
    const pricePerGuest = safeFloat(event.price_per_guest);

    if (isPricePerGuest && pricePerGuest > 0 && guestCount > 0) {
        totalCostWithoutVat = pricePerGuest * guestCount;
    }

    // Apply Discount BEFORE VAT if applicable
    // Discount type: "per_guest" means discount_amount is per-person and gets multiplied
    const discountType = event.discount_type || 'fixed';
    const rawDiscount = safeFloat(event.discount_amount);
    let discountAmount = discountType === 'per_guest' && guestCount > 0
        ? rawDiscount * guestCount
        : rawDiscount;
    
    // Ensure we don't have negative base
    let baseForVat = totalCostWithoutVat;
    
    if (event.discount_before_vat) {
        baseForVat = Math.max(0, totalCostWithoutVat - discountAmount);
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
        finalTotal = Math.max(0, totalCostWithVat - discountAmount);
    }

    // Payments - convert each payment to event currency
    const totalPaid = payments.reduce((sum, p) => {
        const amount = safeFloat(p.amount);
        return sum + toEventCurrency(amount, p.currency);
    }, 0);
    const balance = finalTotal - totalPaid;

    // Compute effective price per guest for display
    let effectivePricePerGuest = 0;
    if (isPricePerGuest && guestCount > 0) {
        effectivePricePerGuest = pricePerGuest > 0 ? pricePerGuest : (totalCostWithoutVat / guestCount);
    }

    return {
        totalCostWithoutVat,
        vatAmount,
        totalCostWithVat,
        discountAmount,
        finalTotal,
        totalPaid,
        balance,
        currency: eventCurrency,
        isPricePerGuest,
        effectivePricePerGuest,
        guestCount,
        discountType,
        rawDiscountAmount: rawDiscount
    };
};