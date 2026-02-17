import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const MAX_BACKUPS = 30; // מדיניות FIFO - שומר עד 30 גיבויים

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

        console.log(`[Backup] Starting backup process by user: ${user.email}`);

        // קבלת Access Token ל-Google Drive
        const driveAccessToken = await base44.asServiceRole.connectors.getAccessToken("googledrive");
        
        // שלב 1: אחזור כל הנתונים מכל הישויות
        console.log('[Backup] Fetching all entities data...');
        
        const [events, eventServices, services, suppliers, payments, packages, appSettings, quoteTemplates, signedAgreements, priceHistory, users] = await Promise.all([
            base44.asServiceRole.entities.Event.list(),
            base44.asServiceRole.entities.EventService.list(),
            base44.asServiceRole.entities.Service.list(),
            base44.asServiceRole.entities.Supplier.list(),
            base44.asServiceRole.entities.Payment.list(),
            base44.asServiceRole.entities.Package.list(),
            base44.asServiceRole.entities.AppSettings.list(),
            base44.asServiceRole.entities.QuoteTemplate.list(),
            base44.asServiceRole.entities.SignedAgreement.list(),
            base44.asServiceRole.entities.PriceHistory.list(),
            base44.asServiceRole.entities.User.list()
        ]);

        console.log(`[Backup] Fetched ${events.length} events, ${eventServices.length} event services`);

        // שלב 2: בניית Master Backup JSON (entities ראשיים)
        const masterEntities = {
            Event: events,
            EventService: eventServices,
            Service: services,
            Supplier: suppliers,
            Payment: payments,
            Package: packages,
            AppSettings: appSettings,
            QuoteTemplate: quoteTemplates,
            SignedAgreement: signedAgreements,
            PriceHistory: priceHistory,
            User: users
        };

        // שלב 3: בניית גיבויים ספציפיים לכל אירוע (enriched)
        const enrichedEventBackups = [];
        for (const event of events) {
            const eventEventServices = eventServices.filter(es => es.event_id === event.id);
            const eventPayments = payments.filter(p => p.event_id === event.id);
            const eventSignedAgreements = signedAgreements.filter(sa => sa.user_id === event.id || eventEventServices.some(es => es.event_id === event.id));
            
            // העשרת EventServices עם פרטי ספקים
            const enrichedEventServices = eventEventServices.map(es => {
                const service = services.find(s => s.id === es.service_id);
                let supplierDetails = [];
                
                if (es.supplier_ids) {
                    try {
                        const supplierIds = JSON.parse(es.supplier_ids);
                        const supplierStatuses = es.supplier_statuses ? JSON.parse(es.supplier_statuses) : {};
                        
                        supplierDetails = supplierIds.map(supplierId => {
                            const supplier = suppliers.find(s => s.id === supplierId);
                            return {
                                supplier_id: supplierId,
                                supplier_name: supplier?.supplier_name || 'Unknown',
                                status: supplierStatuses[supplierId] || 'pending'
                            };
                        });
                    } catch (e) {
                        console.warn(`[Backup] Failed to parse supplier data for EventService ${es.id}`);
                    }
                }
                
                return {
                    ...es,
                    service_name: service?.service_name || 'Unknown',
                    service_category: service?.category || 'Unknown',
                    suppliers: supplierDetails
                };
            });

            enrichedEventBackups.push({
                event,
                event_services: enrichedEventServices,
                payments: eventPayments,
                signed_agreements: eventSignedAgreements.filter(sa => sa.user_id === event.id)
            });
        }

        // שלב 4: גיבוי הצעות מחיר HTML - אסוף הכל מראש
        const htmlQuotes = {};
        let htmlBackupCount = 0;
        for (const agreement of signedAgreements) {
            if (agreement.agreement_content_uri) {
                try {
                    const signedUrlResult = await base44.integrations.Core.CreateFileSignedUrl({
                        file_uri: agreement.agreement_content_uri,
                        expires_in: 300
                    });
                    
                    const htmlResponse = await fetch(signedUrlResult.signed_url);
                    if (htmlResponse.ok) {
                        const htmlContent = await htmlResponse.text();
                        htmlQuotes[`quote_${agreement.user_id || agreement.id}`] = htmlContent;
                        htmlBackupCount++;
                    }
                } catch (e) {
                    console.warn(`[Backup] Failed to fetch HTML for agreement ${agreement.id}: ${e.message}`);
                }
            }
        }
        console.log(`[Backup] Collected ${htmlBackupCount} quote HTML files`);

        // שלב 5: איחוד הכל לקובץ JSON אחד
        const now = new Date();
        const backupTimestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;

        const consolidatedBackup = {
            backup_date: now.toISOString(),
            backup_by: user.email,
            backup_name: backupTimestamp,
            // Master entities (לשחזור)
            entities: masterEntities,
            // גיבויים מועשרים לפי אירוע
            event_backups: enrichedEventBackups,
            // ישויות סטטיות (עותק נפרד לנוחות)
            static_entities: {
                services: services,
                suppliers: suppliers,
                packages: packages,
                appSettings: appSettings,
                quoteTemplates: quoteTemplates
            },
            // הצעות מחיר HTML
            html_quotes: htmlQuotes
        };

        const backupJson = JSON.stringify(consolidatedBackup, null, 2);
        const backupFileName = `Pulse_Backup_${backupTimestamp}.json`;

        console.log(`[Backup] Consolidated backup file: ${backupFileName} (${(backupJson.length / 1024 / 1024).toFixed(2)} MB)`);

        // שלב 6: מציאת או יצירת תיקייה ראשית ב-Drive (קריאה 1-2)
        const mainFolderName = 'Base44 Backups';
        const mainFolderId = await findOrCreateFolder(driveAccessToken, mainFolderName, null);
        console.log(`[Backup] Main folder ID: ${mainFolderId}`);

        // שלב 7: העלאת קובץ יחיד ל-Google Drive (קריאה אחת!)
        const uploadResult = await uploadFileToDrive(
            driveAccessToken,
            backupFileName,
            backupJson,
            'application/json',
            mainFolderId
        );
        console.log(`[Backup] Uploaded consolidated backup: ${uploadResult.id}`);

        // שלב 8: מדיניות FIFO - מחיקת גיבויים ישנים
        await applyFIFOPolicy(driveAccessToken, mainFolderId, MAX_BACKUPS);

        // שלב 9: שליחת התראה על הצלחה
        try {
            await base44.integrations.Core.SendEmail({
                to: user.email,
                subject: `גיבוי הושלם בהצלחה - ${backupTimestamp}`,
                body: `
                    <div dir="rtl" style="font-family: Arial, sans-serif;">
                        <h2>גיבוי הושלם בהצלחה!</h2>
                        <p><strong>תאריך ושעה:</strong> ${now.toLocaleString('he-IL')}</p>
                        <p><strong>שם הקובץ:</strong> ${backupFileName}</p>
                        <p><strong>סיכום:</strong></p>
                        <ul>
                            <li>אירועים: ${events.length}</li>
                            <li>שירותי אירוע: ${eventServices.length}</li>
                            <li>שירותים: ${services.length}</li>
                            <li>ספקים: ${suppliers.length}</li>
                            <li>תשלומים: ${payments.length}</li>
                            <li>הצעות מחיר (HTML): ${htmlBackupCount}</li>
                        </ul>
                        <p>הגיבוי נשמר ב-Google Drive בתיקייה: <strong>${mainFolderName}/${backupFileName}</strong></p>
                    </div>
                `
            });
        } catch (emailError) {
            console.warn('[Backup] Failed to send notification email:', emailError.message);
        }

        console.log('[Backup] Backup process completed successfully');

        return Response.json({
            success: true,
            backup_name: backupTimestamp,
            backup_file_name: backupFileName,
            backup_file_id: uploadResult.id,
            summary: {
                events: events.length,
                event_services: eventServices.length,
                services: services.length,
                suppliers: suppliers.length,
                payments: payments.length,
                html_quotes: htmlBackupCount
            }
        });

    } catch (error) {
        console.error('[Backup] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});

// פונקציית עזר: מציאת או יצירת תיקייה ב-Google Drive
async function findOrCreateFolder(accessToken, folderName, parentId) {
    // חיפוש תיקייה קיימת
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
    
    // יצירת תיקייה חדשה
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

// פונקציית עזר: העלאת קובץ ל-Google Drive
async function uploadFileToDrive(accessToken, fileName, content, mimeType, folderId) {
    const metadata = {
        name: fileName,
        parents: [folderId]
    };
    
    const boundary = '-------314159265358979323846';
    const delimiter = "\r\n--" + boundary + "\r\n";
    const closeDelimiter = "\r\n--" + boundary + "--";
    
    const multipartBody =
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: ' + mimeType + '\r\n\r\n' +
        content +
        closeDelimiter;
    
    const response = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'multipart/related; boundary=' + boundary
            },
            body: multipartBody
        }
    );
    
    return await response.json();
}

