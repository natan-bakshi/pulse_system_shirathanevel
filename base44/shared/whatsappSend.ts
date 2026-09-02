// שליחת הודעת וואטסאפ דרך Green API - מודול משותף לפונקציות backend.
export function normalizeIsraeliPhone(phone: string) {
  let clean = String(phone || "").replace(/[^0-9]/g, "");
  if (clean.startsWith("05")) clean = "972" + clean.substring(1);
  else if (clean.length === 9 && clean.startsWith("5")) clean = "972" + clean;
  return clean;
}

export async function sendWhatsAppText(phone: string, message: string) {
  const instanceId = Deno.env.get("GREEN_API_INSTANCE_ID");
  const token = Deno.env.get("GREEN_API_TOKEN");
  if (!instanceId || !token) throw new Error("חסרים פרטי חיבור לוואטסאפ");
  const response = await fetch(`https://api.green-api.com/waInstance${instanceId}/sendMessage/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId: `${normalizeIsraeliPhone(phone)}@c.us`, message })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error || "שליחת הוואטסאפ נכשלה");
  return data;
}