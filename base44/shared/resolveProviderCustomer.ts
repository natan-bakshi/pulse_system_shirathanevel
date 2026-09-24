import { CardError } from "./storedCards.ts";
import { providerCall, hasErrors, providerFailure } from "./storedCardProvider.ts";

const value = v => typeof v === "string" ? v.trim() : "";

// Retry only customer lookup, never creation, capture or a monetary request.
export async function resolveProviderCustomer(access, providerId) {
  const id = Number(providerId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new CardError("מזהה לקוח לא תקין אצל ספק הסליקה");
  for (let attempt = 0; attempt < 3; attempt++) {
    const customer = await providerCall(access, "GetCustomerById", { token: access.key, custId: id });
    if (!hasErrors(customer) && Number(customer?.ID) === id && value(customer?.Name)) {
      if (customer.Active === false) throw new CardError("הלקוח אינו פעיל אצל ספק הסליקה");
      return { Name: value(customer.Name), Email: value(customer.Email), Cell: value(customer.Cell), Phone: value(customer.Phone) };
    }
    const errors = Array.isArray(customer?.Errors) ? customer.Errors : [];
    const notFound = errors.length > 0 && errors.every(error => ["37", "136"].includes(providerFailure({ Errors: [error] }).code));
    if (hasErrors(customer) && !notFound) throw new CardError("אימות הלקוח ב-Invoice4U נדחה; בקשת שמירת הכרטיס לא נשלחה");
    if (!hasErrors(customer) && Number(customer?.ID) > 0 && Number(customer.ID) !== id)
      throw new CardError("הספק החזיר לקוח אחר; בקשת שמירת הכרטיס נעצרה");
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new CardError("הלקוח נוצר אך טרם ניתן לאמת את פרטיו ב-Invoice4U; בקשת שמירת הכרטיס לא נשלחה", 409);
}

export function providerCustomerFields(customer) {
  const name = value(customer.Name), phone = value(customer.Cell) || value(customer.Phone), email = value(customer.Email);
  return { ...(name ? { FullName: name } : {}), ...(phone ? { Phone: phone } : {}), ...(email ? { Email: email } : {}) };
}