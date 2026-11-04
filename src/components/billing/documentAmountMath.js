// Currency-safe presentation helpers for the manual billing editor.
// UI accepts both net and gross unit prices; the final Invoice4U payload uses
// gross unit prices with TaxIncluded=true, so a gross amount stays exact.
export const roundDocumentMoney = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
export const itemVatPercent = (item, fallback = 18) =>
  item?.taxRate === "" || item?.taxRate === null || item?.taxRate === undefined
    ? Number(fallback) || 0 : Number(item.taxRate) || 0;
export function itemUnitGross(item, fallback = 18) {
  if (item?.grossPrice !== undefined && item?.grossPrice !== null && item?.grossPrice !== "")
    return roundDocumentMoney(item.grossPrice);
  return roundDocumentMoney((Number(item?.price) || 0) * (1 + itemVatPercent(item, fallback) / 100));
}
export function editDocumentUnitPrice(item, field, value, fallback = 18) {
  const rate = itemVatPercent(item, fallback);
  if (field === "gross") {
    if (value === "") return { ...item, price: "", grossPrice: "", priceSource: "gross" };
    return { ...item, price: roundDocumentMoney(Number(value) / (1 + rate / 100)),
      grossPrice: value, priceSource: "gross" };
  }
  if (value === "") return { ...item, price: "", grossPrice: "", priceSource: "net" };
  return { ...item, price: value,
    grossPrice: roundDocumentMoney(Number(value) * (1 + rate / 100)), priceSource: "net" };
}
export function editDocumentVatRate(item, value, fallback = 18) {
  const changed = { ...item, taxRate: value };
  const valueSource = item?.priceSource === "gross" ? "gross" : "net";
  const current = valueSource === "gross" ? item.grossPrice : item.price;
  return editDocumentUnitPrice(changed, valueSource, current ?? "", fallback);
}
export function totalDocumentGross(items = [], fallback = 18) {
  return roundDocumentMoney(items.reduce((sum, item) =>
    sum + itemUnitGross(item, fallback) * (Number(item.quantity) || 0), 0));
}
export function totalDocumentNet(items = [], fallback = 18) {
  return roundDocumentMoney(items.reduce((sum, item) => {
    const rate = itemVatPercent(item, fallback);
    const lineGross = itemUnitGross(item, fallback) * (Number(item.quantity) || 0);
    return sum + lineGross / (1 + rate / 100);
  }, 0));
}
