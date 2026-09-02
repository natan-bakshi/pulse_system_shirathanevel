import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { invoice4uErrors, invoice4uRequest, invoice4uToken } from "../../shared/invoice4uClient.ts";

// שליפת קישורי ה-PDF (מקור והעתק נאמן למקור) של מסמך מ-Invoice4U ושמירתם על הרשומה.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

    const { documentId } = await req.json();
    if (!documentId) return Response.json({ error: "חסר מזהה מסמך" }, { status: 400 });

    const document = await base44.asServiceRole.entities.FinancialDocument.get(documentId);
    if (!document?.invoice4u_id) return Response.json({ error: "למסמך זה אין מזהה ב-Invoice4U" }, { status: 400 });

    const settings = await base44.asServiceRole.entities.AppSettings.list();
    const config = Object.fromEntries(settings.map((item) => [item.setting_key, item.setting_value]));
    const environment = config.invoice4u_env === "production" ? "production" : "qa";

    const response = await invoice4uRequest(environment, "GetDocument", {
      token: invoice4uToken(environment),
      docId: document.invoice4u_id
    });
    const result = response.GetDocumentResult || response;
    const errorMessage = invoice4uErrors(result);
    if (errorMessage) return Response.json({ error: errorMessage }, { status: 400 });

    const original = result.PrintOriginalPDFLink || "";
    const certified = result.PrintCertifiedCopyPDFLink || "";
    if (!original && !certified) return Response.json({ error: "לא הוחזר קישור PDF עבור מסמך זה" }, { status: 400 });

    await base44.asServiceRole.entities.FinancialDocument.update(document.id, {
      pdf_original_url: original || document.pdf_original_url || "",
      pdf_certified_url: certified || document.pdf_certified_url || ""
    });
    return Response.json({ pdf_original_url: original, pdf_certified_url: certified });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}