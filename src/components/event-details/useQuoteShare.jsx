import { useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * Hook לניהול שיתוף הצעת מחיר בשני שלבים:
 * 1. handlePrepareShare - יוצר את ה-PDF (פעולה ארוכה)
 * 2. handleDoShare - מפעיל navigator.share על קובץ קיים (פעולה מידית)
 *
 * ההפרדה הזו נחוצה כי דפדפני מובייל (iOS וגם Android) דורשים
 * שקריאה ל-navigator.share תתבצע כתגובה מידית ללחיצת משתמש.
 */
export function useQuoteShare({ eventId, event, quoteIncludeIntro, quoteIncludePaymentTerms, quoteIncludeSchedule, loadEventData }) {
  const [shareStatus, setShareStatus] = useState('initial'); // 'initial' | 'fetching' | 'ready'
  const [pdfBlob, setPdfBlob] = useState(null);
  const [pdfFileName, setPdfFileName] = useState('');

  // שלב 1: הכנת ה-PDF - יכול לקחת זמן
  const handlePrepareShare = useCallback(async (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    try {
      setShareStatus('fetching');

      const response = await base44.functions.invoke('generateQuotePdf', {
        eventId,
        includeIntro: quoteIncludeIntro,
        includePaymentTerms: quoteIncludePaymentTerms,
        includeSchedule: quoteIncludeSchedule
      });
      const pdfUrl = response.data.pdf_url;
      const fileName = response.data.fileName || `quote_${event?.family_name || eventId}.pdf`;

      if (!pdfUrl) throw new Error('No PDF URL returned');

      const pdfResponse = await fetch(pdfUrl);
      const blob = await pdfResponse.blob();

      setPdfBlob(blob);
      setPdfFileName(fileName);
      setShareStatus('ready');

      // רענון נתוני האירוע לעדכון היסטוריית ההצעות
      if (loadEventData) loadEventData();
    } catch (err) {
      console.error('Prepare share failed:', err);
      alert('שגיאה בהכנת הקובץ, נסה שוב');
      setShareStatus('initial');
      setPdfBlob(null);
      setPdfFileName('');
    }
  }, [eventId, event, quoteIncludeIntro, quoteIncludePaymentTerms, quoteIncludeSchedule, loadEventData]);

  // שלב 2: שיתוף הקובץ המוכן - חייב להיות מידי, ללא await לפני navigator.share
  const handleDoShare = useCallback(async (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    if (!pdfBlob || !pdfFileName) return;

    try {
      const file = new File([pdfBlob], pdfFileName, { type: 'application/pdf' });

      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'הצעת מחיר'
        });
      } else {
        // Fallback: הורדה ישירה
        const url = window.URL.createObjectURL(pdfBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = pdfFileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Share failed:', err);
        alert('שגיאה בשיתוף הקובץ, נסה שוב');
      }
    } finally {
      setShareStatus('initial');
      setPdfBlob(null);
      setPdfFileName('');
    }
  }, [pdfBlob, pdfFileName]);

  return { shareStatus, handlePrepareShare, handleDoShare };
}