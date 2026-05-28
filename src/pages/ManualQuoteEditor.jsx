import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Save, FileDown, ArrowRight, Trash2, Info, Wand2, Share2, Download, Eye } from 'lucide-react';
import { toast } from 'sonner';
import EventLinkSelector from '@/components/manualQuote/EventLinkSelector';
import BlockAdder from '@/components/manualQuote/BlockAdder';
import BlockEditor from '@/components/manualQuote/BlockEditor';
import { generateManualQuotePdf } from '@/functions/generateManualQuotePdf';
import { buildBlocksFromEvent } from '@/components/manualQuote/buildBlocksFromEvent';

export default function ManualQuoteEditor() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const params = new URLSearchParams(location.search);
  const quoteIdFromUrl = params.get('id');

  const [quoteId, setQuoteId] = useState(quoteIdFromUrl || null);
  const [title, setTitle] = useState('הצעת מחיר ידנית');
  const [linkedEventId, setLinkedEventId] = useState('');
  const [blocks, setBlocks] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoading, setIsLoading] = useState(!!quoteIdFromUrl);
  const [lastPdfUri, setLastPdfUri] = useState('');
  const [lastPdfName, setLastPdfName] = useState('');
  const [isSharing, setIsSharing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isViewing, setIsViewing] = useState(false);

  // Templates for selectors
  const { data: templates = [] } = useQuery({
    queryKey: ['quoteTemplates'],
    queryFn: () => base44.entities.QuoteTemplate.list(),
    staleTime: 5 * 60 * 1000
  });

  // Linked event — for showing current template content (concept) in custom-content editors
  const { data: linkedEvent = null } = useQuery({
    queryKey: ['event-for-manual-quote', linkedEventId],
    queryFn: () => base44.entities.Event.get(linkedEventId),
    enabled: !!linkedEventId,
    staleTime: 60 * 1000
  });

  // Load existing quote if editing
  useEffect(() => {
    if (!quoteIdFromUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const q = await base44.entities.ManualQuote.get(quoteIdFromUrl);
        if (cancelled || !q) return;
        setTitle(q.title || 'הצעת מחיר ידנית');
        setLinkedEventId(q.linked_event_id || '');
        setLastPdfUri(q.last_pdf_uri || '');
        setLastPdfName(q.last_pdf_name || '');
        try {
          const parsed = q.blocks ? JSON.parse(q.blocks) : [];
          setBlocks(Array.isArray(parsed) ? parsed : []);
        } catch {
          setBlocks([]);
        }
      } catch (e) {
        console.error('Failed to load manual quote:', e);
        toast.error('שגיאה בטעינת ההצעה');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [quoteIdFromUrl]);

  const addBlock = useCallback((newBlock) => {
    setBlocks(prev => [...prev, newBlock]);
  }, []);

  const insertBlockAt = useCallback((newBlock, index) => {
    setBlocks(prev => {
      const next = [...prev];
      next.splice(index, 0, newBlock);
      return next;
    });
  }, []);

  const updateBlock = useCallback((idx, updated) => {
    setBlocks(prev => prev.map((b, i) => (i === idx ? updated : b)));
  }, []);

  const removeBlock = useCallback((idx) => {
    setBlocks(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const moveBlock = useCallback((idx, dir) => {
    setBlocks(prev => {
      const next = [...prev];
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= next.length) return prev;
      const [moved] = next.splice(idx, 1);
      next.splice(newIdx, 0, moved);
      return next;
    });
  }, []);

  const handleLoadFromEvent = useCallback(() => {
    if (!linkedEventId) {
      toast.error('יש לשייך קודם אירוע למעלה כדי לטעון את הצעת המחיר שלו');
      return;
    }
    if (blocks.length > 0 && !confirm('פעולה זו תחליף את כל הקטעים הקיימים במבנה של הצעת מחיר רגילה. להמשיך?')) {
      return;
    }
    
    const includeIntro = params.get('includeIntro') !== 'false';
    const includePaymentTerms = params.get('includePaymentTerms') !== 'false';
    const includeSchedule = params.get('includeSchedule') !== 'false';
    
    setBlocks(buildBlocksFromEvent({ includeIntro, includePaymentTerms, includeSchedule }));
    toast.success('נטענה הצעת מחיר רגילה כנקודת התחלה — ניתן לערוך, להסיר או להוסיף קטעי טקסט בין המקטעים');
  }, [linkedEventId, blocks.length, params]);

  const handleSave = useCallback(async (silent = false) => {
    setIsSaving(true);
    try {
      const data = {
        title: title.trim() || 'הצעת מחיר ידנית',
        linked_event_id: linkedEventId || '',
        blocks: JSON.stringify(blocks),
        status: 'draft'
      };
      let saved;
      if (quoteId) {
        saved = await base44.entities.ManualQuote.update(quoteId, data);
      } else {
        saved = await base44.entities.ManualQuote.create(data);
        setQuoteId(saved.id);
        // Reflect new id in URL without reloading
        const newUrl = `${location.pathname}?id=${saved.id}`;
        window.history.replaceState(null, '', newUrl);
      }
      queryClient.invalidateQueries({ queryKey: ['manualQuotes'] });
      if (!silent) toast.success('ההצעה נשמרה');
      return saved?.id || quoteId;
    } catch (e) {
      console.error('Failed to save manual quote:', e);
      toast.error('שגיאה בשמירה: ' + (e.message || 'שגיאה לא ידועה'));
      return null;
    } finally {
      setIsSaving(false);
    }
  }, [title, linkedEventId, blocks, quoteId, queryClient, location.pathname]);

  // Helper — מפיק PDF טרי לפי המצב הנוכחי ומחזיר { pdf_url, fileName } או null במקרה של שגיאה.
  const buildFreshPdf = useCallback(async () => {
    const id = await handleSave(true);
    if (!id) return null;
    const res = await generateManualQuotePdf({ manualQuoteId: id });
    const data = res?.data || res;
    if (!data?.pdf_url) {
      toast.error('שגיאה בהפקת PDF: ' + (data?.error || 'שגיאה לא ידועה'));
      return null;
    }
    // לאחר ייצור — עדכן את ה-state המקומי כדי שהכפתור "צפייה ב-PDF קיים" יופיע מיד
    try {
      const fresh = await base44.entities.ManualQuote.get(id);
      if (fresh?.last_pdf_uri) {
        setLastPdfUri(fresh.last_pdf_uri);
        setLastPdfName(fresh.last_pdf_name || '');
      }
    } catch {}
    return data;
  }, [handleSave]);

  const handleGeneratePdf = useCallback(async () => {
    setIsGenerating(true);
    try {
      const data = await buildFreshPdf();
      if (data?.pdf_url) {
        toast.success('PDF הופק בהצלחה');
        window.open(data.pdf_url, '_blank');
      }
    } catch (e) {
      console.error('PDF generation failed:', e);
      toast.error('שגיאה בהפקת PDF: ' + (e.message || 'שגיאה לא ידועה'));
    } finally {
      setIsGenerating(false);
    }
  }, [buildFreshPdf]);

  // הורדה ישירה — מפיק PDF טרי ומוריד אוטומטית.
  const handleDownloadPdf = useCallback(async () => {
    setIsDownloading(true);
    try {
      const data = await buildFreshPdf();
      if (!data?.pdf_url) return;
      try {
        const pdfResponse = await fetch(data.pdf_url);
        const blob = await pdfResponse.blob();
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = data.fileName || 'manual-quote.pdf';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
        toast.success('הקובץ ירד');
      } catch (downloadError) {
        console.warn('Direct download failed, falling back to opening in new tab', downloadError);
        window.open(data.pdf_url, '_blank');
      }
    } catch (e) {
      console.error('Download failed:', e);
      toast.error('שגיאה בהורדה: ' + (e.message || 'שגיאה לא ידועה'));
    } finally {
      setIsDownloading(false);
    }
  }, [buildFreshPdf]);

  // שיתוף — מפיק PDF טרי ומפעיל שיתוף נייטיב (או הורדה כ-fallback).
  const handleSharePdf = useCallback(async () => {
    setIsSharing(true);
    try {
      const data = await buildFreshPdf();
      if (!data?.pdf_url) return;
      const fileName = data.fileName || 'manual-quote.pdf';
      const pdfResponse = await fetch(data.pdf_url);
      const blob = await pdfResponse.blob();
      const file = new File([blob], fileName, { type: 'application/pdf' });

      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'הצעת מחיר' });
      } else {
        // Fallback — הורדה
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
        toast.success('הקובץ ירד (השיתוף הנייטיב לא זמין בדפדפן זה)');
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.error('Share failed:', e);
        toast.error('שגיאה בשיתוף: ' + (e.message || 'שגיאה לא ידועה'));
      }
    } finally {
      setIsSharing(false);
    }
  }, [buildFreshPdf]);

  // צפייה ב-PDF הקיים — פותח את ה-PDF השמור האחרון בלי להפיק מחדש.
  const handleViewExistingPdf = useCallback(async () => {
    if (!lastPdfUri) {
      toast.error('עדיין לא הופק PDF להצעה זו');
      return;
    }
    setIsViewing(true);
    try {
      const res = await base44.integrations.Core.CreateFileSignedUrl({ file_uri: lastPdfUri, expires_in: 600 });
      const signedUrl = res?.signed_url;
      if (!signedUrl) {
        toast.error('שגיאה בקבלת קישור צפייה');
        return;
      }
      window.open(signedUrl, '_blank');
    } catch (e) {
      console.error('View existing PDF failed:', e);
      toast.error('שגיאה בפתיחת ה-PDF: ' + (e.message || 'שגיאה לא ידועה'));
    } finally {
      setIsViewing(false);
    }
  }, [lastPdfUri]);

  const handleDelete = useCallback(async () => {
    if (!quoteId) {
      navigate('/QuoteTemplateManagement');
      return;
    }
    if (!confirm('האם למחוק את ההצעה לצמיתות?')) return;
    try {
      await base44.entities.ManualQuote.delete(quoteId);
      queryClient.invalidateQueries({ queryKey: ['manualQuotes'] });
      toast.success('ההצעה נמחקה');
      navigate('/QuoteTemplateManagement');
    } catch (e) {
      console.error('Delete failed:', e);
      toast.error('שגיאה במחיקה');
    }
  }, [quoteId, queryClient, navigate]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-white" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-5xl mx-auto pb-24">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate('/QuoteTemplateManagement')} className="text-white hover:bg-white/10">
          <ArrowRight className="h-4 w-4 ml-1" /> חזרה לניהול הצעות
        </Button>
        <div className="flex gap-2 flex-wrap items-center">
          <Button variant="outline" size="sm" onClick={() => handleSave(false)} disabled={isSaving || isGenerating || isSharing || isDownloading}>
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <Save className="h-4 w-4 ml-1" />}
            שמור
          </Button>
          <Button size="sm" onClick={handleGeneratePdf} disabled={isSaving || isGenerating || isSharing || isDownloading}>
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <FileDown className="h-4 w-4 ml-1" />}
            הפק PDF
          </Button>

          {/* כפתורי אייקון: שיתוף, הורדה, צפייה ב-PDF קיים */}
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={handleSharePdf}
            disabled={isSaving || isGenerating || isSharing || isDownloading}
            title="שתף הצעת מחיר"
          >
            {isSharing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={handleDownloadPdf}
            disabled={isSaving || isGenerating || isSharing || isDownloading}
            title="הורד PDF"
          >
            {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          </Button>
          {lastPdfUri && (
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={handleViewExistingPdf}
              disabled={isViewing}
              title={lastPdfName ? `צפה ב-PDF הקיים (${lastPdfName})` : 'צפה ב-PDF הקיים'}
            >
              {isViewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
            </Button>
          )}

          {quoteId && (
            <Button variant="ghost" size="sm" onClick={handleDelete} className="text-red-300 hover:bg-red-500/20">
              <Trash2 className="h-4 w-4 ml-1" /> מחק
            </Button>
          )}
        </div>
      </div>

      {/* Title + Event link */}
      <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
        <CardHeader>
          <CardTitle className="text-base">פרטי ההצעה</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>כותרת ההצעה (לשימוש פנימי)</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="לדוגמה: טיוטה למשפחת כהן" />
          </div>
        </CardContent>
      </Card>

      <EventLinkSelector linkedEventId={linkedEventId} onChange={setLinkedEventId} />

      {/* Info banner + Load from event */}
      <div className="bg-blue-50/95 border border-blue-200 rounded-lg p-3 text-sm text-blue-900 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-start gap-2 flex-1 min-w-[260px]">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            העורך מחולק לקטעים. הוסף קטעים בסוגים השונים, סדר אותם בסדר הרצוי, ולחץ על "הפק PDF" כדי לייצר את ההצעה. ה-PDF יופק עם אותו רקע, שוליים ועיצוב כמו הצעות המחיר הרגילות.
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleLoadFromEvent}
          disabled={!linkedEventId}
          className="shrink-0"
          title={!linkedEventId ? 'יש לשייך אירוע למעלה' : 'בנה הצעה רגילה כנקודת התחלה'}
        >
          <Wand2 className="h-4 w-4 ml-1" />
          טען הצעה רגילה מהאירוע
        </Button>
      </div>

      {/* Blocks */}
      <div className="space-y-3">
        {blocks.length === 0 && (
          <Card className="bg-white/95">
            <CardContent className="text-center py-12 text-gray-500">
              <p className="mb-3">אין עדיין קטעים בהצעה.</p>
              <BlockAdder onAdd={addBlock} label="הוסף קטע ראשון" size="default" variant="default" />
            </CardContent>
          </Card>
        )}

        {blocks.map((block, idx) => (
          <React.Fragment key={block.id}>
            <BlockEditor
              block={block}
              index={idx}
              total={blocks.length}
              onChange={(updated) => updateBlock(idx, updated)}
              onRemove={() => removeBlock(idx)}
              onMoveUp={() => moveBlock(idx, -1)}
              onMoveDown={() => moveBlock(idx, +1)}
              linkedEventId={linkedEventId}
              linkedEvent={linkedEvent}
              templates={templates}
            />
            <div className="flex justify-center">
              <BlockAdder onAdd={(b) => insertBlockAt(b, idx + 1)} label="הוסף קטע כאן" />
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}