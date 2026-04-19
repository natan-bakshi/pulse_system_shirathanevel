import React, { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Search, TrendingDown, Calendar, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';

export default function SupplierDeclineStatsDialog({ isOpen, onClose, eventServices = [], allSuppliers = [], allServices = [], allEvents = [] }) {
  const [searchTerm, setSearchTerm] = useState('');

  // Build decline stats from all EventServices
  const declineStats = useMemo(() => {
    const supplierMap = {};

    for (const es of eventServices) {
      let declined = [];
      try { declined = JSON.parse(es.declined_suppliers || '[]'); } catch (e) {}
      if (!Array.isArray(declined) || declined.length === 0) continue;

      const event = allEvents.find(e => e.id === es.event_id);
      const service = allServices.find(s => s.id === es.service_id);

      for (const d of declined) {
        if (!d.supplier_id) continue;
        if (!supplierMap[d.supplier_id]) {
          const supplier = allSuppliers.find(s => s.id === d.supplier_id);
          supplierMap[d.supplier_id] = {
            supplier_id: d.supplier_id,
            supplier_name: supplier?.supplier_name || 'ספק לא ידוע',
            declines: []
          };
        }
        supplierMap[d.supplier_id].declines.push({
          event_name: event?.event_name || '',
          family_name: event?.family_name || '',
          event_date: event?.event_date || '',
          service_name: service?.service_name || '',
          declined_date: d.declined_date || '',
          reason: d.reason || ''
        });
      }
    }

    return Object.values(supplierMap).sort((a, b) => b.declines.length - a.declines.length);
  }, [eventServices, allSuppliers, allServices, allEvents]);

  const filtered = useMemo(() => {
    if (!searchTerm) return declineStats;
    const term = searchTerm.toLowerCase();
    return declineStats.filter(s => s.supplier_name.toLowerCase().includes(term));
  }, [declineStats, searchTerm]);

  const totalDeclines = declineStats.reduce((sum, s) => sum + s.declines.length, 0);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingDown className="h-5 w-5 text-red-600" />
            סטטיסטיקת דחיות ספקים
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Summary */}
          <div className="flex gap-3 text-sm">
            <div className="bg-red-50 rounded-lg px-3 py-2 flex-1 text-center">
              <div className="text-xl font-bold text-red-700">{totalDeclines}</div>
              <div className="text-xs text-red-600">דחיות סה"כ</div>
            </div>
            <div className="bg-orange-50 rounded-lg px-3 py-2 flex-1 text-center">
              <div className="text-xl font-bold text-orange-700">{declineStats.length}</div>
              <div className="text-xs text-orange-600">ספקים שדחו</div>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute right-3 top-2.5 h-4 w-4 text-gray-400" />
            <Input
              placeholder="חיפוש ספק..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pr-9 h-9"
            />
          </div>

          {/* Supplier list */}
          {filtered.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">
              {totalDeclines === 0 ? 'אין היסטוריית דחיות' : 'לא נמצאו תוצאות'}
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map(supplier => (
                <div key={supplier.supplier_id} className="border rounded-lg overflow-hidden">
                  <div className="bg-gray-50 px-3 py-2 flex items-center justify-between">
                    <span className="font-medium text-sm">{supplier.supplier_name}</span>
                    <Badge variant="outline" className="text-red-600 border-red-200 text-xs">
                      {supplier.declines.length} דחיות
                    </Badge>
                  </div>
                  <div className="divide-y">
                    {supplier.declines.map((d, idx) => (
                      <div key={idx} className="px-3 py-2 text-xs space-y-0.5">
                        <div className="flex items-center gap-1.5 text-gray-700">
                          <Calendar className="h-3 w-3 text-gray-400" />
                          <span className="font-medium">
                            {d.family_name ? `משפחת ${d.family_name}` : d.event_name}
                          </span>
                          {d.event_date && (
                            <span className="text-gray-400">
                              ({format(new Date(d.event_date), 'dd/MM/yy')})
                            </span>
                          )}
                        </div>
                        <div className="text-gray-500 mr-4">שירות: {d.service_name}</div>
                        {d.declined_date && (
                          <div className="text-gray-400 mr-4">
                            נדחה בתאריך: {format(new Date(d.declined_date), 'dd/MM/yy')}
                          </div>
                        )}
                        {d.reason && (
                          <div className="text-orange-600 mr-4 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            {d.reason}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}