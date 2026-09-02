import { DOCUMENT_STATUS_LABELS, DOCUMENT_TYPE_LABELS } from '@/components/billing/documentTypes';

const num = (value) => Number(value) || 0;
const REVENUE_TYPES = ['invoice', 'invoice_receipt'];

export function defaultFilters() {
  const year = new Date().getFullYear();
  return { from: `${year}-01-01`, to: `${year}-12-31`, type: 'all', status: 'all', eventId: 'all', search: '' };
}

export function filterDocuments(documents, filters) {
  const search = filters.search.trim().toLowerCase();
  return documents.filter((doc) => {
    const issued = (doc.issue_date || '').slice(0, 10);
    if (filters.from && issued && issued < filters.from) return false;
    if (filters.to && issued && issued > filters.to) return false;
    if (filters.type !== 'all' && doc.document_type !== filters.type) return false;
    if (filters.status !== 'all' && doc.status !== filters.status) return false;
    if (filters.eventId !== 'all' && (doc.linked_event_id || '') !== filters.eventId) return false;
    if (search && ![doc.document_number, doc.customer_name].some((field) => String(field || '').toLowerCase().includes(search))) return false;
    return true;
  });
}

export function buildStats(documents, generalPayments = []) {
  const revenueDocs = documents.filter((doc) => REVENUE_TYPES.includes(doc.document_type));
  const credits = documents.filter((doc) => doc.document_type === 'invoice_credit');
  const openDocs = documents.filter((doc) => doc.status === 'open');
  const creditedDocs = documents.filter((doc) => ['fully_credited', 'partially_credited', 'cancelled'].includes(doc.status));

  return {
    revenue: revenueDocs.reduce((sum, doc) => sum + num(doc.total), 0) - credits.reduce((sum, doc) => sum + num(doc.total), 0),
    vat: revenueDocs.reduce((sum, doc) => sum + num(doc.total_tax), 0) - credits.reduce((sum, doc) => sum + num(doc.total_tax), 0),
    documentCount: documents.length,
    openCount: openDocs.length,
    openTotal: openDocs.reduce((sum, doc) => sum + num(doc.total), 0),
    creditedCount: creditedDocs.length,
    creditedTotal: creditedDocs.reduce((sum, doc) => sum + num(doc.total), 0),
    generalPaymentsTotal: generalPayments.filter((payment) => payment.payment_status === 'completed').reduce((sum, payment) => sum + num(payment.amount), 0)
  };
}

export function monthlySeries(documents) {
  const buckets = new Map();
  documents.forEach((doc) => {
    const month = (doc.issue_date || '').slice(0, 7);
    if (!month) return;
    if (!buckets.has(month)) buckets.set(month, { month, revenue: 0, vat: 0 });
    const bucket = buckets.get(month);
    const sign = doc.document_type === 'invoice_credit' ? -1 : 1;
    if (REVENUE_TYPES.includes(doc.document_type) || doc.document_type === 'invoice_credit') {
      bucket.revenue += sign * num(doc.total);
      bucket.vat += sign * num(doc.total_tax);
    }
  });
  return [...buckets.values()]
    .sort((first, second) => first.month.localeCompare(second.month))
    .map((bucket) => ({ ...bucket, revenue: Math.round(bucket.revenue), vat: Math.round(bucket.vat) }));
}

export function byTypeSeries(documents) {
  const buckets = new Map();
  documents.forEach((doc) => {
    const label = DOCUMENT_TYPE_LABELS[doc.document_type] || doc.document_type;
    buckets.set(label, (buckets.get(label) || 0) + num(doc.total));
  });
  return [...buckets.entries()].map(([name, value]) => ({ name, value: Math.round(value) })).filter((item) => item.value > 0);
}

export function byStatusSeries(documents) {
  const buckets = new Map();
  documents.forEach((doc) => {
    const label = DOCUMENT_STATUS_LABELS[doc.status] || doc.status;
    buckets.set(label, (buckets.get(label) || 0) + 1);
  });
  return [...buckets.entries()].map(([name, count]) => ({ name, count }));
}

export function topEventsSeries(documents, eventsById, limit = 10) {
  const buckets = new Map();
  documents.forEach((doc) => {
    if (!doc.linked_event_id || !REVENUE_TYPES.includes(doc.document_type)) return;
    const event = eventsById.get(doc.linked_event_id);
    const name = event?.event_name || event?.family_name || 'אירוע לא ידוע';
    buckets.set(name, (buckets.get(name) || 0) + num(doc.total));
  });
  return [...buckets.entries()]
    .map(([name, value]) => ({ name, value: Math.round(value) }))
    .sort((first, second) => second.value - first.value)
    .slice(0, limit);
}

export function buildReportRows(documents, eventsById) {
  const headers = ['תאריך הפקה', 'סוג מסמך', 'מספר מסמך', 'לקוח', 'ח.פ.', 'אירוע', 'סטטוס', 'לפני מע״מ', 'מע״מ', 'סה״כ', 'מטבע'];
  const rows = documents
    .slice()
    .sort((first, second) => String(second.issue_date || '').localeCompare(String(first.issue_date || '')))
    .map((doc) => {
      const event = doc.linked_event_id ? eventsById.get(doc.linked_event_id) : null;
      return [
        (doc.issue_date || '').slice(0, 10),
        DOCUMENT_TYPE_LABELS[doc.document_type] || doc.document_type || '',
        doc.document_number || '',
        doc.customer_name || '',
        doc.customer_identifier || '',
        event?.event_name || event?.family_name || '',
        DOCUMENT_STATUS_LABELS[doc.status] || doc.status || '',
        num(doc.total_without_tax),
        num(doc.total_tax),
        num(doc.total),
        doc.currency || 'ILS'
      ];
    });
  return [headers, ...rows];
}

export function downloadCsv(rows, fileName) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}