import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // אימות משתמש והרשאות admin
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }
        if (user.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        console.log(`[Sheets Backup] Starting Google Sheets backup by user: ${user.email}`);

        // קבלת Access Token ל-Google Sheets ו-Google Drive
        const sheetsAccessToken = await base44.asServiceRole.connectors.getAccessToken("googlesheets");
        const driveAccessToken = await base44.asServiceRole.connectors.getAccessToken("googledrive");

        // שלב 1: אחזור כל הנתונים הנדרשים
        console.log('[Sheets Backup] Fetching data...');
        
        const [events, eventServices, services, suppliers] = await Promise.all([
            base44.asServiceRole.entities.Event.list(),
            base44.asServiceRole.entities.EventService.list(),
            base44.asServiceRole.entities.Service.list(),
            base44.asServiceRole.entities.Supplier.list()
        ]);

        console.log(`[Sheets Backup] Fetched ${events.length} events, ${eventServices.length} event services`);

        // שלב 2: בניית מפות לחיפוש מהיר
        const servicesMap = new Map(services.map(s => [s.id, s]));
        const suppliersMap = new Map(suppliers.map(s => [s.id, s]));

        // שלב 3: זיהוי כל הקטגוריות הייחודיות
        const allCategories = [...new Set(services.map(s => s.category).filter(Boolean))].sort();
        console.log(`[Sheets Backup] Found ${allCategories.length} service categories:`, allCategories);

        // שלב 4: בניית שורות הטבלה
        const headers = [
            'מזהה אירוע',
            'שם משפחה',
            'שם האירוע',
            'תאריך אירוע',
            'שעת אירוע',
            'מיקום',
            'סטטוס אירוע',
            'מספר אורחים',
            ...allCategories
        ];

        const rows = [headers];

        // מיון אירועים לפי תאריך
        const sortedEvents = [...events].sort((a, b) => {
            const dateA = new Date(a.event_date);
            const dateB = new Date(b.event_date);
            return dateA - dateB;
        });

        for (const event of sortedEvents) {
            // שירותי האירוע
            const eventEventServices = eventServices.filter(es => es.event_id === event.id);
            
            // בניית עמודות הקטגוריות
            const categoryColumns = allCategories.map(category => {
                // מציאת כל השירותים באותה קטגוריה עבור האירוע
                const categoryServices = eventEventServices.filter(es => {
                    const service = servicesMap.get(es.service_id);
                    return service?.category === category;
                });

                if (categoryServices.length === 0) {
                    return ''; // אין שירותים בקטגוריה זו
                }

                // בניית המחרוזת עבור כל שירות בקטגוריה
                const serviceStrings = categoryServices.map(es => {
                    const service = servicesMap.get(es.service_id);
                    const serviceName = service?.service_name || 'שירות לא ידוע';
                    
                    // פרסור ספקים וסטטוסים
                    let supplierParts = [];
                    
                    if (es.supplier_ids) {
                        try {
                            const supplierIds = JSON.parse(es.supplier_ids);
                            const supplierStatuses = es.supplier_statuses ? JSON.parse(es.supplier_statuses) : {};
                            
                            supplierParts = supplierIds.map(supplierId => {
                                const supplier = suppliersMap.get(supplierId);
                                const supplierName = supplier?.supplier_name || 'ספק לא ידוע';
                                const status = supplierStatuses[supplierId] || 'pending';
                                const statusHebrew = translateStatus(status);
                                return `${supplierName} (${statusHebrew})`;
                            });
                        } catch (e) {
                            console.warn(`[Sheets Backup] Failed to parse supplier data for EventService ${es.id}`);
                        }
                    }

                    // בניית המחרוזת הסופית
                    if (supplierParts.length > 0) {
                        return `${serviceName}: ${supplierParts.join(', ')}`;
                    } else {
                        return `${serviceName}: לא שובץ ספק`;
                    }
                });

                return serviceStrings.join('\n');
            });

            // הוספת השורה
            rows.push([
                event.id,
                event.family_name || '',
                event.event_name || '',
                event.event_date || '',
                event.event_time || '',
                event.location || '',
                translateEventStatus(event.status),
                event.guest_count || '',
                ...categoryColumns
            ]);
        }

        console.log(`[Sheets Backup] Built ${rows.length} rows (including header)`);

        // שלב 5: יצירת או עדכון גיליון Google Sheets
        const now = new Date();
        const sheetTitle = `לוח אירועים - ${now.toLocaleDateString('he-IL')}`;
        
        // יצירת גיליון חדש
        const spreadsheet = await createSpreadsheet(sheetsAccessToken, sheetTitle);
        
        if (!spreadsheet.spreadsheetId) {
            console.error('[Sheets Backup] Failed to create spreadsheet:', spreadsheet);
            return Response.json({ error: 'Failed to create spreadsheet', details: spreadsheet }, { status: 500 });
        }
        
        const spreadsheetId = spreadsheet.spreadsheetId;
        const sheetId = spreadsheet.sheets?.[0]?.properties?.sheetId || 0;
        
        console.log(`[Sheets Backup] Created spreadsheet: ${spreadsheetId}`);

        // כתיבת הנתונים לגיליון
        await writeToSheet(sheetsAccessToken, spreadsheetId, rows);
        
        // עיצוב הגיליון
        await formatSheet(sheetsAccessToken, spreadsheetId, sheetId, headers.length, rows.length);

        console.log('[Sheets Backup] Data written and formatted');

        // שלב 6: העברת הגיליון לתיקיית הגיבויים ב-Drive
        const mainFolderName = 'Base44 Backups';
        const mainFolderId = await findOrCreateFolder(driveAccessToken, mainFolderName, null);
        
        // העברת הגיליון לתיקייה
        await moveFileToFolder(driveAccessToken, spreadsheetId, mainFolderId);
        
        console.log(`[Sheets Backup] Moved spreadsheet to ${mainFolderName} folder`);

        // שלב 7: שליחת התראה
        const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
        
        try {
            await base44.integrations.Core.SendEmail({
                to: user.email,
                subject: `גיבוי לוח אירועים ל-Google Sheets הושלם`,
                body: `
                    <div dir="rtl" style="font-family: Arial, sans-serif;">
                        <h2>גיבוי לוח האירועים הושלם!</h2>
                        <p><strong>תאריך ושעה:</strong> ${now.toLocaleString('he-IL')}</p>
                        <p><strong>שם הגיליון:</strong> ${sheetTitle}</p>
                        <p><strong>סיכום:</strong></p>
                        <ul>
                            <li>מספר אירועים: ${events.length}</li>
                            <li>מספר קטגוריות שירות: ${allCategories.length}</li>
                        </ul>
                        <p><a href="${spreadsheetUrl}" target="_blank">לחץ כאן לצפייה בגיליון</a></p>
                    </div>
                `
            });
        } catch (emailError) {
            console.warn('[Sheets Backup] Failed to send notification email:', emailError.message);
        }

        return Response.json({
            success: true,
            spreadsheet_id: spreadsheetId,
            spreadsheet_url: spreadsheetUrl,
            sheet_title: sheetTitle,
            summary: {
                events: events.length,
                categories: allCategories.length,
                rows: rows.length - 1 // לא כולל כותרת
            }
        });

    } catch (error) {
        console.error('[Sheets Backup] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});

// פונקציית עזר: תרגום סטטוס ספק
function translateStatus(status) {
    const statusMap = {
        'pending': 'בהמתנה',
        'approved': 'אושר',
        'rejected': 'נדחה',
        'cancelled': 'בוטל'
    };
    return statusMap[status] || status;
}

// פונקציית עזר: תרגום סטטוס אירוע
function translateEventStatus(status) {
    const statusMap = {
        'quote': 'הצעת מחיר',
        'confirmed': 'מאושר',
        'in_progress': 'בתהליך',
        'completed': 'הושלם',
        'cancelled': 'בוטל'
    };
    return statusMap[status] || status;
}

// פונקציית עזר: יצירת גיליון Google Sheets חדש
async function createSpreadsheet(accessToken, title) {
    const response = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            properties: {
                title: title,
                locale: 'iw_IL'
            },
            sheets: [{
                properties: {
                    title: 'לוח אירועים',
                    rightToLeft: true
                }
            }]
        })
    });
    
    return await response.json();
}

