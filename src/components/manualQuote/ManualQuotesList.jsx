import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Edit, Trash2, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

/**
 * רשימת הצעות מחיר ידניות (טיוטות + שמורות) — מוצגת בתוך לשונית "הצעות מחיר ידניות".
 */
export default function ManualQuotesList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: quotes = [], isLoading } = useQuery({
    queryKey: ['manualQuotes'],
    queryFn: () => base44.entities.ManualQuote.list('-updated_date'),
    staleTime: 60 * 1000
  });

  const { data: events = [] } = useQuery({
    queryKey: ['events-for-manual-quote'],
    queryFn: () => base44.entities.Event.list(),
    staleTime: 60 * 1000
  });

  const eventMap = useMemo(() => {
    const map = {};
    events.forEach(e => { map[e.id] = e; });
    return map;
  }, [events]);

  const handleNew = () => navigate('/ManualQuoteEditor');
  const handleEdit = (id) => navigate(`/ManualQuoteEditor?id=${id}`);

  const handleDelete = async (id) => {
    if (!confirm('למחוק את ההצעה לצמיתות?')) return;
    try {
      await base44.entities.ManualQuote.delete(id);
      queryClient.invalidateQueries({ queryKey: ['manualQuotes'] });
      toast.success('ההצעה נמחקה');
    } catch (e) {
      console.error(e);
      toast.error('שגיאה במחיקה');
    }
  };

  return (
    <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            הצעות מחיר ידניות
          </CardTitle>
          <Button onClick={handleNew}>
            <Plus className="h-4 w-4 ml-1" /> יצירת הצעת מחיר ידנית
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : quotes.length === 0 ? (
          <div className="text-center py-10 text-gray-500">
            <p className="mb-3">אין עדיין הצעות מחיר ידניות.</p>
            <Button variant="outline" onClick={handleNew}>
              <Plus className="h-4 w-4 ml-1" /> צור הצעה ראשונה
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {quotes.map(q => {
              const linked = q.linked_event_id ? eventMap[q.linked_event_id] : null;
              return (
                <div
                  key={q.id}
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50 flex-wrap gap-2"
                >
                  <div className="flex-1 min-w-[200px]">
                    <div className="font-medium">{q.title}</div>
                    <div className="text-xs text-gray-500 flex items-center gap-2 flex-wrap mt-1">
                      <span>עודכן: {new Date(q.updated_date).toLocaleDateString('he-IL')}</span>
                      {linked ? (
                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                          משויך: {linked.event_name}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-gray-500">לא משויך</Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleEdit(q.id)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleDelete(q.id)} className="text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}