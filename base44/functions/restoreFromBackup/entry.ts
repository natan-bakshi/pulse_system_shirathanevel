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

        // קבלת פרמטרים
        const body = await req.json();
        const { backup_folder_id, backup_folder_name, confirm_restore } = body;

        if (!backup_folder_id && !backup_folder_name) {
            return Response.json({ 
                error: 'Missing required parameter: backup_folder_id or backup_folder_name' 
            }, { status: 400 });
        }

        if (!confirm_restore) {
            return Response.json({ 
                error: 'Restore not confirmed. Please set confirm_restore: true to proceed.',
                warning: 'שים לב! פעולה זו תמחק את כל הנתונים הקיימים ותחליף אותם בנתונים מהגיבוי. פעולה זו בלתי הפיכה!'
            }, { status: 400 });
        }

        console.log(`[Restore] Starting restore process by user: ${user.email}`);
        console.log(`[Restore] Backup: ${backup_folder_name || backup_folder_id}`);

        // קבלת Access Token ל-Google Drive
        const driveAccessToken = await base44.asServiceRole.connectors.getAccessToken("googledrive");

        // שלב 1: מציאת קובץ/תיקיית הגיבוי
        let masterBackup;
        let backupSourceName = backup_folder_name || backup_folder_id;

        // בדיקה אם זה קובץ JSON (פורמט חדש) או תיקייה (פורמט ישן)
        const isConsolidatedFile = backup_folder_name && backup_folder_name.endsWith('.json');

        if (isConsolidatedFile || (!backup_folder_name && backup_folder_id)) {
            // ניסיון לטעון כקובץ JSON ישירות
            let fileId = backup_folder_id;
            
            console.log(`[Restore] Attempting to load consolidated backup file: ${fileId}`);
            
            const downloadResponse = await fetch(
                `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
                {
                    headers: { 'Authorization': `Bearer ${driveAccessToken}` }
                }
            );
            
            if (downloadResponse.ok) {
                const backupContent = await downloadResponse.text();
                const parsed = JSON.parse(backupContent);
                
                if (parsed.entities) {
                    // זה קובץ גיבוי מאוחד חדש
                    masterBackup = parsed;
                    console.log(`[Restore] Loaded consolidated backup. Date: ${masterBackup.backup_date}`);
                } else {
                    // זה אולי master_backup.json מפורמט ישן
                    masterBackup = parsed;
                    console.log(`[Restore] Loaded legacy format backup`);
                }
            } else {
                // אם לא הצליח כקובץ, ננסה כתיקייה (פורמט ישן)
                console.log(`[Restore] File download failed, trying as legacy folder...`);
                masterBackup = await loadFromLegacyFolder(driveAccessToken, backup_folder_id, backup_folder_name);
            }
        } else {
            // פורמט ישן - תיקייה
            masterBackup = await loadFromLegacyFolder(driveAccessToken, backup_folder_id, backup_folder_name);
        }

        if (!masterBackup || !masterBackup.entities) {
            return Response.json({ 
                error: 'לא ניתן לטעון את נתוני הגיבוי. ודא שהגיבוי תקין.' 
            }, { status: 404 });
        }

        console.log(`[Restore] Backup loaded. Date: ${masterBackup.backup_date}, By: ${masterBackup.backup_by}`);

        // שלב 2: מחיקת כל הנתונים הקיימים (זהירות!)
        const entitiesToRestore = [
            'Event',
            'EventService',
            'Service',
            'Supplier',
            'Payment',
            'Package',
            'AppSettings',
            'QuoteTemplate',
            'SignedAgreement',
            'PriceHistory'
            // User לא נמחק - נשאר כמו שהוא
        ];

        const deleteResults = {};
        const restoreResults = {};

        for (const entityName of entitiesToRestore) {
            try {
                const existingRecords = await base44.asServiceRole.entities[entityName].list();
                
                console.log(`[Restore] Deleting ${existingRecords.length} records from ${entityName}`);
                
                let deleteCount = 0;
                for (const record of existingRecords) {
                    try {
                        await base44.asServiceRole.entities[entityName].delete(record.id);
                        deleteCount++;
                    } catch (delErr) {
                        console.warn(`[Restore] Failed to delete ${entityName} ${record.id}: ${delErr.message}`);
                    }
                }
                
                deleteResults[entityName] = {
                    found: existingRecords.length,
                    deleted: deleteCount
                };
            } catch (err) {
                console.error(`[Restore] Error processing ${entityName}: ${err.message}`);
                deleteResults[entityName] = { error: err.message };
            }
        }

        console.log('[Restore] Delete phase completed:', deleteResults);

        // שלב 3: שחזור נתונים מהגיבוי
        for (const entityName of entitiesToRestore) {
            try {
                const backupData = masterBackup.entities[entityName];
                
                if (!backupData || backupData.length === 0) {
                    console.log(`[Restore] No data to restore for ${entityName}`);
                    restoreResults[entityName] = { restored: 0 };
                    continue;
                }

                console.log(`[Restore] Restoring ${backupData.length} records to ${entityName}`);

                let restoreCount = 0;
                
                for (const record of backupData) {
                    try {
                        const { id, created_date, updated_date, created_by, ...dataToRestore } = record;
                        
                        await base44.asServiceRole.entities[entityName].create(dataToRestore);
                        restoreCount++;
                    } catch (createErr) {
                        console.warn(`[Restore] Failed to restore ${entityName} record: ${createErr.message}`);
                    }
                }

                restoreResults[entityName] = {
                    in_backup: backupData.length,
                    restored: restoreCount
                };
            } catch (err) {
                console.error(`[Restore] Error restoring ${entityName}: ${err.message}`);
                restoreResults[entityName] = { error: err.message };
            }
        }

        console.log('[Restore] Restore phase completed:', restoreResults);

        // שלב 4: שליחת התראה
        const now = new Date();
        try {
            await base44.integrations.Core.SendEmail({
                to: user.email,
                subject: `שחזור נתונים הושלם - ${backupSourceName}`,
                body: `
                    <div dir="rtl" style="font-family: Arial, sans-serif;">
                        <h2>שחזור נתונים הושלם!</h2>
                        <p><strong>תאריך ושעה:</strong> ${now.toLocaleString('he-IL')}</p>
                        <p><strong>גיבוי מקור:</strong> ${backupSourceName}</p>
                        <p><strong>תאריך הגיבוי המקורי:</strong> ${masterBackup.backup_date}</p>
                        
                        <h3>סיכום מחיקה:</h3>
                        <ul>
                            ${Object.entries(deleteResults).map(([entity, result]) => 
                                `<li>${entity}: ${result.deleted || 0} רשומות נמחקו</li>`
                            ).join('')}
                        </ul>
                        
                        <h3>סיכום שחזור:</h3>
                        <ul>
                            ${Object.entries(restoreResults).map(([entity, result]) => 
                                `<li>${entity}: ${result.restored || 0} רשומות שוחזרו</li>`
                            ).join('')}
                        </ul>
                        
                        <p style="color: red;"><strong>שים לב:</strong> מזהי הרשומות (IDs) השתנו לאחר השחזור. קישורים ישנים עלולים לא לעבוד.</p>
                    </div>
                `
            });
        } catch (emailError) {
            console.warn('[Restore] Failed to send notification email:', emailError.message);
        }

        return Response.json({
            success: true,
            message: 'שחזור הושלם בהצלחה',
            backup_info: {
                source: backupSourceName,
                original_backup_date: masterBackup.backup_date,
                original_backup_by: masterBackup.backup_by
            },
            delete_results: deleteResults,
            restore_results: restoreResults,
            warning: 'מזהי הרשומות (IDs) השתנו. קישורים ישנים עלולים לא לעבוד.'
        });

    } catch (error) {
        console.error('[Restore] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});

// פונקציית עזר: טעינה מתיקיית גיבוי ישנה (legacy)
async function loadFromLegacyFolder(driveAccessToken, folderId, folderName) {
    let targetFolderId = folderId;
    
    if (!targetFolderId && folderName) {
        const mainFolderName = 'Base44 Backups';
        const mainFolderId = await findMainFolder(driveAccessToken, mainFolderName);
        
        if (!mainFolderId) {
            return null;
        }
        
        const query = `name='${folderName}' and '${mainFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
        const response = await fetch(
            `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`,
            {
                headers: { 'Authorization': `Bearer ${driveAccessToken}` }
            }
        );
        const result = await response.json();
        
        if (!result.files || result.files.length === 0) {
            return null;
        }
        
        targetFolderId = result.files[0].id;
    }

    // מציאת master_backup.json בתיקייה
    const filesQuery = `name='master_backup.json' and '${targetFolderId}' in parents and trashed=false`;
    const filesResponse = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(filesQuery)}&fields=files(id,name)`,
        {
            headers: { 'Authorization': `Bearer ${driveAccessToken}` }
        }
    );
    const filesResult = await filesResponse.json();
    
    if (!filesResult.files || filesResult.files.length === 0) {
        return null;
    }

    const masterBackupFileId = filesResult.files[0].id;
    
    const downloadResponse = await fetch(
        `https://www.googleapis.com/drive/v3/files/${masterBackupFileId}?alt=media`,
        {
            headers: { 'Authorization': `Bearer ${driveAccessToken}` }
        }
    );
    
    if (!downloadResponse.ok) {
        return null;
    }

    const backupContent = await downloadResponse.text();
    return JSON.parse(backupContent);
}

// פונקציית עזר: מציאת תיקייה ראשית
async function findMainFolder(accessToken, folderName) {
    const query = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    
    const response = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`,
        {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        }
    );
    
    const result = await response.json();
    
    if (result.files && result.files.length > 0) {
        return result.files[0].id;
    }
    
    return null;
}