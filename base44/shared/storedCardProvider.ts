import { secrets } from "base44:runtime";
import { CardError, money } from "./storedCards.ts";

export const cardAppUrl = "https://pulse-system.base44.app";
export function providerAccess(config, environment = config.invoice4u_env === "production" ? "production" : "qa") {
  if (!["qa", "production"].includes(environment)) throw new CardError("סביבת סליקה לא תקינה");
  if (environment === "production" && secrets.get("INVOICE4U_STORED_CARDS_PRODUCTION_READY") !== "true")
    throw new CardError("סליקה בכרטיס שמור בייצור ממתינה לאימות האינטגרציה", 503);
  const key = secrets.get(environment === "qa" ? "INVOICE4U_API_TOKEN_QA" : "INVOICE4U_API_TOKEN");
  if (!key) throw new CardError(environment === "qa" ? "חסר מפתח QA נפרד. לא נעשה שימוש במפתח הייצור." : "חסר מפתח סליקה", 503);
  const company = Number(config.invoice4u_clearing_company_type);
  if (![6, 7, 12, 15].includes(company)) throw new CardError("יש להגדיר חברת סליקה נתמכת");
  return { environment, key, company };
}
export async function providerCall(access, endpoint, body) {
  const host = access.environment === "qa" ? "apiqa" : "api";
  const response = await fetch("https://" + host + ".invoice4u.co.il/Services/ApiService.svc/" + endpoint, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(25000)
  });
  if (!response.ok) throw new CardError("לא התקבלה תשובה תקינה מספק הסליקה", 502);
  const wrapped = await response.json();
  const data = wrapped?.d ?? wrapped;
  return data?.[endpoint + "Result"] ?? data;
}
export function hasErrors(result) {
  return Array.isArray(result?.Errors) ? result.Errors.length > 0 : !!result?.Errors;
}
export function providerFailure(result) {
  const errors = Array.isArray(result?.Errors) ? result.Errors : [];
  const code = String(errors[0]?.ErrorCode ?? errors[0]?.Id ?? errors[0]?.ID ?? "provider_declined");
  return { code, message: code === "309" ? "שירות הטוקנים אינו מופעל במסוף הסליקה" : code === "304" ? "לא נמצא כרטיס תקף אצל ספק הסליקה" : "הפעולה נדחתה על ידי ספק הסליקה" };
}
export async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}
export function isTrue(value) { return value === true || String(value).toLowerCase() === "true"; }
export function matchClearingLog(log, expected) {
  if (!isTrue(log.IsSuccess) || Number(log.LogType) !== 2) return false;
  if (!expected.paymentId && !expected.traceId) return false;
  if (expected.paymentId && String(log.PaymentId) !== String(expected.paymentId)) return false;
  if (expected.traceId && String(log.ClearingTraceId) !== String(expected.traceId)) return false;
  if (Number(log.TransactionType) !== expected.type) return false;
  if (log.Amount === null || log.Amount === undefined || !Number.isFinite(Number(log.Amount))) return false;
  if (money(log.Amount) !== money(expected.amount)) return false;
  if (expected.currency && Number(log.Currency) !== ({ ILS: 1, USD: 2, EUR: 3 }[expected.currency])) return false;
  return true;
}
export async function verifyLog(access, expected, createdAt) {
  const result = await providerCall(access, "GetClearingLogByParams", {
    token: access.key, searchParams: {
      FromDate: new Date(new Date(createdAt).getTime() - 300000).toISOString(),
      ToDate: new Date(Date.now() + 300000).toISOString(), IsSuccess: true
    }
  });
  const logs = Array.isArray(result) ? result : (result?.Response || result?.ClearingLogs || []);
  if (!Array.isArray(logs)) throw new CardError("לא ניתן לאמת את תוצאת הספק", 503);
  const found = logs.filter(log => matchClearingLog(log, expected));
  if (found.length !== 1) throw new CardError("ממתין לאימות תוצאת הסליקה מול הספק", 409);
  return found[0];
}
