export const calculateEventFinancials = (event, services = [], payments = [], vatRate = 0.18) => {
    
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

    // Helper to safely parse numbers
    const safeFloat = (val) => {
        if (val === null || val === undefined || val === '') return 0;
        const num = parseFloat(val);
        return isNaN(num) ? 0 : num;
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

    // Apply Discount BEFORE VAT if applicable
    let discountAmount = safeFloat(event.discount_amount);
    
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

    // Payments
    const totalPaid = payments.reduce((sum, p) => sum + safeFloat(p.amount), 0);
    const balance = finalTotal - totalPaid;

    return {
        totalCostWithoutVat,
        vatAmount,
        totalCostWithVat,
        discountAmount,
        finalTotal,
        totalPaid,
        balance
    };
};