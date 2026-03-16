// Currency utility functions

export const CURRENCY_SYMBOLS = { ILS: '₪', USD: '$' };

export function getCurrencySymbol(code) {
  return CURRENCY_SYMBOLS[code] || '₪';
}

export function formatCurrency(amount, currencyCode = 'ILS') {
  const symbol = getCurrencySymbol(currencyCode);
  const formatted = (amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${symbol}${formatted}`;
}

/**
 * Convert amount from one currency to another using exchange rate.
 * @param {number} amount
 * @param {string} fromCurrency - 'ILS' or 'USD'
 * @param {string} toCurrency - 'ILS' or 'USD'
 * @param {number} exchangeRate - USD to ILS rate (e.g. 3.6)
 * @returns {number}
 */
export function convertCurrency(amount, fromCurrency, toCurrency, exchangeRate) {
  if (!amount || fromCurrency === toCurrency || !exchangeRate) return amount || 0;
  
  if (fromCurrency === 'USD' && toCurrency === 'ILS') {
    return amount * exchangeRate;
  }
  if (fromCurrency === 'ILS' && toCurrency === 'USD') {
    return amount / exchangeRate;
  }
  return amount;
}

/**
 * Get the effective currency for a service/payment item.
 * If the item has its own currency set, use it. Otherwise use event's primary currency.
 */
export function getEffectiveCurrency(itemCurrency, eventPrimaryCurrency) {
  return itemCurrency || eventPrimaryCurrency || 'ILS';
}