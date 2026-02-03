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

        // שלב 2: בניית Master Backup JSON
        const masterBackup = {
            backup_date: new Date().toISOString(),
            backup_by: user.email,
            entities: {
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
            }
        };

        console.log(`[Backup] Master backup created with ${events.length} events, ${eventServices.length} event services`);

        // שלב 3: בניית גיבויים ספציפיים לכל אירוע
        const eventBackups = [];
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

            eventBackups.push({
                event,
                event_services: enrichedEventServices,
                payments: eventPayments,
                signed_agreements: eventSignedAgreements.filter(sa => sa.user_id === event.id)
            });
        }

        // שלב 4: יצירת תיקיית גיבוי ב-Google Drive
        const now = new Date();
        const backupFolderName = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
        
        // מציאת או יצירת תיקייה ראשית
        const mainFolderName = 'Base44 Backups';
        
        // חיפוש תיקייה ראשית
        let mainFolderId = await findOrCreateFolder(driveAccessToken, mainFolderName, null);
        console.log(`[Backup] Main folder ID: ${mainFolderId}`);
        
        // יצירת תיקיית גיבוי חדשה
        const backupFolderId = await findOrCreateFolder(driveAccessToken, backupFolderName, mainFolderId);
        console.log(`[Backup] Created backup folder: ${backupFolderName} (ID: ${backupFolderId})`);

        // שלב 5: העלאת קבצים ל-Google Drive
        // העלאת Master Backup
        await uploadFileToDrive(
            driveAccessToken,
            'master_backup.json',
            JSON.stringify(masterBackup, null, 2),
            'application/json',
            backupFolderId
        );
        console.log('[Backup] Master backup uploaded');

        // העלאת גיבויים ספציפיים לאירועים
        for (const eventBackup of eventBackups) {
            await uploadFileToDrive(
                driveAccessToken,
                `event_${eventBackup.event.id}.json`,
                JSON.stringify(eventBackup, null, 2),
                'application/json',
                backupFolderId
            );
        }
        console.log(`[Backup] Uploaded ${eventBackups.length} event-specific backups`);

        // העלאת גיבויים נפרדים לישויות סטטיות
        const staticEntities = {
            services: services,
            suppliers: suppliers,
            packages: packages,
            appSettings: appSettings,
            quoteTemplates: quoteTemplates
        };
        
        for (const [entityName, entityData] of Object.entries(staticEntities)) {
            await uploadFileToDrive(
                driveAccessToken,
                `${entityName}.json`,
                JSON.stringify(entityData, null, 2),
                'application/json',
                backupFolderId
            );
        }
        console.log('[Backup] Static entities backups uploaded');

        // שלב 6: גיבוי הצעות מחיר HTML
        let htmlBackupCount = 0;
        for (const agreement of signedAgreements) {
            if (agreement.agreement_content_uri) {
                try {
                    // קבלת signed URL לקובץ ה-HTML הפרטי
                    const signedUrlResult = await base44.integrations.Core.CreateFileSignedUrl({
                        file_uri: agreement.agreement_content_uri,
                        expires_in: 300
                    });
                    
                    // הורדת תוכן ה-HTML
                    const htmlResponse = await fetch(signedUrlResult.signed_url);
                    if (htmlResponse.ok) {
                        const htmlContent = await htmlResponse.text();
                        
                        // העלאת ה-HTML ל-Drive
                        await uploadFileToDrive(
                            driveAccessToken,
                            `quote_${agreement.user_id || agreement.id}.html`,
                            htmlContent,
                            'text/html',
                            backupFolderId
                        );
                        htmlBackupCount++;
                    }
                } catch (e) {
                    console.warn(`[Backup] Failed to backup HTML for agreement ${agreement.id}: ${e.message}`);
                }
            }
        }
        console.log(`[Backup] Backed up ${htmlBackupCount} quote HTML files`);

        // שלב 7: מדיניות FIFO - מחיקת גיבויים ישנים
        await applyFIFOPolicy(driveAccessToken, mainFolderId, MAX_BACKUPS);

        // שלב 8: שליחת התראה על הצלחה
        try {
            await base44.integrations.Core.SendEmail({
                to: user.email,
                subject: `גיבוי הושלם בהצלחה - ${backupFolderName}`,
                body: `
                    <div dir="rtl" style="font-family: Arial, sans-serif;">
                        <h2>גיבוי הושלם בהצלחה!</h2>
                        <p><strong>תאריך ושעה:</strong> ${now.toLocaleString('he-IL')}</p>
                        <p><strong>שם הגיבוי:</strong> ${backupFolderName}</p>
                        <p><strong>סיכום:</strong></p>
                        <ul>
                            <li>אירועים: ${events.length}</li>
                            <li>שירותי אירוע: ${eventServices.length}</li>
                            <li>שירותים: ${services.length}</li>
                            <li>ספקים: ${suppliers.length}</li>
                            <li>תשלומים: ${payments.length}</li>
                            <li>הצעות מחיר (HTML): ${htmlBackupCount}</li>
                        </ul>
                        <p>הגיבוי נשמר ב-Google Drive בתיקייה: <strong>${mainFolderName}/${backupFolderName}</strong></p>
                    </div>
                `
            });
        } catch (emailError) {
            console.warn('[Backup] Failed to send notification email:', emailError.message);
        }

        console.log('[Backup] Backup process completed successfully');

        return Response.json({
            success: true,
            backup_name: backupFolderName,
            backup_folder_id: backupFolderId,
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

// פונקציית עזר: מדיניות FIFO - מחיקת גיבויים ישנים
async function applyFIFOPolicy(accessToken, mainFolderId, maxBackups) {
    // רשימת כל תיקיות הגיבוי
    const query = `'${mainFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    
    const response = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,createdTime)&orderBy=createdTime`,
        {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        }
    );
    
    const result = await response.json();
    const folders = result.files || [];
    
    console.log(`[Backup FIFO] Found ${folders.length} backup folders, max allowed: ${maxBackups}`);
    
    // אם יש יותר מדי גיבויים, מחק את הישנים
    if (folders.length > maxBackups) {
        const foldersToDelete = folders.slice(0, folders.length - maxBackups);
        
        for (const folder of foldersToDelete) {
            console.log(`[Backup FIFO] Deleting old backup: ${folder.name}`);
            
            // מחיקת כל הקבצים בתיקייה
            const filesQuery = `'${folder.id}' in parents and trashed=false`;
            const filesResponse = await fetch(
                `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(filesQuery)}&fields=files(id)`,
                {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                }
            );
            const filesResult = await filesResponse.json();
            
            for (const file of (filesResult.files || [])) {
                await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });
            }
            
            // מחיקת התיקייה עצמה
            await fetch(`https://www.googleapis.com/drive/v3/files/${folder.id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
        }
        
        console.log(`[Backup FIFO] Deleted ${foldersToDelete.length} old backups`);
    }
}