// פונקציית עזר: מדיניות FIFO - מחיקת גיבויים ישנים (קבצי JSON בתיקייה הראשית)
async function applyFIFOPolicy(accessToken, mainFolderId, maxBackups) {
    // חיפוש קבצי JSON של גיבויים (Pulse_Backup_*.json)
    const query = `'${mainFolderId}' in parents and mimeType='application/json' and name contains 'Pulse_Backup_' and trashed=false`;
    
    const response = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,createdTime)&orderBy=createdTime`,
        {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        }
    );
    
    const result = await response.json();
    const files = result.files || [];
    
    console.log(`[Backup FIFO] Found ${files.length} backup files, max allowed: ${maxBackups}`);
    
    // גם חיפוש תיקיות ישנות (מהמבנה הקודם) לספירה כוללת
    const folderQuery = `'${mainFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const folderResponse = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(folderQuery)}&fields=files(id,name,createdTime)&orderBy=createdTime`,
        {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        }
    );
    const folderResult = await folderResponse.json();
    const oldFolders = (folderResult.files || []).filter(f => f.name !== 'Base44 Backups');
    
    // מיזוג הכל ומיון לפי תאריך יצירה
    const allBackupItems = [
        ...files.map(f => ({ ...f, type: 'file' })),
        ...oldFolders.map(f => ({ ...f, type: 'folder' }))
    ].sort((a, b) => new Date(a.createdTime) - new Date(b.createdTime));
    
    // אם יש יותר מדי גיבויים, מחק את הישנים
    if (allBackupItems.length > maxBackups) {
        const itemsToDelete = allBackupItems.slice(0, allBackupItems.length - maxBackups);
        
        for (const item of itemsToDelete) {
            console.log(`[Backup FIFO] Deleting old backup: ${item.name} (${item.type})`);
            
            if (item.type === 'folder') {
                // מחיקת כל הקבצים בתיקייה הישנה
                const filesInFolder = `'${item.id}' in parents and trashed=false`;
                const innerResponse = await fetch(
                    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(filesInFolder)}&fields=files(id)`,
                    { headers: { 'Authorization': `Bearer ${accessToken}` } }
                );
                const innerResult = await innerResponse.json();
                for (const innerFile of (innerResult.files || [])) {
                    await fetch(`https://www.googleapis.com/drive/v3/files/${innerFile.id}`, {
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${accessToken}` }
                    });
                }
            }
            
            // מחיקת הקובץ/תיקייה עצמה
            await fetch(`https://www.googleapis.com/drive/v3/files/${item.id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
        }
        
        console.log(`[Backup FIFO] Deleted ${itemsToDelete.length} old backups`);
    }
}