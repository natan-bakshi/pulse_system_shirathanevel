import { secrets } from "base44:runtime";

// לסביבת ה-QA נדרש APIKEY נפרד לחלוטין מסביבת האמת (חשבון QA נפרד ב-Invoice4U).
// אם עדיין לא הוגדר מפתח QA - נופלים חזרה למפתח הרגיל כדי לא לשבור את הקיים.
export function invoice4uToken(environment) {
  if (environment === "qa") {
    return secrets.get("INVOICE4U_API_TOKEN_QA") || secrets.get("INVOICE4U_API_TOKEN");
  }
  return secrets.get("INVOICE4U_API_TOKEN");
}

export const invoice4uUrls = {
  qa: "https://apiqa.invoice4u.co.il/Services/ApiService.svc",
  production: "https://api.invoice4u.co.il/Services/ApiService.svc"
};

export async function invoice4uRequest(environment, endpoint, body) {
  const response = await fetch(`${invoice4uUrls[environment] || invoice4uUrls.qa}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.Message || "שגיאה בתקשורת עם Invoice4U");
  // ה-REST של Invoice4U עוטף את התוצאה במפתח "d" - מחזירים את התוכן עצמו.
  return data && typeof data === "object" && "d" in data ? data.d : data;
}

// קבלה ב-Invoice4U חייבת להיות מקושרת ללקוח קיים (לא "לקוח מזדמן"),
// לכן מאתרים לקוח לפי שם ואם אינו קיים - יוצרים אותו.
export async function invoice4uFindOrCreateCustomer(environment, token, customer) {
  const name = customer.name;
  const found = await invoice4uRequest(environment, "GetCustomers", { token, cust: { Name: name, Active: true } });
  const existing = Array.isArray(found?.Response) ? found.Response.find((item) => item?.Name === name) : null;
  if (existing?.ID) return existing.ID;

  const created = await invoice4uRequest(environment, "CreateCustomer", {
    token,
    cu: { Name: name, Active: true, Email: customer.email || "", Mobile: customer.phone || "", Identifier: customer.identifier || "" }
  });
  const errorMessage = invoice4uErrors(created);
  if (errorMessage) throw new Error(errorMessage);
  if (!created?.ID) throw new Error("לא ניתן ליצור לקוח ב-Invoice4U");
  return created.ID;
}

export function invoice4uErrors(result) {
  const errors = result?.Errors || [];
  return errors.length ? errors.map((item) => item.Error || item.Message).filter(Boolean).join(", ") : "";
}