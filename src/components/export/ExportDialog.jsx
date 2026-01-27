import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, FileText, Table } from "lucide-react";

export default function ExportDialog({ 
  isOpen, 
  onClose, 
  data, 
  columns, 
  title, 
  exportTypes = ['csv', 'pdf', 'html'] 
}) {
  const [selectedRows, setSelectedRows] = useState(new Set(data.map((_, index) => index)));
  const [selectedColumns, setSelectedColumns] = useState(new Set(columns.map(col => col.key)));
  const [exportType, setExportType] = useState('csv');

  const handleRowToggle = (index) => {
    const newSelected = new Set(selectedRows);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedRows(newSelected);
  };

  const handleColumnToggle = (columnKey) => {
    const newSelected = new Set(selectedColumns);
    if (newSelected.has(columnKey)) {
      newSelected.delete(columnKey);
    } else {
      newSelected.add(columnKey);
    }
    setSelectedColumns(newSelected);
  };

  const handleSelectAllRows = () => {
    if (selectedRows.size === data.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(data.map((_, index) => index)));
    }
  };

  const handleSelectAllColumns = () => {
    if (selectedColumns.size === columns.length) {
      setSelectedColumns(new Set());
    } else {
      setSelectedColumns(new Set(columns.map(col => col.key)));
    }
  };

  const generateCSV = () => {
    const selectedColumnsArray = columns.filter(col => selectedColumns.has(col.key));
    const selectedDataArray = data.filter((_, index) => selectedRows.has(index));

    // כותרות
    const csvHeaders = selectedColumnsArray.map(col => col.title).join(',');
    
    // נתונים
    const csvRows = selectedDataArray.map(row => 
      selectedColumnsArray.map(col => {
        const value = col.render ? col.render(row[col.key], row) : row[col.key];
        // מנקה מ-HTML tags ומוסיף גרשיים אם יש פסיקים
        const cleanValue = typeof value === 'string' ? value.replace(/<[^>]*>/g, '') : (value || '');
        return `"${cleanValue}"`;
      }).join(',')
    );

    // הוספת BOM לקידוד UTF-8 נכון
    const BOM = '\uFEFF';
    return BOM + [csvHeaders, ...csvRows].join('\n');
  };

  const generateHTML = () => {
    const selectedColumnsArray = columns.filter(col => selectedColumns.has(col.key));
    const selectedDataArray = data.filter((_, index) => selectedRows.has(index));

    const htmlContent = `
      <!DOCTYPE html>
      <html dir="rtl" lang="he">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Assistant:wght@400;700&display=swap');
          body { 
            font-family: 'Assistant', sans-serif; 
            direction: rtl; 
            margin: 20px;
            background-color: #f9f9f9;
          }
          .container {
            max-width: 1200px;
            margin: 0 auto;
            background-color: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          }
          table { 
            border-collapse: collapse; 
            width: 100%; 
            margin: 20px 0;
            font-size: 14px;
          }
          th, td { 
            border: 1px solid #ddd; 
            padding: 12px 8px; 
            text-align: right; 
            vertical-align: top;
          }
          th { 
            background-color: #f8f9fa; 
            font-weight: bold;
            color: #333;
          }
          h1 { 
            color: #333; 
            text-align: center; 
            margin-bottom: 30px;
            font-size: 24px;
          }
          tr:nth-child(even) {
            background-color: #f9f9f9;
          }
          .export-date {
            text-align: center;
            color: #666;
            margin-bottom: 20px;
            font-size: 12px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>${title}</h1>
          <div class="export-date">תאריך ייצוא: ${new Date().toLocaleDateString('he-IL')}</div>
          <table>
            <thead>
              <tr>
                ${selectedColumnsArray.map(col => `<th>${col.title}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${selectedDataArray.map(row => 
                `<tr>${selectedColumnsArray.map(col => {
                  const value = col.render ? col.render(row[col.key], row) : row[col.key];
                  const cleanValue = String(value || '').replace(/<[^>]*>/g, '');
                  return `<td>${cleanValue}</td>`;
                }).join('')}</tr>`
              ).join('')}
            </tbody>
          </table>
        </div>
      </body>
      </html>
    `;
    return htmlContent;
  };

  const handleExport = () => {
    let content, filename, mimeType;

    switch (exportType) {
      case 'csv':
        content = generateCSV();
        filename = `${title.replace(/\s+/g, '_')}.csv`;
        mimeType = 'text/csv;charset=utf-8;';
        break;
      case 'html':
        content = generateHTML();
        filename = `${title.replace(/\s+/g, '_')}.html`;
        mimeType = 'text/html;charset=utf-8;';
        break;
      case 'pdf':
        // לPDF נשתמש בHTML ונמיר אותו
        const htmlContent = generateHTML();
        const newWindow = window.open();
        newWindow.document.write(htmlContent);
        newWindow.document.close();
        
        // This relies on browser's print to PDF functionality
        setTimeout(() => {
          newWindow.print();
        }, 500);

        onClose();
        return;
    }

    // יצירת הקובץ והורדה עם קידוד UTF-8 נכון
    const blob = new Blob([content], { type: mimeType });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            ייצוא {title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* בחירת סוג ייצוא */}
          <div>
            <Label>סוג ייצוא</Label>
            <Select value={exportType} onValueChange={setExportType}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {exportTypes.includes('csv') && <SelectItem value="csv">CSV (אקסל)</SelectItem>}
                {exportTypes.includes('html') && <SelectItem value="html">HTML</SelectItem>}
                {exportTypes.includes('pdf') && <SelectItem value="pdf">PDF (הדפסה)</SelectItem>}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* בחירת שורות */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <Label>בחירת שורות ({selectedRows.size}/{data.length})</Label>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleSelectAllRows}
                >
                  {selectedRows.size === data.length ? 'בטל הכל' : 'בחר הכל'}
                </Button>
              </div>
              <div className="max-h-48 overflow-y-auto border rounded p-2 space-y-2">
                {data.map((item, index) => (
                  <div key={index} className="flex items-center space-x-2 space-x-reverse">
                    <Checkbox
                      checked={selectedRows.has(index)}
                      onCheckedChange={() => handleRowToggle(index)}
                    />
                    <Label className="text-sm truncate">
                      {item.name || item.event_name || item.family_name || `שורה ${index + 1}`}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            {/* בחירת עמודות */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <Label>בחירת עמודות ({selectedColumns.size}/{columns.length})</Label>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleSelectAllColumns}
                >
                  {selectedColumns.size === columns.length ? 'בטל הכל' : 'בחר הכל'}
                </Button>
              </div>
              <div className="max-h-48 overflow-y-auto border rounded p-2 space-y-2">
                {columns.map((column) => (
                  <div key={column.key} className="flex items-center space-x-2 space-x-reverse">
                    <Checkbox
                      checked={selectedColumns.has(column.key)}
                      onCheckedChange={() => handleColumnToggle(column.key)}
                    />
                    <Label className="text-sm">{column.title}</Label>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            ביטול
          </Button>
          <Button 
            onClick={handleExport} 
            disabled={selectedRows.size === 0 || selectedColumns.size === 0}
          >
            <Download className="h-4 w-4 ml-2" />
            ייצא ({selectedRows.size} שורות)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}