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

        console.log(`[List Backups] Fetching backup list for user: ${user.email}`);

        // קבלת Access Token ל-Google Drive
        const driveAccessToken = await base44.asServiceRole.connectors.getAccessToken("googledrive");

        // מציאת תיקייה ראשית
        const mainFolderName = 'Base44 Backups';
        const mainFolderId = await findMainFolder(driveAccessToken, mainFolderName);
        
        if (!mainFolderId) {
            console.log('[List Backups] No backup folder found');
            return Response.json({
                success: true,
                backups: [],
                sheets: [],
                message: 'לא נמצאו גיבויים. טרם בוצע גיבוי ראשון.'
            });
        }

        // --- פורמט חדש: קבצי JSON יחידים ---
        const jsonQuery = `'${mainFolderId}' in parents and mimeType='application/json' and name contains 'Pulse_Backup_' and trashed=false`;
        const jsonResponse = await fetch(
            `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(jsonQuery)}&fields=files(id,name,createdTime,modifiedTime,size)&orderBy=createdTime desc`,
            {
                headers: { 'Authorization': `Bearer ${driveAccessToken}` }
            }
        );
        const jsonResult = await jsonResponse.json();
        const jsonFiles = jsonResult.files || [];

        console.log(`[List Backups] Found ${jsonFiles.length} consolidated backup files`);

        const newFormatBackups = jsonFiles.map(file => {
            const dateTime = parseBackupFileName(file.name);
            return {
                id: file.id,
                name: file.name,
                created_at: file.createdTime,
                modified_at: file.modifiedTime,
                date_formatted: dateTime.dateFormatted,
                time_formatted: dateTime.timeFormatted,
                files_count: 1,
                total_size_bytes: parseInt(file.size) || 0,
                total_size_formatted: formatBytes(parseInt(file.size) || 0),
                has_master_backup: true,
                is_valid: true,
                backup_type: 'consolidated' // סוג חדש
            };
        });

        // --- פורמט ישן: תיקיות גיבוי ---
        const folderQuery = `'${mainFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
        const folderResponse = await fetch(
            `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(folderQuery)}&fields=files(id,name,createdTime,modifiedTime)&orderBy=createdTime desc`,
            {
                headers: { 'Authorization': `Bearer ${driveAccessToken}` }
            }
        );
        const folderResult = await folderResponse.json();
        const folders = folderResult.files || [];

        console.log(`[List Backups] Found ${folders.length} legacy backup folders`);

        // עיבוד תיקיות ישנות
        const legacyBackups = await Promise.all(folders.map(async (folder) => {
            const filesQuery = `'${folder.id}' in parents and trashed=false`;
            const filesResponse = await fetch(
                `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(filesQuery)}&fields=files(id,name,size)`,
                {
                    headers: { 'Authorization': `Bearer ${driveAccessToken}` }
                }
            );
            const filesResult = await filesResponse.json();
            const files = filesResult.files || [];
            
            const totalSize = files.reduce((sum, file) => sum + (parseInt(file.size) || 0), 0);
            const hasMasterBackup = files.some(f => f.name === 'master_backup.json');
            const dateTime = parseBackupFolderName(folder.name);
            
            return {
                id: folder.id,
                name: folder.name,
                created_at: folder.createdTime,
                modified_at: folder.modifiedTime,
                date_formatted: dateTime.dateFormatted,
                time_formatted: dateTime.timeFormatted,
                files_count: files.length,
                total_size_bytes: totalSize,
                total_size_formatted: formatBytes(totalSize),
                has_master_backup: hasMasterBackup,
                is_valid: hasMasterBackup,
                backup_type: 'legacy' // סוג ישן
            };
        }));

        // מיזוג ומיון לפי תאריך יצירה (חדש ראשון)
        const allBackups = [...newFormatBackups, ...legacyBackups]
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        // רשימת גיליונות Google Sheets
        const sheetsQuery = `'${mainFolderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
        const sheetsResponse = await fetch(
            `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(sheetsQuery)}&fields=files(id,name,createdTime,modifiedTime)&orderBy=createdTime desc`,
            {
                headers: { 'Authorization': `Bearer ${driveAccessToken}` }
            }
        );
        const sheetsResult = await sheetsResponse.json();
        const sheets = (sheetsResult.files || []).map(sheet => ({
            id: sheet.id,
            name: sheet.name,
            created_at: sheet.createdTime,
            modified_at: sheet.modifiedTime,
            url: `https://docs.google.com/spreadsheets/d/${sheet.id}`
        }));

        return Response.json({
            success: true,
            backups: allBackups,
            sheets: sheets,
            total_backups: allBackups.length,
            total_sheets: sheets.length
        });

    } catch (error) {
        console.error('[List Backups] Error:', error);
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

// פונקציית עזר: פרסור שם קובץ גיבוי חדש (Pulse_Backup_YYYY-MM-DD_HHMMSS.json)
function parseBackupFileName(fileName) {
    const match = fileName.match(/Pulse_Backup_(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})\.json$/);
    
    if (match) {
        const [, year, month, day, hour, minute, second] = match;
        const date = new Date(year, month - 1, day, hour, minute, second);
        
        return {
            dateFormatted: date.toLocaleDateString('he-IL', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            }),
            timeFormatted: date.toLocaleTimeString('he-IL', {
                hour: '2-digit',
                minute: '2-digit'
            })
        };
    }
    
    return {
        dateFormatted: fileName,
        timeFormatted: ''
    };
}

// פונקציית עזר: פרסור שם תיקיית גיבוי ישנה (YYYY-MM-DD_HHMMSS)
function parseBackupFolderName(folderName) {
    const match = folderName.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})$/);
    
    if (match) {
        const [, year, month, day, hour, minute, second] = match;
        const date = new Date(year, month - 1, day, hour, minute, second);
        
        return {
            dateFormatted: date.toLocaleDateString('he-IL', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            }),
            timeFormatted: date.toLocaleTimeString('he-IL', {
                hour: '2-digit',
                minute: '2-digit'
            })
        };
    }
    
    return {
        dateFormatted: folderName,
        timeFormatted: ''
    };
}

// פונקציית עזר: פורמט בייטים
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}