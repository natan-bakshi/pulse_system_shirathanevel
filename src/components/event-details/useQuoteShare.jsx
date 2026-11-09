import { useState, useCallback, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import {useLanguage} from '@/i18n/LanguageProvider';

/**
 * Hook לניהול שיתוף הצעת מחיר בשני שלבים:
 * 1. handlePrepareShare - יוצר את ה-PDF (פעולה ארוכה)
 * 2. handleDoShare - מפעיל navigator.share על קובץ קיים (פעולה מידית)
 *
 * ההפרדה הזו נחוצה כי דפדפני מובייל (iOS וגם Android) דורשים
 * שקריאה ל-navigator.share תתבצע כתגובה מידית ללחיצת משתמש.
 */
export function useQuoteShare({ eventId, event, quoteIncludeIntro, quoteIncludePaymentTerms, quoteIncludeSchedule, quoteIncludeExternalServices, quoteLanguage = 'he', loadEventData, onEnglishTranslationIssue }) {
  const {t}=useLanguage();
  const [shareStatus, setShareStatus] = useState('initial'); // 'initial' | 'fetching' | 'ready'
  const [pdfBlob, setPdfBlob] = useState(null);
  const [pdfFileName, setPdfFileName] = useState('');
  const preparationRevision=useRef(0);
  // A previous document must never be shared after the chosen language,
  // event or included sections change. The revision also prevents a slow
  // response from an OLD language from populating the new share button.
  useEffect(()=>{
    preparationRevision.current+=1;
    setShareStatus('initial');setPdfBlob(null);setPdfFileName('');
  },[quoteLanguage,eventId,quoteIncludeIntro,quoteIncludePaymentTerms,
     quoteIncludeSchedule,quoteIncludeExternalServices]);

  // שלב 1: הכנת ה-PDF - יכול לקחת זמן
  const handlePrepareShare = useCallback(async (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    const revision=preparationRevision.current;
    try {
      setShareStatus('fetching');

      const response = await base44.functions.invoke('generateQuotePdf', {
        eventId,
        includeIntro: quoteIncludeIntro,
        includePaymentTerms: quoteIncludePaymentTerms,
        includeSchedule: quoteIncludeSchedule,
        includeExternalServices: quoteIncludeExternalServices,
        language: quoteLanguage
      });
      if(revision!==preparationRevision.current)return;
      const pdfUrl = response.data.pdf_url;
      const fileName = response.data.fileName || `quote_${event?.event_name || event?.family_name || eventId}.pdf`;

      if (!pdfUrl) throw new Error('No PDF URL returned');

      const pdfResponse = await fetch(pdfUrl);
      const blob = await pdfResponse.blob();
      if(revision!==preparationRevision.current)return;

      setPdfBlob(blob);
      setPdfFileName(fileName);
      setShareStatus('ready');

      // רענון נתוני האירוע לעדכון היסטוריית ההצעות
      if (loadEventData) loadEventData();
    } catch (err) {
      if(revision!==preparationRevision.current)return;
      console.error('Prepare share failed:', err);
      if(!onEnglishTranslationIssue?.(err))
        alert(err.response?.data?.error || t('שגיאה בהכנת הקובץ, נסה שוב'));
      setShareStatus('initial');
      setPdfBlob(null);
      setPdfFileName('');
    }
  }, [eventId, event, quoteIncludeIntro, quoteIncludePaymentTerms, quoteIncludeSchedule, quoteIncludeExternalServices, quoteLanguage, loadEventData,onEnglishTranslationIssue,t]);

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
          title: quoteLanguage==='en'?'Quotation':'הצעת מחיר'
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
        alert(t('שגיאה בשיתוף הקובץ, נסה שוב'));
      }
    } finally {
      setShareStatus('initial');
      setPdfBlob(null);
      setPdfFileName('');
    }
  }, [pdfBlob, pdfFileName,quoteLanguage,t]);

  return { shareStatus, handlePrepareShare, handleDoShare };
}