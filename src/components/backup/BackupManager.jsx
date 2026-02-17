import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
    HardDrive, 
    FileSpreadsheet, 
    Download, 
    RotateCcw, 
    Loader2, 
    CheckCircle2, 
    AlertCircle,
    Calendar,
    Clock,
    Files,
    ExternalLink,
    RefreshCw,
    Trash2,
    AlertTriangle
} from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
} from "@/components/ui/dialog";
import { createBackup } from "@/functions/createBackup";
import { createGoogleSheetBackup } from "@/functions/createGoogleSheetBackup";
import { listBackups } from "@/functions/listBackups";
import { restoreFromBackup } from "@/functions/restoreFromBackup";

export default function BackupManager() {
    const [isBackingUp, setIsBackingUp] = useState(false);
    const [isCreatingSheet, setIsCreatingSheet] = useState(false);
    const [isRestoring, setIsRestoring] = useState(false);
    const [selectedBackup, setSelectedBackup] = useState(null);
    const [showRestoreDialog, setShowRestoreDialog] = useState(false);
    const [actionResult, setActionResult] = useState(null);
    
    const queryClient = useQueryClient();

    // שליפת רשימת הגיבויים
    const { data: backupsData, isLoading: isLoadingBackups, refetch: refetchBackups } = useQuery({
        queryKey: ['backupsList'],
        queryFn: async () => {
            const response = await listBackups({});
            return response.data;
        },
        staleTime: 60 * 1000, // 1 דקה
        refetchOnWindowFocus: false
    });

    const backups = backupsData?.backups || [];
    const sheets = backupsData?.sheets || [];

    // יצירת גיבוי מלא
    const handleCreateBackup = async () => {
        setIsBackingUp(true);
        setActionResult(null);
        try {
            const response = await createBackup({});
            setActionResult({
                type: 'success',
                title: 'גיבוי נוצר בהצלחה!',
                message: `גיבוי ${response.data.backup_file_name || response.data.backup_name} נוצר. ${response.data.summary.events} אירועים, ${response.data.summary.event_services} שירותי אירוע.`
            });
            refetchBackups();
        } catch (error) {
            setActionResult({
                type: 'error',
                title: 'שגיאה ביצירת גיבוי',
                message: error.response?.data?.error || error.message
            });
        } finally {
            setIsBackingUp(false);
        }
    };

    // יצירת גיליון Sheets
    const handleCreateSheet = async () => {
        setIsCreatingSheet(true);
        setActionResult(null);
        try {
            const response = await createGoogleSheetBackup({});
            setActionResult({
                type: 'success',
                title: 'גיליון נוצר בהצלחה!',
                message: `${response.data.sheet_title} - ${response.data.summary.events} אירועים ב-${response.data.summary.categories} קטגוריות.`,
                link: response.data.spreadsheet_url
            });
            refetchBackups();
        } catch (error) {
            setActionResult({
                type: 'error',
                title: 'שגיאה ביצירת גיליון',
                message: error.response?.data?.error || error.message
            });
        } finally {
            setIsCreatingSheet(false);
        }
    };

    // שחזור מגיבוי
    const handleRestore = async () => {
        if (!selectedBackup) return;
        
        setIsRestoring(true);
        setActionResult(null);
        try {
            const response = await restoreFromBackup({
                backup_folder_id: selectedBackup.id,
                backup_folder_name: selectedBackup.name,
                confirm_restore: true
            });
            
            setActionResult({
                type: 'success',
                title: 'שחזור הושלם בהצלחה!',
                message: `הנתונים שוחזרו מגיבוי ${selectedBackup.name}. שים לב: מזהי הרשומות השתנו.`
            });
            
            // ריענון כל הנתונים במערכת
            queryClient.invalidateQueries();
            
        } catch (error) {
            setActionResult({
                type: 'error',
                title: 'שגיאה בשחזור',
                message: error.response?.data?.error || error.message
            });
        } finally {
            setIsRestoring(false);
            setShowRestoreDialog(false);
            setSelectedBackup(null);
        }
    };

    const openRestoreDialog = (backup) => {
        setSelectedBackup(backup);
        setShowRestoreDialog(true);
    };

    return (
        <div className="space-y-6">
            {/* כותרת וכפתורי פעולה */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h2 className="text-xl font-bold text-gray-900">ניהול גיבויים</h2>
                    <p className="text-sm text-gray-500">גיבויים אוטומטיים רצים כל יום ב-02:00. ניתן גם ליצור גיבוי ידני.</p>
                </div>
                <div className="flex gap-2 flex-wrap">
                    <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => refetchBackups()}
                        disabled={isLoadingBackups}
                    >
                        <RefreshCw className={`h-4 w-4 ml-1 ${isLoadingBackups ? 'animate-spin' : ''}`} />
                        רענן
                    </Button>
                    <Button 
                        onClick={handleCreateSheet}
                        disabled={isCreatingSheet || isBackingUp}
                        variant="outline"
                    >
                        {isCreatingSheet ? (
                            <Loader2 className="h-4 w-4 animate-spin ml-2" />
                        ) : (
                            <FileSpreadsheet className="h-4 w-4 ml-2" />
                        )}
                        יצירת גיליון Sheets
                    </Button>
                    <Button 
                        onClick={handleCreateBackup}
                        disabled={isBackingUp || isCreatingSheet}
                    >
                        {isBackingUp ? (
                            <Loader2 className="h-4 w-4 animate-spin ml-2" />
                        ) : (
                            <HardDrive className="h-4 w-4 ml-2" />
                        )}
                        גיבוי מלא עכשיו
                    </Button>
                </div>
            </div>

            {/* תוצאת פעולה */}
            {actionResult && (
                <Card className={`border-2 ${actionResult.type === 'success' ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                    <CardContent className="p-4 flex items-start gap-3">
                        {actionResult.type === 'success' ? (
                            <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
                        ) : (
                            <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
                        )}
                        <div className="flex-1">
                            <h4 className={`font-medium ${actionResult.type === 'success' ? 'text-green-800' : 'text-red-800'}`}>
                                {actionResult.title}
                            </h4>
                            <p className={`text-sm ${actionResult.type === 'success' ? 'text-green-700' : 'text-red-700'}`}>
                                {actionResult.message}
                            </p>
                            {actionResult.link && (
                                <a 
                                    href={actionResult.link} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="text-sm text-blue-600 hover:underline flex items-center gap-1 mt-1"
                                >
                                    פתח גיליון <ExternalLink className="h-3 w-3" />
                                </a>
                            )}
                        </div>
                        <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => setActionResult(null)}
                            className="h-6 w-6 p-0"
                        >
                            ×
                        </Button>
                    </CardContent>
                </Card>
            )}

            {/* רשימת גיבויים */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                        <HardDrive className="h-5 w-5" />
                        גיבויים מלאים ({backups.length})
                    </CardTitle>
                    <CardDescription>
                        גיבויי JSON מלאים הכוללים את כל הנתונים. ניתן לשחזר מהם את המערכת.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {isLoadingBackups ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                        </div>
                    ) : backups.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">
                            <HardDrive className="h-12 w-12 mx-auto mb-2 opacity-30" />
                            <p>אין גיבויים עדיין</p>
                            <p className="text-sm">לחץ על "גיבוי מלא עכשיו" ליצירת גיבוי ראשון</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {backups.map((backup) => (
                                <div 
                                    key={backup.id} 
                                    className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-gray-50 rounded-lg gap-3"
                                >
                                    <div className="flex items-start gap-3">
                                        <div className={`p-2 rounded-lg ${backup.is_valid ? 'bg-green-100' : 'bg-yellow-100'}`}>
                                            {backup.is_valid ? (
                                                <CheckCircle2 className="h-5 w-5 text-green-600" />
                                            ) : (
                                                <AlertCircle className="h-5 w-5 text-yellow-600" />
                                            )}
                                        </div>
                                        <div>
                                            <div className="font-medium text-gray-900">{backup.date_formatted}</div>
                                            <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
                                                <span className="flex items-center gap-1">
                                                    <Clock className="h-3 w-3" />
                                                    {backup.time_formatted}
                                                </span>
                                                <span className="flex items-center gap-1">
                                                    <Files className="h-3 w-3" />
                                                    {backup.files_count} קבצים
                                                </span>
                                                <Badge variant="outline" className="text-xs">
                                                    {backup.total_size_formatted}
                                                </Badge>
                                            </div>
                                        </div>
                                    </div>
                                    <Button 
                                        variant="outline" 
                                        size="sm"
                                        onClick={() => openRestoreDialog(backup)}
                                        disabled={!backup.is_valid}
                                        className="text-orange-600 border-orange-200 hover:bg-orange-50"
                                    >
                                        <RotateCcw className="h-4 w-4 ml-1" />
                                        שחזר
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* רשימת גיליונות Sheets */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                        <FileSpreadsheet className="h-5 w-5" />
                        גיליונות Google Sheets ({sheets.length})
                    </CardTitle>
                    <CardDescription>
                        טבלאות לוח אירועים עם פירוט שיבוצי ספקים לכל קטגוריה.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {isLoadingBackups ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                        </div>
                    ) : sheets.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">
                            <FileSpreadsheet className="h-12 w-12 mx-auto mb-2 opacity-30" />
                            <p>אין גיליונות עדיין</p>
                            <p className="text-sm">לחץ על "יצירת גיליון Sheets" ליצירת גיליון ראשון</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {sheets.map((sheet) => (
                                <div 
                                    key={sheet.id} 
                                    className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-gray-50 rounded-lg gap-3"
                                >
                                    <div className="flex items-start gap-3">
                                        <div className="p-2 rounded-lg bg-green-100">
                                            <FileSpreadsheet className="h-5 w-5 text-green-600" />
                                        </div>
                                        <div>
                                            <div className="font-medium text-gray-900">{sheet.name}</div>
                                            <div className="flex items-center gap-2 text-sm text-gray-500">
                                                <span className="flex items-center gap-1">
                                                    <Calendar className="h-3 w-3" />
                                                    {new Date(sheet.created_at).toLocaleDateString('he-IL')}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <a 
                                        href={sheet.url} 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                    >
                                        <Button variant="outline" size="sm">
                                            <ExternalLink className="h-4 w-4 ml-1" />
                                            פתח
                                        </Button>
                                    </a>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* דיאלוג אישור שחזור */}
            <Dialog open={showRestoreDialog} onOpenChange={setShowRestoreDialog}>
                <DialogContent className="sm:max-w-md" dir="rtl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-red-600">
                            <AlertTriangle className="h-5 w-5" />
                            אישור שחזור נתונים
                        </DialogTitle>
                        <DialogDescription className="text-right">
                            <div className="space-y-3 mt-4">
                                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                                    <p className="font-medium text-red-800">
                                        אזהרה! פעולה זו בלתי הפיכה!
                                    </p>
                                    <ul className="text-sm text-red-700 mt-2 space-y-1 list-disc list-inside">
                                        <li>כל הנתונים הקיימים יימחקו לצמיתות</li>
                                        <li>הנתונים יוחלפו בנתונים מהגיבוי</li>
                                        <li>מזהי הרשומות (IDs) ישתנו</li>
                                        <li>קישורים ישנים עלולים לא לעבוד</li>
                                    </ul>
                                </div>
                                
                                {selectedBackup && (
                                    <div className="bg-gray-50 rounded-lg p-3">
                                        <p className="text-sm text-gray-600">שחזור מגיבוי:</p>
                                        <p className="font-medium text-gray-900">
                                            {selectedBackup.date_formatted} בשעה {selectedBackup.time_formatted}
                                        </p>
                                        <p className="text-sm text-gray-500">
                                            {selectedBackup.files_count} קבצים, {selectedBackup.total_size_formatted}
                                        </p>
                                    </div>
                                )}
                            </div>
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="flex gap-2 sm:gap-0">
                        <Button
                            variant="outline"
                            onClick={() => setShowRestoreDialog(false)}
                            disabled={isRestoring}
                        >
                            ביטול
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={handleRestore}
                            disabled={isRestoring}
                        >
                            {isRestoring ? (
                                <Loader2 className="h-4 w-4 animate-spin ml-2" />
                            ) : (
                                <RotateCcw className="h-4 w-4 ml-2" />
                            )}
                            אני מבין, שחזר עכשיו
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}