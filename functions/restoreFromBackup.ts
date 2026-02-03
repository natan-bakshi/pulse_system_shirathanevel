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
        console.log(`[Restore] Backup folder: ${backup_folder_name || backup_folder_id}`);

        // קבלת Access Token ל-Google Drive
        const driveAccessToken = await base44.asServiceRole.connectors.getAccessToken("googledrive");

        // שלב 1: מציאת תיקיית הגיבוי
        let folderId = backup_folder_id;
        
        if (!folderId && backup_folder_name) {
            // מציאת התיקייה לפי שם
            const mainFolderName = 'Base44 Backups';
            const mainFolderId = await findMainFolder(driveAccessToken, mainFolderName);
            
            if (!mainFolderId) {
                return Response.json({ error: 'Backup folder not found' }, { status: 404 });
            }
            
            const query = `name='${backup_folder_name}' and '${mainFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
            const response = await fetch(
                `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`,
                {
                    headers: { 'Authorization': `Bearer ${driveAccessToken}` }
                }
            );
            const result = await response.json();
            
            if (!result.files || result.files.length === 0) {
                return Response.json({ error: `Backup folder '${backup_folder_name}' not found` }, { status: 404 });
            }
            
            folderId = result.files[0].id;
        }

        console.log(`[Restore] Found backup folder ID: ${folderId}`);

        // שלב 2: מציאת והורדת master_backup.json
        const filesQuery = `name='master_backup.json' and '${folderId}' in parents and trashed=false`;
        const filesResponse = await fetch(
            `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(filesQuery)}&fields=files(id,name)`,
            {
                headers: { 'Authorization': `Bearer ${driveAccessToken}` }
            }
        );
        const filesResult = await filesResponse.json();
        
        if (!filesResult.files || filesResult.files.length === 0) {
            return Response.json({ 
                error: 'master_backup.json not found in backup folder. Invalid backup.' 
            }, { status: 404 });
        }

        const masterBackupFileId = filesResult.files[0].id;
        console.log(`[Restore] Found master_backup.json: ${masterBackupFileId}`);

        // הורדת תוכן הקובץ
        const downloadResponse = await fetch(
            `https://www.googleapis.com/drive/v3/files/${masterBackupFileId}?alt=media`,
            {
                headers: { 'Authorization': `Bearer ${driveAccessToken}` }
            }
        );
        
        if (!downloadResponse.ok) {
            return Response.json({ error: 'Failed to download backup file' }, { status: 500 });
        }

        const backupContent = await downloadResponse.text();
        const masterBackup = JSON.parse(backupContent);

        console.log(`[Restore] Backup loaded. Date: ${masterBackup.backup_date}, By: ${masterBackup.backup_by}`);

        // שלב 3: מחיקת כל הנתונים הקיימים (זהירות!)
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
                // אחזור כל הרשומות הקיימות
                const existingRecords = await base44.asServiceRole.entities[entityName].list();
                
                console.log(`[Restore] Deleting ${existingRecords.length} records from ${entityName}`);
                
                // מחיקת כל רשומה
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

        // שלב 4: שחזור נתונים מהגיבוי
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
                
                // שחזור רשומה אחת בכל פעם (bulkCreate יכול להיכשל על חלק מהישויות)
                for (const record of backupData) {
                    try {
                        // הסרת שדות מערכת שלא צריך לשחזר
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

        // שלב 5: שליחת התראה
        const now = new Date();
        try {
            await base44.integrations.Core.SendEmail({
                to: user.email,
                subject: `שחזור נתונים הושלם - ${backup_folder_name || folderId}`,
                body: `
                    <div dir="rtl" style="font-family: Arial, sans-serif;">
                        <h2>שחזור נתונים הושלם!</h2>
                        <p><strong>תאריך ושעה:</strong> ${now.toLocaleString('he-IL')}</p>
                        <p><strong>גיבוי מקור:</strong> ${backup_folder_name || folderId}</p>
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
                folder_id: folderId,
                folder_name: backup_folder_name,
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