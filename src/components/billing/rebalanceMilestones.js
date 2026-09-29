// Redistribute a changed amount only across later milestones; never rewrite earlier commitments.
export function rebalanceMilestones(rows, index, amount) {
  if (index >= rows.length - 1 || !Number.isFinite(amount) || amount < 0) return rows;
  const cents = n => Math.round(Number(n || 0) * 100);
  const next = rows.map(row => ({ ...row }));
  let difference = cents(amount) - cents(rows[index].amount);
  if (difference > next.slice(index + 1).reduce((sum, row) => sum + cents(row.amount), 0)) return rows;
  next[index].amount = Math.round(amount * 100) / 100;
  for (let i = index + 1; i < next.length && difference !== 0; i++) {
    const adjustment = difference > 0 ? Math.min(cents(next[i].amount), difference) : difference;
    next[i].amount = (cents(next[i].amount) - adjustment) / 100;
    difference -= adjustment;
  }
  return next;
}