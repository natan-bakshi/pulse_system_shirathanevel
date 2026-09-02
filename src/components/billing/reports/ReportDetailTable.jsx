import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// טבלת הפירוט המלאה של המסמכים המסוננים (שורת הכותרת מגיעה מ-buildReportRows).
export default function ReportDetailTable({ rows }) {
  const [headers, ...dataRows] = rows;

  return (
    <Card className="bg-white/95">
      <CardHeader className="pb-2"><CardTitle className="text-base">פירוט מסמכים ({dataRows.length})</CardTitle></CardHeader>
      <CardContent>
        {dataRows.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">אין מסמכים התואמים לסינון</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-right text-xs text-gray-500">
                  {headers.map((header) => <th key={header} className="whitespace-nowrap px-2 py-2 font-medium">{header}</th>)}
                </tr>
              </thead>
              <tbody>
                {dataRows.map((row, index) => (
                  <tr key={`${row[2]}-${index}`} className="border-b border-gray-100 hover:bg-gray-50">
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className="whitespace-nowrap px-2 py-2">
                        {typeof cell === "number" ? cell.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}