// פונקציית עזר: כתיבת נתונים לגיליון
async function writeToSheet(accessToken, spreadsheetId, rows) {
    const response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A1?valueInputOption=RAW`,
        {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                values: rows
            })
        }
    );
    
    return await response.json();
}

// פונקציית עזר: עיצוב הגיליון
async function formatSheet(accessToken, spreadsheetId, sheetId, columnsCount, rowsCount) {
    const requests = [
        // הקפאת שורת הכותרת
        {
            updateSheetProperties: {
                properties: {
                    sheetId: sheetId,
                    gridProperties: {
                        frozenRowCount: 1
                    }
                },
                fields: 'gridProperties.frozenRowCount'
            }
        },
        // עיצוב שורת הכותרת
        {
            repeatCell: {
                range: {
                    sheetId: sheetId,
                    startRowIndex: 0,
                    endRowIndex: 1,
                    startColumnIndex: 0,
                    endColumnIndex: columnsCount
                },
                cell: {
                    userEnteredFormat: {
                        backgroundColor: { red: 0.2, green: 0.4, blue: 0.6 },
                        textFormat: {
                            bold: true,
                            foregroundColor: { red: 1, green: 1, blue: 1 }
                        },
                        horizontalAlignment: 'CENTER',
                        verticalAlignment: 'MIDDLE'
                    }
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)'
            }
        },
        // התאמת רוחב עמודות אוטומטית
        {
            autoResizeDimensions: {
                dimensions: {
                    sheetId: sheetId,
                    dimension: 'COLUMNS',
                    startIndex: 0,
                    endIndex: columnsCount
                }
            }
        },
        // גלישת טקסט בתאים
        {
            repeatCell: {
                range: {
                    sheetId: sheetId,
                    startRowIndex: 1,
                    endRowIndex: rowsCount,
                    startColumnIndex: 0,
                    endColumnIndex: columnsCount
                },
                cell: {
                    userEnteredFormat: {
                        wrapStrategy: 'WRAP',
                        verticalAlignment: 'TOP'
                    }
                },
                fields: 'userEnteredFormat(wrapStrategy,verticalAlignment)'
            }
        }
    ];
    
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ requests })
    });
}

// פונקציית עזר: מציאת או יצירת תיקייה ב-Google Drive
async function findOrCreateFolder(accessToken, folderName, parentId) {
    let query = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    if (parentId) {
        query += ` and '${parentId}' in parents`;
    }
    
    const searchResponse = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`,
        {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        }
    );
    
    const searchResult = await searchResponse.json();
    
    if (searchResult.files && searchResult.files.length > 0) {
        return searchResult.files[0].id;
    }
    
    const metadata = {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder'
    };
    if (parentId) {
        metadata.parents = [parentId];
    }
    
    const createResponse = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(metadata)
    });
    
    const createResult = await createResponse.json();
    return createResult.id;
}

// פונקציית עזר: העברת קובץ לתיקייה
async function moveFileToFolder(accessToken, fileId, folderId) {
    // קבלת ההורים הנוכחיים
    const getResponse = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents`,
        {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        }
    );
    const fileInfo = await getResponse.json();
    const previousParents = fileInfo.parents ? fileInfo.parents.join(',') : '';
    
    // העברה לתיקייה החדשה
    await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?addParents=${folderId}&removeParents=${previousParents}`,
        {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${accessToken}` }
        }
    );
}