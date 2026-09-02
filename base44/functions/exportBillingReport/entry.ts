import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";

// ייצוא דוח כספי לגיליון Google Sheets חדש.
// הסינון והרכבת השורות מתבצעים בממשק, כדי שהגיליון יהיה זהה למוצג על המסך.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

    const { title, rows } = await req.json();
    if (!Array.isArray(rows) || rows.length === 0) return Response.json({ error: "אין נתונים לייצוא" }, { status: 400 });

    const accessToken = await base44.asServiceRole.connectors.getAccessToken("googlesheets");
    const sheetTitle = String(title || "").trim() || `דוח כספי - ${new Date().toLocaleDateString("he-IL")}`;

    const createResponse = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        properties: { title: sheetTitle, locale: "iw_IL" },
        sheets: [{ properties: { title: "דוח כספי", rightToLeft: true } }]
      })
    });
    const spreadsheet = await createResponse.json();
    if (!spreadsheet.spreadsheetId) return Response.json({ error: "לא ניתן ליצור גיליון ב-Google Sheets" }, { status: 500 });

    const spreadsheetId = spreadsheet.spreadsheetId;
    const sheetId = spreadsheet.sheets?.[0]?.properties?.sheetId || 0;

    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A1?valueInputOption=RAW`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: rows })
    });

    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: rows[0].length },
              cell: { userEnteredFormat: { backgroundColor: { red: 0.6, green: 0.11, blue: 0.11 }, textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }, horizontalAlignment: "CENTER" } },
              fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)"
            }
          },
          { autoResizeDimensions: { dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: rows[0].length } } }
        ]
      })
    });

    return Response.json({ spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`, rows: rows.length - 1 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}