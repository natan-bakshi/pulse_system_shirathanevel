import { CardError } from "./storedCards.ts";
// A company fallback is a clearing contact only; never overwrite the customer's email.
export function billingEmail(customerEmail, config) {
 const supplied=String(customerEmail||"").trim();
 const email=supplied||String(config.billing_fallback_email||"").trim();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  throw new CardError(supplied?"כתובת המייל של הלקוח אינה תקינה":"נדרש מייל ללקוח או מייל חברה חלופי בהגדרות התשלומים",400);
 return email;
}
