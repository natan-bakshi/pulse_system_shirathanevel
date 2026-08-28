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
  return data;
}

export function invoice4uErrors(result) {
  const errors = result?.Errors || [];
  return errors.length ? errors.map((item) => item.Error || item.Message).filter(Boolean).join(", ") : "";
}