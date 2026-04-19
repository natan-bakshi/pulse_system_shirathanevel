import React, { useState, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Share2, Eye, Clock, Loader2, ChevronDown, Trash2 } from "lucide-react";

const STATUS_LABELS = {
  quote: "הצעת מחיר",
  confirmed: "מאושר",
  in_progress: "בביצוע",
  completed: "הושלם",
  cancelled: "בוטל"
};

function formatDateTime(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${day}.${month}.${year} ${hours}:${minutes}`;
}

const SWIPE_THRESHOLD = 120;

function QuoteHistoryItem({ item, onView, onDownload, onShare, onDelete, isLoading, loadingAction }) {
  const [offsetX, setOffsetX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const startXRef = useRef(0);
  const currentXRef = useRef(0);
  const isDraggingRef = useRef(false);

  const handleTouchStart = useCallback((e) => {
    startXRef.current = e.touches[0].clientX;
    currentXRef.current = startXRef.current;
    isDraggingRef.current = false;
    setSwiping(true);
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (!swiping) return;
    currentXRef.current = e.touches[0].clientX;
    // RTL: swipe right = positive delta (towards delete)
    const delta = currentXRef.current - startXRef.current;
    if (delta > 10) isDraggingRef.current = true;
    // Only allow swiping right (positive) in RTL
    const clampedDelta = Math.max(0, Math.min(delta, 200));
    setOffsetX(clampedDelta);
  }, [swiping]);

  const handleTouchEnd = useCallback(() => {
    setSwiping(false);
    if (offsetX >= SWIPE_THRESHOLD) {
      setConfirmDelete(true);
    }
    setOffsetX(0);
  }, [offsetX]);

  const handleConfirmYes = useCallback(() => {
    setConfirmDelete(false);
    onDelete(item);
  }, [item, onDelete]);

  const handleConfirmNo = useCallback(() => {
    setConfirmDelete(false);
  }, []);

  const swipeProgress = Math.min(offsetX / SWIPE_THRESHOLD, 1);
  const bgOpacity = swipeProgress * 0.15;

  if (confirmDelete) {
    return (
      <div className="flex items-center justify-between py-2.5 px-3 border-b border-gray-100 last:border-b-0 bg-red-50 rounded text-sm animate-in fade-in duration-200">
        <span className="text-red-700 font-medium text-xs">למחוק הצעה זו?</span>
        <div className="flex gap-2 shrink-0">
          <button onClick={handleConfirmYes} className="px-3 py-1 rounded bg-red-600 text-white text-xs font-medium hover:bg-red-700 transition-colors">
            מחק
          </button>
          <button onClick={handleConfirmNo} className="px-3 py-1 rounded bg-gray-200 text-gray-700 text-xs font-medium hover:bg-gray-300 transition-colors">
            ביטול
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden border-b border-gray-100 last:border-b-0">
      {/* Delete background layer */}
      <div 
        className="absolute inset-0 flex items-center justify-start pr-4 pointer-events-none"
        style={{ backgroundColor: `rgba(220, 38, 38, ${bgOpacity})` }}
      >
        {offsetX > 30 && (
          <Trash2 
            className="h-4 w-4 transition-all duration-100" 
            style={{ 
              color: `rgba(220, 38, 38, ${swipeProgress})`,
              transform: `scale(${0.8 + swipeProgress * 0.4})`
            }} 
          />
        )}
      </div>
      {/* Swipeable content */}
      <div
        className="flex items-center justify-between py-2 px-3 hover:bg-gray-50 rounded text-sm relative bg-white"
        style={{ 
          transform: `translateX(${offsetX}px)`, 
          transition: swiping ? 'none' : 'transform 0.25s ease-out',
          backgroundColor: offsetX > 30 ? `rgba(254, 226, 226, ${swipeProgress * 0.6})` : undefined
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-gray-800 font-medium">
            <Clock className="h-3 w-3 text-gray-400 shrink-0" />
            <span className="truncate">{formatDateTime(item.created_at)}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5 mr-5">
            <span>{STATUS_LABELS[item.event_status] || item.event_status}</span>
            <span>•</span>
            <span className="truncate">{item.created_by_user_name}</span>
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          <button
            onClick={() => { if (!isDraggingRef.current) onView(item); }}
            disabled={isLoading}
            className="p-1.5 rounded hover:bg-blue-50 text-blue-600 transition-colors disabled:opacity-50"
            title="צפייה"
          >
            {loadingAction === "view" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={() => { if (!isDraggingRef.current) onDownload(item); }}
            disabled={isLoading}
            className="p-1.5 rounded hover:bg-green-50 text-green-600 transition-colors disabled:opacity-50"
            title="הורדה"
          >
            {loadingAction === "download" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={() => { if (!isDraggingRef.current) onShare(item); }}
            disabled={isLoading}
            className="p-1.5 rounded hover:bg-purple-50 text-purple-600 transition-colors disabled:opacity-50"
            title="שיתוף"
          >
            {loadingAction === "share" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function QuoteHistoryPanel({ quoteHistory = [], onClose, onDelete }) {
  const [showFullDialog, setShowFullDialog] = useState(false);
  const [loadingItem, setLoadingItem] = useState(null);
  const [loadingAction, setLoadingAction] = useState(null);

  // Sort by newest first
  const sorted = [...quoteHistory].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const getSignedUrl = async (fileUri) => {
    const res = await base44.integrations.Core.CreateFileSignedUrl({ file_uri: fileUri, expires_in: 300 });
    return res.signed_url;
  };

  const handleView = async (item) => {
    setLoadingItem(item.file_uri);
    setLoadingAction("view");
    try {
      const url = await getSignedUrl(item.file_uri);
      window.open(url, "_blank");
    } catch (e) {
      console.error("Failed to get signed URL:", e);
      alert("שגיאה בפתיחת הקובץ");
    } finally {
      setLoadingItem(null);
      setLoadingAction(null);
    }
  };

  const handleDownload = async (item) => {
    setLoadingItem(item.file_uri);
    setLoadingAction("download");
    try {
      const url = await getSignedUrl(item.file_uri);
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = item.file_name || "quote.pdf";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (e) {
      console.error("Failed to download:", e);
      alert("שגיאה בהורדת הקובץ");
    } finally {
      setLoadingItem(null);
      setLoadingAction(null);
    }
  };

  const handleShare = async (item) => {
    setLoadingItem(item.file_uri);
    setLoadingAction("share");
    try {
      const url = await getSignedUrl(item.file_uri);
      const response = await fetch(url);
      const blob = await response.blob();
      const file = new File([blob], item.file_name || "quote.pdf", { type: "application/pdf" });

      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "הצעת מחיר" });
      } else {
        // Fallback: download
        const blobUrl = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = item.file_name || "quote.pdf";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(blobUrl);
      }
    } catch (e) {
      if (e.name !== "AbortError") {
        console.error("Share failed:", e);
        alert("שגיאה בשיתוף הקובץ");
      }
    } finally {
      setLoadingItem(null);
      setLoadingAction(null);
    }
  };

  const isItemLoading = (item) => loadingItem === item.file_uri;
  const getItemAction = (item) => (loadingItem === item.file_uri ? loadingAction : null);

  // Compact inline list (max 3 items shown)
  const compactItems = sorted.slice(0, 3);
  const hasMore = sorted.length > 3;

  return (
    <>
      {/* Compact inline list */}
      <div className="py-1">
        <div className="px-2 py-1.5 text-xs font-semibold text-gray-500 border-b border-gray-100">
          היסטוריה ({sorted.length})
        </div>
        {compactItems.map((item, idx) => (
          <QuoteHistoryItem
            key={item.file_uri + idx}
            item={item}
            onView={handleView}
            onDownload={handleDownload}
            onShare={handleShare}
            onDelete={onDelete}
            isLoading={isItemLoading(item)}
            loadingAction={getItemAction(item)}
          />
        ))}
        {hasMore && (
          <button
            onClick={() => setShowFullDialog(true)}
            className="w-full flex items-center justify-center gap-1 py-2 text-xs text-red-800 hover:bg-red-50 transition-colors font-medium"
          >
            <ChevronDown className="h-3 w-3" />
            הצג הכל ({sorted.length})
          </button>
        )}
      </div>

      {/* Full dialog for all items */}
      <Dialog open={showFullDialog} onOpenChange={setShowFullDialog}>
        <DialogContent className="max-h-[85vh] overflow-y-auto max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              היסטוריית הצעות מחיר ({sorted.length})
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-0 max-h-[60vh] overflow-y-auto">
            {sorted.map((item, idx) => (
              <QuoteHistoryItem
                key={item.file_uri + idx}
                item={item}
                onView={handleView}
                onDownload={handleDownload}
                onShare={handleShare}
                onDelete={onDelete}
                isLoading={isItemLoading(item)}
                loadingAction={getItemAction(item)}
              />
            ))}
          </div>
          <div className="flex justify-end pt-2">
            <Button variant="outline" size="sm" onClick={() => setShowFullDialog(false)}>
              סגור
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}