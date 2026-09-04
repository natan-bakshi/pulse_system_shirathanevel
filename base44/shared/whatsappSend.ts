// שליחת הודעות וואטסאפ דרך Green API - מודול משותף יחיד לכל פונקציות ה-backend.
// אין להחזיר לקוח את תשובת Green API המלאה, ואין לרשום ללוג טוקן/מספר/תוכן/קישור חתום.
import { sanitizeText, LIMITS } from "./notificationValidation.ts";

const GREEN_API_BASE = "https://api.green-api.com";
const REQUEST_TIMEOUT_MS = 15000;

/**
 * נרמול מספר טלפון בצד השרת: מספר ישראלי מקומי או E.164.
 * מחזיר ספרות בלבד, או '' אם המספר אינו תקין (8-15 ספרות).
 */
export function normalizeIsraeliPhone(phone) {
  let clean = String(phone || "").replace(/[^0-9]/g, "");
  if (clean.startsWith("00")) clean = clean.substring(2);
  if (clean.startsWith("05")) clean = "972" + clean.substring(1);
  else if (clean.length === 9 && clean.startsWith("5")) clean = "972" + clean;
  if (clean.length < 8 || clean.length > 15) return "";
  return clean;
}

/**
 * בונה chatId בצד השרת מהמספר המאומת. הלקוח לא מעביר chatId.
 */
export function toChatId(phone) {
  const normalized = normalizeIsraeliPhone(phone);
  return normalized ? `${normalized}@c.us` : "";
}

export function sanitizeMessage(message) {
  return sanitizeText(message, LIMITS.message);
}

export function sanitizeCaption(caption) {
  return sanitizeText(caption, LIMITS.caption);
}

/**
 * שם קובץ נקי מתווי path ובקרה.
 */
export function sanitizeFileName(name) {
  const cleaned = sanitizeText(name, LIMITS.fileName)
    .replace(/[\\/]/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/[<>:"|?*]/g, "");
  return cleaned || "file";
}

function getCredentials() {
  const instanceId = Deno.env.get("GREEN_API_INSTANCE_ID");
  const token = Deno.env.get("GREEN_API_TOKEN");
  if (!instanceId || !token) throw new Error("WhatsApp configuration error");
  return { instanceId, token };
}

async function callGreenApi(method, body) {
  const { instanceId, token } = getCredentials();
  let response;
  try {
    response = await fetch(`${GREEN_API_BASE}/waInstance${instanceId}/${method}/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (e) {
    console.error(`[WhatsApp] transport failure on ${method}: ${e?.name || 'error'}`);
    throw new Error("WhatsApp request failed");
  }

  // תגובה שאינה JSON מטופלת בבטחה ואינה נחשפת ללקוח.
  let data = null;
  try {
    const raw = await response.text();
    data = raw ? JSON.parse(raw) : null;
  } catch (e) {
    data = null;
  }

  if (!response.ok) {
    console.error(`[WhatsApp] ${method} rejected with status ${response.status}`);
    const error = new Error("WhatsApp send failed");
    error.errorCode = response.status;
    throw error;
  }

  const messageId = data && typeof data === 'object' ? (data.idMessage || '') : '';
  console.log(`[WhatsApp] ${method} accepted (messageId present: ${messageId ? 'yes' : 'no'})`);
  return { success: true, messageId, idMessage: messageId };
}

/**
 * שליחת הודעת טקסט לפי מספר טלפון (נרמול בצד השרת).
 */
export async function sendWhatsAppText(phone, message) {
  const chatId = toChatId(phone);
  if (!chatId) throw new Error("Invalid WhatsApp phone number");
  const safeMessage = sanitizeMessage(message);
  if (!safeMessage) throw new Error("Empty WhatsApp message");
  return await callGreenApi("sendMessage", { chatId, message: safeMessage });
}

/**
 * שליחת הודעה ל-chatId שנבנה בצד השרת (כולל קבוצות שנבנו מהמערכת, לא מהלקוח).
 */
export async function sendWhatsAppToChat(chatId, message) {
  const safeChatId = sanitizeText(chatId, 80);
  if (!/^[0-9A-Za-z_-]+@(c|g)\.us$/.test(safeChatId)) throw new Error("Invalid WhatsApp target");
  const safeMessage = sanitizeMessage(message);
  if (!safeMessage) throw new Error("Empty WhatsApp message");
  return await callGreenApi("sendMessage", { chatId: safeChatId, message: safeMessage });
}

/**
 * שליחת קובץ. ה-URL נוצר בצד השרת בלבד (קישור חתום), ונבדק שוב כאן.
 */
export async function sendWhatsAppFileByUrl(phone, fileUrl, fileName, caption) {
  const chatId = toChatId(phone);
  if (!chatId) throw new Error("Invalid WhatsApp phone number");

  let parsed;
  try {
    parsed = new URL(String(fileUrl || ''));
  } catch (e) {
    throw new Error("Invalid file url");
  }
  if (parsed.protocol !== 'https:') throw new Error("Invalid file url");
  if (parsed.username || parsed.password) throw new Error("Invalid file url");

  return await callGreenApi("sendFileByUrl", {
    chatId,
    urlFile: parsed.href,
    fileName: sanitizeFileName(fileName),
    caption: sanitizeCaption(caption)
  });
}