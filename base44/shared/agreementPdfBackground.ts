// Load the same public A4 background chosen for quote PDFs.
export async function loadAgreementBackground(config) {
  const raw = config.quote_background_image;
  if (!raw) return null;
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("תמונת הרקע של ההצעה חייבת להיות בקישור HTTPS");
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error("לא ניתן לטעון את תמונת הרקע של ההצעה");
  if (Number(response.headers.get("content-length")) > 8000000) throw new Error("תמונת הרקע גדולה מדי");
  const data = new Uint8Array(await response.arrayBuffer());
  if (data.length > 8000000) throw new Error("תמונת הרקע גדולה מדי");
  const png = data.slice(0, 8).every((v, i) => v === [137, 80, 78, 71, 13, 10, 26, 10][i]);
  const jpeg = data[0] === 255 && data[1] === 216 && data[2] === 255;
  if (!png && !jpeg) throw new Error("יש לבחור רקע בפורמט PNG או JPEG");
  return { data, format: png ? "PNG" : "JPEG" };
}

export function agreementPdfMargins(config) {
  const margin = (value, fallback) => {
    if (value === undefined || value === null || value === "") return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(90, Math.max(12, n)) : fallback;
  };
  return { top: margin(config.quote_margin_top_mm, 20), bottom: margin(config.quote_margin_bottom_mm, 35) };
}