const normalizeValue = (value) => String(value || '').trim().toLowerCase();

export const getSupplierCategories = (supplier) => {
  if (Array.isArray(supplier?.categories)) return supplier.categories.filter(Boolean);
  if (typeof supplier?.categories === 'string') {
    return supplier.categories.split(',').map(item => item.trim()).filter(Boolean);
  }
  return [];
};

export const supplierMatchesCategory = (supplier, serviceCategory) => {
  const target = normalizeValue(serviceCategory);
  if (!target) return false;
  return getSupplierCategories(supplier).some(category => normalizeValue(category) === target);
};

const buildRecentAssignmentScoreMap = (eventServices = [], days = 180) => {
  const scores = new Map();
  if (!Array.isArray(eventServices) || eventServices.length === 0) return scores;

  const since = Date.now() - days * 24 * 60 * 60 * 1000;

  eventServices.forEach(eventService => {
    const referenceDate = new Date(eventService.updated_date || eventService.created_date || 0).getTime();
    if (!referenceDate || referenceDate < since) return;

    let supplierIds = [];
    try {
      supplierIds = JSON.parse(eventService.supplier_ids || '[]');
      if (!Array.isArray(supplierIds)) supplierIds = [];
    } catch {
      supplierIds = [];
    }

    supplierIds.forEach(supplierId => {
      scores.set(supplierId, (scores.get(supplierId) || 0) + 1);
    });
  });

  return scores;
};

export const prioritizeSuppliers = (suppliers = [], options = {}) => {
  const {
    serviceCategory = '',
    eventServices = [],
    searchTerm = '',
    excludeIds = []
  } = options;

  const search = normalizeValue(searchTerm);
  const excluded = new Set(excludeIds || []);
  const assignmentScoreMap = buildRecentAssignmentScoreMap(eventServices);

  return [...suppliers]
    .filter(supplier => !excluded.has(supplier.id))
    .filter(supplier => {
      if (!search) return true;
      const name = normalizeValue(supplier.supplier_name);
      const categories = getSupplierCategories(supplier).map(normalizeValue).join(' ');
      return name.includes(search) || categories.includes(search);
    })
    .map(supplier => ({
      supplier,
      categoryRank: supplierMatchesCategory(supplier, serviceCategory) ? 0 : 1,
      assignmentScore: assignmentScoreMap.get(supplier.id) || 0
    }))
    .sort((a, b) => {
      if (a.categoryRank !== b.categoryRank) return a.categoryRank - b.categoryRank;
      if (a.assignmentScore !== b.assignmentScore) return b.assignmentScore - a.assignmentScore;
      return String(a.supplier.supplier_name || '').localeCompare(String(b.supplier.supplier_name || ''), 'he');
    })
    .map(item => item.supplier);
};